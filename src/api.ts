import { callable, executeInTab, fetchNoCors } from "@decky/api";
import { Navigation, Router } from "@decky/ui";
import { getStrings, loadStoredLanguage } from "./i18n";
import {
  GameSearchResult,
  GuideContent,
  GuideSource,
  LibraryState,
  ListGuidesResponse,
  PinnedSection,
  PluginSettings,
  SavedGameEntry,
} from "./types";

export const FULL_READER_ROUTE = "/quick-walkthrough/reader";

export const getLibrary = callable<[], LibraryState>("get_library");

export const getGameEntry = callable<[game_key: string], SavedGameEntry | null>(
  "get_game_entry"
);

export const updateSettings = callable<
  [patch: Partial<PluginSettings>],
  PluginSettings
>("update_settings");

export const searchGames = callable<[query: string], GameSearchResult[]>(
  "search_games"
);

export const searchWalkthroughs = callable<
  [
    query: string,
    appid: number,
    game_name: string,
    location_hint: string,
    walkthrough_only: boolean,
    english_only: boolean
  ],
  ListGuidesResponse
>("search_walkthroughs");

export const listGuides = callable<
  [
    appid: number,
    game_name: string,
    game_image: string,
    search_text: string,
    walkthrough_only: boolean,
    english_only: boolean,
    wiki_slug: string,
    location_hint: string
  ],
  ListGuidesResponse
>("list_guides");

export const getGuide = callable<
  [source: GuideSource, guide_id: string, force_refresh: boolean],
  GuideContent
>("get_guide");

export const saveProgress = callable<
  [
    game_key: string,
    appid: number,
    game_name: string,
    game_image: string,
    source: GuideSource,
    guide_id: string,
    guide_title: string,
    guide_author: string,
    section_index: number,
    section_id: string,
    section_title: string,
    total_sections: number,
    scroll_ratio: number,
    bookmarked?: boolean | null
  ],
  SavedGameEntry
>("save_progress");

export const setGameBookmarked = callable<
  [
    game_key: string,
    bookmarked: boolean,
    appid?: number,
    game_name?: string,
    game_image?: string
  ],
  SavedGameEntry
>("set_game_bookmarked");

export const togglePinnedSection = callable<
  [
    game_key: string,
    guide_id: string,
    source: GuideSource,
    section_index: number,
    section_id: string,
    section_title: string
  ],
  PinnedSection[]
>("toggle_pinned_section");

export const removeGame = callable<[game_key: string], boolean>("remove_game");

export const clearCache = callable<[], number>("clear_cache");

export const parseGuideHtml = callable<
  [source: GuideSource, guide_id: string, html: string],
  GuideContent
>("parse_guide_html");

export interface NetworkDiagResult {
  name: string;
  ok: boolean;
  ms: number;
  error: string;
}

export const diagnoseNetwork = callable<[], NetworkDiagResult[]>(
  "diagnose_network"
);

async function fetchHtmlViaBrowserView(url: string, timeoutMs = 13000): Promise<string> {
  const s = getStrings(loadStoredLanguage());
  const winInst =
    Router.WindowStore?.GamepadUIMainWindowInstance ||
    Router.WindowStore?.MainWindowInstance;
  if (!winInst || typeof winInst.CreateBrowserView !== "function") {
    throw new Error(s.errSteamBrowserViewUnavailable);
  }

  let created: any = null;
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    let latestTitle = "";
    let grabScheduled = false;

    const cleanup = () => {
      try {
        const popup = created?.GetBrowser?.() || created?.m_browserView;
        popup?.SetVisible?.(false);
        created?.Destroy?.();
      } catch {
        // ignore
      }
      created = null;
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(hardTimer);
      cleanup();
      reject(err);
    };

    const tryCaptureDom = async () => {
      if (settled || !latestTitle) return;
      try {
        const res = await executeInTab(
          latestTitle,
          false,
          "document.documentElement ? document.documentElement.outerHTML : ''"
        );
        if (!settled && res?.success && typeof res.result === "string" && res.result.length > 200) {
          settled = true;
          window.clearTimeout(hardTimer);
          cleanup();
          resolve(res.result);
        }
      } catch {
        // wait for next finished-request / title update
      }
    };

    const hardTimer = window.setTimeout(() => {
      fail(new Error(s.errBackgroundBrowserTimeout));
    }, timeoutMs);

    try {
      created = winInst.CreateBrowserView("QuickWalkthroughFetch", {
        strInitialURL: url,
      });
      if (!created) {
        fail(new Error(s.errBackgroundBrowserCreateFailed));
        return;
      }
      const popup = created.GetBrowser?.() || created.m_browserView;
      popup?.SetVisible?.(false);

      if (popup && typeof popup.on === "function") {
        popup.on("set-title", (title: string) => {
          if (title && !title.startsWith("data:")) {
            latestTitle = title;
            if (grabScheduled && !settled) {
              window.setTimeout(() => tryCaptureDom(), 250);
            }
          }
        });
        popup.on("finished-request", (loadedUrl: string) => {
          if (!loadedUrl || loadedUrl === "about:blank" || loadedUrl.startsWith("data:")) {
            return;
          }
          grabScheduled = true;
          window.setTimeout(() => tryCaptureDom(), 450);
        });
        popup.on("load-error", (_code: number, _errUrl: string, desc: string) => {
          fail(new Error(desc || s.errPageLoadFailed));
        });
      }

      created.LoadURL?.(url);
    } catch (e: any) {
      fail(new Error(e?.message || s.errBackgroundBrowser));
    }
  });
}

export async function fetchGuideWithFallback(
  source: GuideSource,
  guideId: string,
  forceRefresh: boolean,
  explicitUrl?: string,
  prefetchedHtml?: string
): Promise<GuideContent> {
  const s = getStrings(loadStoredLanguage());
  if (prefetchedHtml && prefetchedHtml.trim().length > 200) {
    try {
      return await withTimeout(
        parseGuideHtml(source, guideId, prefetchedHtml),
        5000,
        s.errHtmlParseTimeout
      );
    } catch {
      // Fall through to network fetch if local DOM snapshot failed to parse
    }
  }

  const url = resolveGuideUrl(source, guideId, explicitUrl);

  const tryBackend = withTimeout(
    getGuide(source, guideId, forceRefresh),
    16000,
    s.errBackendGuideTimeout
  );

  if (!url || source === "strategywiki") {
    return await tryBackend;
  }

  const tryFetchNoCors = async (): Promise<GuideContent> => {
    const resp = await withTimeout(
      fetchNoCors(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
      }),
      12000,
      s.errDeckyFetchTimeout
    );
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const html = await resp.text();
    return await withTimeout(
      parseGuideHtml(source, guideId, html),
      6000,
      s.errHtmlParseTimeout
    );
  };

  const tryChromiumDom = async (): Promise<GuideContent> => {
    const html = await fetchHtmlViaBrowserView(url, 14000);
    return await withTimeout(
      parseGuideHtml(source, guideId, html),
      6000,
      s.errHtmlParseTimeout
    );
  };

  // Race backend (instant on cache), fetchNoCors, and Steam Chromium BrowserView fallback
  return await new Promise<GuideContent>((resolve, reject) => {
    let settled = false;
    let failures = 0;
    const totalAttempts = 3;
    let lastErr: unknown;
    let noCorsTimer = 0;
    let browserTimer = 0;

    const cleanupTimers = () => {
      if (noCorsTimer) window.clearTimeout(noCorsTimer);
      if (browserTimer) window.clearTimeout(browserTimer);
    };

    const handleResolve = (res: GuideContent) => {
      if (!settled) {
        settled = true;
        cleanupTimers();
        resolve(res);
      }
    };

    const handleErr = (err: unknown) => {
      failures += 1;
      lastErr = err;
      if (!settled && failures >= totalAttempts) {
        settled = true;
        cleanupTimers();
        reject(lastErr);
      }
    };

    tryBackend.then(handleResolve, handleErr);

    // Stagger fallbacks so local offline cache & fast backend requests win without duplicate work
    noCorsTimer = window.setTimeout(() => {
      if (settled) return;
      tryFetchNoCors().then(handleResolve, handleErr);
    }, 450);

    browserTimer = window.setTimeout(() => {
      if (settled) return;
      tryChromiumDom().then(handleResolve, handleErr);
    }, 1500);
  });
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms = 12000,
  label?: string
): Promise<T> {
  const effectiveLabel = label || getStrings(loadStoredLanguage()).errOperationTimeout;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(effectiveLabel));
    }, ms);
    promise.then(
      (val) => {
        window.clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface RunningGameInfo {
  game_key: string;
  appid: number;
  name: string;
  image: string;
  locationHint: string;
}

function readSteamRichPresenceHint(gameName: string): string {
  try {
    const win = window as unknown as {
      friendStore?: {
        currentUserSteamID?: unknown;
        GetFriendState?: (id: unknown) => {
          HasCurrentGameRichPresence?: () => boolean;
          GetCurrentGameRichPresence?: () => string;
          m_mapRichPresence?: Map<string, string>;
          m_persona?: { m_strGameExtraInfo?: string };
        };
      };
    };
    const fs = win.friendStore;
    if (!fs || !fs.GetFriendState || !fs.currentUserSteamID) return "";
    const me = fs.GetFriendState(fs.currentUserSteamID);
    if (!me) return "";

    const rawParts: string[] = [];
    if (me.m_mapRichPresence instanceof Map) {
      for (const k of ["location", "area", "zone", "chapter", "act", "level", "quest", "status"]) {
        const v = me.m_mapRichPresence.get(k);
        if (v && v.trim() && !v.includes("#")) rawParts.push(v.trim());
      }
    }
    const rp = me.HasCurrentGameRichPresence?.()
      ? (me.GetCurrentGameRichPresence?.() || "").trim()
      : "";
    const extra = (me.m_persona?.m_strGameExtraInfo || "").trim();
    const candidate = rawParts[0] || rp || extra;
    if (!candidate) return "";

    // Ignore generic statuses that just repeat the game name or "Main Menu"
    const lower = candidate.toLowerCase();
    if (
      lower === gameName.toLowerCase() ||
      lower === "main menu" ||
      lower === "in menus" ||
      lower === "title screen"
    ) {
      return "";
    }
    return candidate;
  } catch {
    return "";
  }
}

/**
 * Reads the currently active game in Steam Gaming Mode and any Rich Presence location hint.
 */
export function getRunningGame(): RunningGameInfo | null {
  try {
    const app =
      Router.MainRunningApp ||
      (Array.isArray(Router.RunningApps) && Router.RunningApps.length > 0
        ? Router.RunningApps[0]
        : undefined);

    if (app && app.display_name) {
      const rawId = Number(app.appid || 0);
      const isRealSteamApp = rawId > 0 && rawId < 2000000000;
      const appid = isRealSteamApp ? rawId : 0;
      const slug = app.display_name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return {
        game_key: isRealSteamApp ? `steam:${appid}` : `ign:${slug}`,
        appid,
        name: app.display_name,
        image: isRealSteamApp
          ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_231x87.jpg`
          : "",
        locationHint: readSteamRichPresenceHint(app.display_name),
      };
    }

    const fallbackId = Number(Router.MainRunningAppID || 0);
    if (fallbackId > 0) {
      const win = window as unknown as {
        appStore?: { GetAppOverviewByAppID?: (id: number) => { display_name?: string; appid?: number } };
      };
      const overview = win.appStore?.GetAppOverviewByAppID?.(fallbackId);
      if (overview?.display_name) {
        const isRealSteamApp = fallbackId < 2000000000;
        const slug = overview.display_name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        return {
          game_key: isRealSteamApp ? `steam:${fallbackId}` : `ign:${slug}`,
          appid: isRealSteamApp ? fallbackId : 0,
          name: overview.display_name,
          image: isRealSteamApp
            ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${fallbackId}/capsule_231x87.jpg`
            : "",
          locationHint: readSteamRichPresenceHint(overview.display_name),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveGuideUrl(
  source: GuideSource | "",
  guideId: string,
  explicitUrl?: string
): string {
  if (explicitUrl && /^https?:\/\//i.test(explicitUrl)) {
    return explicitUrl;
  }
  if (/^https?:\/\//i.test(guideId)) {
    return guideId;
  }
  switch (source) {
    case "ign":
      return `https://www.ign.com/wikis/${guideId.replace(/^\/+/, "")}`;
    case "steam":
      return `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(
        guideId
      )}`;
    case "strategywiki":
      return `https://strategywiki.org/wiki/${encodeURIComponent(
        guideId.replace(/\s+/g, "_")
      )}`;
    default:
      return "";
  }
}

export function openUrlInBrowser(url: string): void {
  if (!url) return;
  Navigation.NavigateToExternalWeb(url);
  Navigation.CloseSideMenus();
}

export function openIgnInBrowser(gameName: string, directUrl?: string): void {
  const url =
    directUrl && directUrl.startsWith("http")
      ? directUrl
      : `https://www.ign.com/search?q=${encodeURIComponent(
          `${gameName.trim()} walkthrough`
        )}`;
  openUrlInBrowser(url);
}

export function openGoogleInBrowser(
  gameName: string,
  locationHint?: string
): void {
  const q = [gameName.trim(), (locationHint || "").trim(), "walkthrough guide"]
    .filter(Boolean)
    .join(" ");
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  openUrlInBrowser(url);
}
