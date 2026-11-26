import { callable, executeInTab, fetchNoCors } from "@decky/api";
import { Navigation, Router } from "@decky/ui";
import { getStrings, loadStoredLanguage } from "./i18n";
import {
  GameSearchResult,
  GuideContent,
  GuideSource,
  GuideSummary,
  LibraryState,
  ListGuidesResponse,
  PinnedSection,
  PluginSettings,
  QuickSearchSourceOption,
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

const GOOGLE_SEARCH_CACHE = new Map<string, { ts: number; items: GuideSummary[] }>();

/**
 * Queries live Google Search via Steam's built-in Chromium BrowserView and extracts
 * organic search result links + snippets without touching any CAPTCHA or bot gate.
 */
export async function searchGoogleViaBrowserView(
  searchQuery: string,
  appid = 0,
  gameName = "",
  timeoutMs = 7500
): Promise<GuideSummary[]> {
  const cleanQ = searchQuery.trim();
  if (!cleanQ) return [];

  const cacheKey = `${cleanQ.toLowerCase()}::${appid}`;
  const cached = GOOGLE_SEARCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < 45000) {
    return cached.items;
  }

  const winInst =
    Router.WindowStore?.GamepadUIMainWindowInstance ||
    Router.WindowStore?.MainWindowInstance;
  if (!winInst || typeof winInst.CreateBrowserView !== "function") {
    return [];
  }

  const url = `https://www.google.com/search?q=${encodeURIComponent(cleanQ)}`;
  const extractJs = `(() => {
    try {
      const out = [];
      const seen = new Set();
      const anchors = document.querySelectorAll('#search a, #rso a, main a');
      for (const a of anchors) {
        const h3 = a.querySelector('h3');
        if (!h3) continue;
        const href = a.href || '';
        if (!href || !/^https?:\\/\\//i.test(href)) continue;
        if (
          href.includes('google.com/search') ||
          href.includes('accounts.google.') ||
          href.includes('support.google.') ||
          href.includes('policies.google.') ||
          href.includes('maps.google.')
        ) {
          continue;
        }
        if (seen.has(href)) continue;
        seen.add(href);
        const title = (h3.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!title) continue;
        const block = a.closest('.g, [data-hveid], .MjjYud') || (a.parentElement && a.parentElement.parentElement);
        let snippet = '';
        if (block) {
          const snipEl = block.querySelector('.VwiC3b, [data-sncf="1"], [data-sncf], .IsZvec');
          if (snipEl) snippet = (snipEl.textContent || '').replace(/\\s+/g, ' ').trim();
        }
        out.push({ title, url: href, snippet });
        if (out.length >= 12) break;
      }
      return JSON.stringify(out);
    } catch (e) {
      return '[]';
    }
  })()`;

  let created: any = null;
  return await new Promise<GuideSummary[]>((resolve) => {
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

    const finish = (items: GuideSummary[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(hardTimer);
      cleanup();
      if (items.length > 0) {
        GOOGLE_SEARCH_CACHE.set(cacheKey, { ts: Date.now(), items });
      }
      resolve(items);
    };

    const tryCaptureResults = async () => {
      if (settled || !latestTitle) return;
      try {
        const res = await executeInTab(latestTitle, false, extractJs);
        if (settled || !res?.success || typeof res.result !== "string") return;
        const parsed = JSON.parse(res.result);
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        const mapped: GuideSummary[] = parsed
          .filter((item: any) => item && typeof item.url === "string" && typeof item.title === "string")
          .map((item: any, idx: number) => {
            let domain = "google.com";
            try {
              domain = new URL(item.url).hostname.replace(/^www\./, "");
            } catch {
              // ignore
            }
            return {
              guide_id: item.url,
              source: "google" as GuideSource,
              title: item.title,
              author: domain || "Google",
              description: item.snippet || "",
              rating_stars: 0,
              url: item.url,
              appid,
              game_name: gameName || cleanQ,
              game_image: "",
              match_score: 200 - idx,
              match_reason: "",
            };
          });
        if (mapped.length > 0) {
          finish(mapped);
        }
      } catch {
        // wait for retry or timeout fallback
      }
    };

    const hardTimer = window.setTimeout(() => {
      finish([]);
    }, timeoutMs);

    try {
      created = winInst.CreateBrowserView("QuickWalkthroughGoogleSearch", {
        strInitialURL: url,
      });
      if (!created) {
        finish([]);
        return;
      }
      const popup = created.GetBrowser?.() || created.m_browserView;
      popup?.SetVisible?.(false);

      if (popup && typeof popup.on === "function") {
        popup.on("set-title", (title: string) => {
          if (title && !title.startsWith("data:")) {
            latestTitle = title;
            if (grabScheduled && !settled) {
              window.setTimeout(() => tryCaptureResults(), 350);
            }
          }
        });
        popup.on("finished-request", (loadedUrl: string) => {
          if (!loadedUrl || loadedUrl === "about:blank" || loadedUrl.startsWith("data:")) {
            return;
          }
          if (/google\.com\/sorry|consent\.google\./i.test(loadedUrl)) {
            finish([]);
            return;
          }
          grabScheduled = true;
          window.setTimeout(() => tryCaptureResults(), 450);
          window.setTimeout(() => tryCaptureResults(), 1200);
        });
        popup.on("load-error", () => {
          finish([]);
        });
      }

      created.LoadURL?.(url);
    } catch {
      finish([]);
    }
  });
}

export function buildQuickSearchUrl(
  source: QuickSearchSourceOption,
  gameName: string,
  hint = "",
  appid = 0,
  wikiSlug = ""
): { url: string; labelPrefix: string } {
  const cleanGame = gameName.trim() || "walkthrough";
  const cleanHint = hint.trim();
  const qWithHint = [cleanGame, cleanHint].filter(Boolean).join(" ");
  const qWalkthrough = [cleanGame, cleanHint, "walkthrough"].filter(Boolean).join(" ");

  switch (source) {
    case "powerpyx":
      return {
        url: `https://www.powerpyx.com/?s=${encodeURIComponent(qWithHint)}`,
        labelPrefix: "PowerPyx",
      };
    case "pcgamer":
      return {
        url: `https://www.pcgamer.com/search/?searchTerm=${encodeURIComponent(qWalkthrough)}`,
        labelPrefix: "PC Gamer",
      };
    case "game8":
      return {
        url: `https://game8.co/search?q=${encodeURIComponent(qWithHint)}`,
        labelPrefix: "Game8",
      };
    case "steam":
      return {
        url:
          appid > 0
            ? `https://steamcommunity.com/app/${appid}/guides/?searchText=${encodeURIComponent(
                cleanHint || "walkthrough"
              )}&browsesort=toprated`
            : `https://steamcommunity.com/search/guides/?text=${encodeURIComponent(qWithHint)}`,
        labelPrefix: "Steam",
      };
    case "gamefaqs":
      return {
        url: `https://gamefaqs.gamespot.com/search?game=${encodeURIComponent(cleanGame)}`,
        labelPrefix: "GameFAQs",
      };
    case "strategywiki":
      return {
        url: `https://strategywiki.org/w/index.php?search=${encodeURIComponent(qWithHint)}`,
        labelPrefix: "StrategyWiki",
      };
    case "ign":
    default:
      return {
        url: wikiSlug
          ? `https://www.ign.com/wikis/${wikiSlug}`
          : `https://www.ign.com/search?q=${encodeURIComponent(qWithHint)}`,
        labelPrefix: "IGN",
      };
  }
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
