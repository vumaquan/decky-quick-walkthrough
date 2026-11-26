import { executeInTab, injectCssIntoTab, toaster, useQuickAccessVisible } from "@decky/api";
import {
  DialogButton,
  Focusable,
  GamepadButton,
  GamepadEvent,
  Navigation,
  Router,
  Spinner,
  findModuleChild,
  mainBrowserClasses,
} from "@decky/ui";
import { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  FaArrowLeft,
  FaArrowRight,
  FaBookmark,
  FaChevronDown,
  FaChevronUp,
  FaCompress,
  FaExpand,
  FaExternalLinkAlt,
  FaRegBookmark,
  FaSearchMinus,
  FaSearchPlus,
  FaSyncAlt,
} from "react-icons/fa";
import {
  FULL_READER_ROUTE,
  openUrlInBrowser,
  resolveGuideUrl,
  saveProgress,
  setGameBookmarked,
} from "../api";
import {
  patchActiveReaderMeta,
  setQamChromeHidden,
  upsertLocalSavedGame,
  useSharedStore,
} from "../state";
import { ActiveReaderTarget, SavedGameEntry } from "../types";

interface BrowserContainerProps {
  browser: any;
  className?: string;
  visible?: boolean;
  hideForModals?: boolean;
  external?: boolean;
  displayURLBar?: boolean;
  autoFocus?: boolean;
}

const SteamBrowserContainer: FC<BrowserContainerProps> | undefined = findModuleChild(
  (mod) => {
    if (typeof mod !== "object" || !mod) return undefined;
    for (const prop in mod) {
      if (typeof mod[prop] === "function") {
        const fnStr = mod[prop].toString();
        if (fnStr.includes("displayURLBar") && fnStr.includes("BExternalTriggeredLoad()")) {
          return mod[prop];
        }
      }
    }
    return undefined;
  }
);

function cleanGuideTitle(rawTitle: string): string {
  return (rawTitle || "")
    .replace(/\s*[-|•]\s*(IGN|PowerPyx|Game8|PC Gamer|Eurogamer|StrategyWiki).*$/i, "")
    .replace(/^Walkthrough\s*[-:]\s*/i, "")
    .trim();
}

function isGenericName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  return (
    !n ||
    n === "walkthrough" ||
    n === "game" ||
    n === "ign: walkthrough" ||
    n === "google: game" ||
    n.startsWith("search -") ||
    n.startsWith("ign:") ||
    n.startsWith("google:")
  );
}

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13; SteamDeck) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

const ZOOM_STEPS = [65, 75, 85, 95, 100, 115, 130];

async function applyPageZoomAndFit(
  tabTitle: string,
  zoomPct: number,
  fitMode: boolean
) {
  if (!tabTitle) return;
  const zoomRatio = Math.max(0.5, Math.min(1.5, zoomPct / 100));
  const fitRules = fitMode
    ? `
      html, body { max-width: 100% !important; overflow-x: hidden !important; }
      img, video, svg, table, pre, iframe { max-width: 100% !important; }
      [class*="leaderboard"], [id*="leaderboard"], [class*="ad-banner"], [id*="top-ad"], [data-testid*="ad-slot"] {
        display: none !important; height: 0 !important; min-height: 0 !important;
      }
    `
    : "";
  const css = `
    html { zoom: ${zoomRatio} !important; }
    ${fitRules}
  `.trim();

  const jsCode = `(() => {
    try {
      let meta = document.querySelector('meta[name="viewport"]');
      if (${fitMode ? "true" : "false"}) {
        if (!meta) {
          meta = document.createElement('meta');
          meta.name = 'viewport';
          document.head && document.head.appendChild(meta);
        }
        meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=3.0';
      }
      let st = document.getElementById('qw-zoom-fit-style');
      if (!st) {
        st = document.createElement('style');
        st.id = 'qw-zoom-fit-style';
        (document.head || document.documentElement).appendChild(st);
      }
      st.textContent = ${JSON.stringify(css)};
      return true;
    } catch (e) {
      return false;
    }
  })()`;

  try {
    const res = await executeInTab(tabTitle, false, jsCode);
    if (!res?.success) {
      injectCssIntoTab(tabTitle, css);
    }
  } catch {
    try {
      injectCssIntoTab(tabTitle, css);
    } catch {
      // ignore if tab title changed mid-navigation
    }
  }
}

async function safeGetBrowserId(win: any): Promise<number | undefined> {
  const browserApi = win?.SteamClient?.Browser;
  const fn = browserApi?.GetBrowserID;
  if (typeof fn !== "function") return undefined;
  try {
    const res = await Promise.resolve(fn.call(browserApi));
    if (typeof res === "number" && res > 0) return res;
    if (res && typeof res.m_nBrowserID === "number" && res.m_nBrowserID > 0) {
      return res.m_nBrowserID;
    }
    if (res && typeof res.browserID === "number" && res.browserID > 0) {
      return res.browserID;
    }
    if (res && typeof res.nBrowserID === "number" && res.nBrowserID > 0) {
      return res.nBrowserID;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function computeQamScreenRect(
  el: HTMLElement | null,
  winStore: any,
  minTopEl?: HTMLElement | null
): { x: number; y: number; w: number; h: number } | null {
  if (!el) return null;
  const doc = el.ownerDocument;
  const hWin: any = doc?.defaultView || window;
  const domRect = el.getBoundingClientRect();
  if (domRect.width <= 20 || domRect.height <= 20) return null;

  const rx = domRect.left;
  let ry = domRect.top;
  const rw = domRect.width;
  let rh = domRect.height;

  // Never let BrowserView overlap top toolbar or reveal pill
  if (minTopEl) {
    const barRect = minTopEl.getBoundingClientRect();
    if (barRect.width > 20 && barRect.bottom > 0 && ry < barRect.bottom + 2) {
      const delta = barRect.bottom + 2 - ry;
      ry = barRect.bottom + 2;
      rh = Math.max(120, rh - delta);
    }
  }

  const mainInst: any =
    winStore?.GamepadUIMainWindowInstance || winStore?.MainWindowInstance;
  const mWin: any = mainInst?.BrowserWindow;
  const altWin: any = winStore?.MainWindowInstance?.BrowserWindow;

  const hInnerW = Number(hWin?.innerWidth || doc?.documentElement?.clientWidth || 0);
  const hInnerH = Number(hWin?.innerHeight || doc?.documentElement?.clientHeight || 0);
  const hOuterW = Number(hWin?.outerWidth || hInnerW);
  const mInnerW = Number(mWin?.innerWidth || altWin?.innerWidth || 0);
  const mInnerH = Number(mWin?.innerHeight || altWin?.innerHeight || 0);
  const mOuterW = Number(mWin?.outerWidth || altWin?.outerWidth || mInnerW);

  // Determine full display CSS width in the exact same coordinate unit as hInnerW
  const dpr = Number(hWin?.devicePixelRatio || 1) || 1;
  let screenW = 0;
  if (mInnerW > hInnerW + 100) {
    screenW = mInnerW;
  } else if (mOuterW > hInnerW + 100) {
    screenW = mOuterW;
  } else {
    const popups: any[] = (window as any).g_PopupManager?.GetPopups?.() || [];
    for (const pop of popups) {
      const pw = Number(pop?.m_popup?.innerWidth || 0);
      if (pw > hInnerW + 100 && pw < hInnerW * 4.5) {
        screenW = pw;
        break;
      }
    }
  }
  if (!screenW && mainInst?.m_params?.nScreenWidth) {
    const dispScale = Number(mainInst?.m_params?.flDisplayScale || 1) || 1;
    let est = mainInst.m_params.nScreenWidth / dispScale;
    if (hInnerW > 0 && est > hInnerW * 4 && dpr > 1.1) {
      est = est / dpr;
    }
    if (est > hInnerW + 100) screenW = est;
  }
  if (!screenW) {
    const availW = Number(hWin?.screen?.availWidth || hWin?.screen?.width || 0);
    if (hInnerW > 0 && availW > hInnerW * 4 && dpr > 1.1) {
      screenW = availW / dpr;
    } else if (availW > hInnerW + 100) {
      screenW = availW;
    }
  }

  const hPopup = (window as any).g_PopupManager?.GetPopupForWindow?.(hWin);
  const dimLeft = Number(hPopup?.m_rgParams?.dimensions?.left || 0);
  const dimTop = Number(hPopup?.m_rgParams?.dimensions?.top || 0);
  const winScreenX = Number(hWin?.screenX ?? hWin?.screenLeft ?? 0);
  const winScreenY = Number(hWin?.screenY ?? hWin?.screenTop ?? 0);

  // QAM is docked flush to the right edge of the display; map QAM-local coords to global coords
  let originX = 0;
  if (hWin !== mWin) {
    if (winScreenX > 20) {
      originX = winScreenX;
    } else if (dimLeft > 20) {
      originX = dimLeft;
    } else if (screenW > hInnerW + 100 && hInnerW > 0) {
      originX = screenW - hInnerW;
    } else if (mOuterW > hOuterW + 100 && hOuterW > 0) {
      originX = mOuterW - hOuterW;
    }
  }

  let originY = 0;
  if (hWin !== mWin) {
    if (winScreenY > 5) {
      originY = winScreenY;
    } else if (dimTop > 5) {
      originY = dimTop;
    } else if (mInnerH > hInnerH + 40 && hInnerH > 0) {
      originY = mInnerH - hInnerH;
    }
  }

  return {
    x: Math.round(originX + rx),
    y: Math.round(originY + ry),
    w: Math.max(120, Math.round(rw)),
    h: Math.max(120, Math.round(rh)),
  };
}

interface EmbeddedBrowserProps {
  target: ActiveReaderTarget;
  loadKey?: number;
  compact?: boolean;
  suspended?: boolean;
  headerLeft?: ReactNode;
  onProgressSaved?: () => void;
}

export const EmbeddedBrowser: FC<EmbeddedBrowserProps> = ({
  target,
  loadKey = 0,
  compact = true,
  suspended = false,
  headerLeft,
  onProgressSaved,
}) => {
  const { qamChromeHidden } = useSharedStore();
  const chromeHidden = compact && qamChromeHidden;
  const qamVisible = useQuickAccessVisible();
  const initialUrl =
    resolveGuideUrl(target.source, target.guide_id, target.guide_url) ||
    `https://www.google.com/search?q=${encodeURIComponent(
      `${target.game_name} ${target.location_hint || ""} walkthrough`.trim()
    )}`;

  const [browserObj, setBrowserObj] = useState<any>(null);
  const [directPopupReady, setDirectPopupReady] = useState<boolean>(false);
  const [mountSettled, setMountSettled] = useState<boolean>(!compact);
  const [initError, setInitError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>(initialUrl);
  const [pageTitle, setPageTitle] = useState<string>(
    target.guide_title || target.game_name
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [canGoForward, setCanGoForward] = useState<boolean>(false);
  const [bookmarked, setBookmarked] = useState<boolean>(Boolean(target.bookmarked));
  const [zoomPct, setZoomPct] = useState<number>(compact ? 75 : 85);
  const [fitMode, setFitMode] = useState<boolean>(true);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const topAnchorRef = useRef<HTMLDivElement | null>(null);
  const browserRef = useRef<any>(null);
  const popupRef = useRef<any>(null);
  const syncBoundsRef = useRef<(() => void) | null>(null);
  const targetRef = useRef<ActiveReaderTarget>(target);
  const onProgressSavedRef = useRef(onProgressSaved);
  const currentUrlRef = useRef<string>(initialUrl);
  const pageTitleRef = useRef<string>(target.guide_title || target.game_name);
  const bookmarkedRef = useRef<boolean>(Boolean(target.bookmarked));
  const zoomPctRef = useRef<number>(compact ? 75 : 85);
  const fitModeRef = useRef<boolean>(true);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    onProgressSavedRef.current = onProgressSaved;
  }, [onProgressSaved]);

  useEffect(() => {
    zoomPctRef.current = zoomPct;
  }, [zoomPct]);

  useEffect(() => {
    fitModeRef.current = fitMode;
  }, [fitMode]);

  // Reset local URL/bookmark state ONLY when a genuinely new target loadKey arrives
  useEffect(() => {
    const nextUrl =
      resolveGuideUrl(targetRef.current.source, targetRef.current.guide_id, targetRef.current.guide_url) ||
      `https://www.google.com/search?q=${encodeURIComponent(
        `${targetRef.current.game_name} ${targetRef.current.location_hint || ""} walkthrough`.trim()
      )}`;
    const nextTitle = targetRef.current.guide_title || targetRef.current.game_name;
    const nextBookmarked = Boolean(targetRef.current.bookmarked);
    currentUrlRef.current = nextUrl;
    pageTitleRef.current = nextTitle;
    bookmarkedRef.current = nextBookmarked;
    setCurrentUrl(nextUrl);
    setPageTitle(nextTitle);
    setBookmarked(nextBookmarked);
  }, [loadKey]);

  const persistCurrentPage = useCallback(
    async (
      url: string,
      title: string,
      explicitBookmark?: boolean,
      showToast = false
    ) => {
      if (!url || url.startsWith("data:") || url === "about:blank") return;
      const t = targetRef.current;
      const derivedName = isGenericName(t.game_name)
        ? cleanGuideTitle(title) || t.game_name || "Walkthrough"
        : t.game_name;
      const safeKey =
        t.game_key &&
        !t.game_key.endsWith(":walkthrough") &&
        !t.game_key.endsWith(":game")
          ? t.game_key
          : `web:${derivedName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "") || "guide"}`;

      const isBookmarked =
        explicitBookmark !== undefined
          ? explicitBookmark
          : Boolean(bookmarkedRef.current);

      const localEntry: SavedGameEntry = {
        game_key: safeKey,
        appid: t.appid || 0,
        game_name: derivedName,
        game_image: t.game_image || "",
        bookmarked: isBookmarked,
        active_source: "web",
        active_guide_id: url,
        active_guide_title: title || url,
        active_guide_author: "Live Web",
        section_index: 0,
        section_id: "web",
        section_title: title || url,
        total_sections: 1,
        scroll_ratio: 0,
        pinned_sections: [],
        updated_at: Math.floor(Date.now() / 1000),
      };

      // Update local state + localStorage immediately so Đã lưu and reload persistence never lag
      upsertLocalSavedGame(localEntry);
      patchActiveReaderMeta({
        game_key: safeKey,
        game_name: derivedName,
        source: "web",
        guide_id: url,
        guide_url: url,
        guide_title: title || url,
        bookmarked: isBookmarked,
      });

      if (showToast) {
        toaster.toast({
          title: isBookmarked ? "Đã lưu trang web" : "Đã bỏ lưu trang",
          body: title || derivedName,
        });
      }

      try {
        if (explicitBookmark !== undefined) {
          await setGameBookmarked(
            safeKey,
            isBookmarked,
            t.appid || 0,
            derivedName,
            t.game_image || ""
          );
        }
        await saveProgress(
          safeKey,
          t.appid || 0,
          derivedName,
          t.game_image || "",
          "web",
          url,
          title || url,
          "Live Web",
          0,
          "web",
          title || url,
          1,
          0,
          explicitBookmark !== undefined ? isBookmarked : undefined
        );
        onProgressSavedRef.current?.();
      } catch (e: any) {
        console.error("Failed to sync saved page to backend:", e);
      }
    },
    []
  );

  // Brief settle for slide-in animations before mounting SteamBrowserContainer
  useEffect(() => {
    setMountSettled(false);
    const timer = window.setTimeout(() => setMountSettled(true), compact ? 350 : 250);
    return () => window.clearTimeout(timer);
  }, [compact, loadKey]);

  // Create and manage SteamOS Chromium BrowserView bound to the host window (QAM popup vs MainWindow)
  useEffect(() => {
    let disposed = false;
    let created: any = null;
    let directPopup: any = null;
    let bvApiUsed: any = null;
    let resizeObs: ResizeObserver | null = null;
    const timers: number[] = [];
    let removeScrollListener: (() => void) | null = null;

    const bindPopupEvents = (popup: any, ownerCreated?: any) => {
      if (!popup) return;
      popup.SetWindowStackingOrder?.(1);
      popup.EnableSteamInput?.();
      popup.SetTouchGesturesToCancel?.([]);
      popup.SetVisible?.((compact ? Boolean(qamVisible) : true) && !suspended);
      if (typeof popup.on === "function") {
        popup.on("start-loading", () => {
          if (disposed) return;
          setLoading(true);
          setLoadError(null);
        });
        popup.on("finished-request", (url: string) => {
          if (disposed) return;
          setLoading(false);
          popup.SetWindowStackingOrder?.(1);
          if (url && !url.startsWith("data:") && url !== "about:blank") {
            currentUrlRef.current = url;
            setCurrentUrl(url);
            persistCurrentPage(url, pageTitleRef.current);
            window.setTimeout(() => {
              if (!disposed) {
                applyPageZoomAndFit(
                  pageTitleRef.current,
                  zoomPctRef.current,
                  fitModeRef.current
                );
              }
            }, 180);
          }
          setCanGoBack(
            Boolean(ownerCreated?.CanGoBackward?.() || popup.CanGoBackward?.())
          );
          setCanGoForward(
            Boolean(ownerCreated?.CanGoForward?.() || popup.CanGoForward?.())
          );
        });
        popup.on("set-title", (title: string) => {
          if (disposed || !title || title.startsWith("data:")) return;
          if (title !== pageTitleRef.current) {
            pageTitleRef.current = title;
            setPageTitle(title);
            persistCurrentPage(currentUrlRef.current, title);
            applyPageZoomAndFit(title, zoomPctRef.current, fitModeRef.current);
          }
        });
        popup.on("can-go-back-forward-changed", (back: boolean, fwd: boolean) => {
          if (disposed) return;
          setCanGoBack(Boolean(back));
          setCanGoForward(Boolean(fwd));
        });
        popup.on("new-tab", (newUrl: string) => {
          if (disposed) return;
          if (newUrl && /^https?:\/\//i.test(newUrl)) {
            (ownerCreated || popup).LoadURL?.(newUrl);
          }
        });
        popup.on("load-error", (_code: number, errUrl: string, desc: string) => {
          if (disposed) return;
          setLoading(false);
          setLoadError(desc ? `${desc} (${errUrl})` : `Không tải được ${errUrl}`);
        });
      }
    };

    const initBrowser = async () => {
      try {
        const hostWin: any = hostRef.current?.ownerDocument?.defaultView || window;
        const winStore = Router.WindowStore;
        const startUrl = currentUrlRef.current || initialUrl;

        // In QAM (compact), QAM lives inside a separate QuickAccess popup window.
        // Attach BrowserView to QAM's own parentPopupBrowserID and sync bounds directly.
        if (compact) {
          const popupMgr = (window as any).g_PopupManager;
          const hostPopup = popupMgr?.GetPopupForWindow?.(hostWin);
          let hostBrowserId: number | undefined =
            hostPopup?.m_rgParams?.target_browser?.m_nBrowserID;
          if (!hostBrowserId) {
            hostBrowserId = await safeGetBrowserId(hostWin);
          }
          if (!hostBrowserId) {
            hostBrowserId = await safeGetBrowserId(window);
          }

          const bvApi =
            hostWin?.SteamClient?.BrowserView ||
            (window as any).SteamClient?.BrowserView;

          if (hostBrowserId && bvApi && typeof bvApi.Create === "function") {
            let p: any = null;
            try {
              p = bvApi.Create.call(bvApi, {
                parentPopupBrowserID: hostBrowserId,
                strInitialURL: startUrl,
                ...(fitMode ? { strUserAgentOverride: MOBILE_UA } : {}),
              });
            } catch (bvErr) {
              console.warn("Direct QAM BrowserView.Create failed, falling back:", bvErr);
              p = null;
            }
            if (disposed) {
              try {
                p?.SetVisible?.(false);
                bvApi.Destroy?.call(bvApi, p);
              } catch {
                // ignore
              }
              return;
            }
            if (p) {
              directPopup = p;
              bvApiUsed = bvApi;
              popupRef.current = p;
              browserRef.current = null;
              setBrowserObj(null);
              setDirectPopupReady(true);
              setInitError(null);

              const syncBounds = () => {
                if (!directPopup || disposed) return;
                const mapped = computeQamScreenRect(
                  hostRef.current,
                  winStore,
                  topAnchorRef.current
                );
                if (!mapped) return;
                directPopup.SetBounds?.(mapped.x, mapped.y, mapped.w, mapped.h);
                directPopup.SetWindowStackingOrder?.(1);
              };
              syncBoundsRef.current = syncBounds;

              bindPopupEvents(p);
              syncBounds();
              p.LoadURL?.(startUrl);
              persistCurrentPage(startUrl, pageTitleRef.current);

              for (const delay of [80, 220, 450, 850, 1400]) {
                timers.push(window.setTimeout(syncBounds, delay));
              }
              if (typeof ResizeObserver !== "undefined" && hostRef.current) {
                resizeObs = new ResizeObserver(syncBounds);
                resizeObs.observe(hostRef.current);
              }
              const doc = hostRef.current?.ownerDocument;
              if (doc) {
                doc.addEventListener("scroll", syncBounds, true);
                removeScrollListener = () =>
                  doc.removeEventListener("scroll", syncBounds, true);
              }
              return;
            }
          }
        }

        // Fullscreen / SteamBrowserContainer path (GamepadUIMainWindowInstance)
        if (!SteamBrowserContainer) {
          setInitError("Steam BrowserContainer không khả dụng ở giao diện này.");
          return;
        }

        const winInst =
          winStore?.GamepadUIMainWindowInstance ||
          winStore?.GetWindowInstanceFromWindow?.(hostWin) ||
          winStore?.MainWindowInstance;

        if (!winInst || typeof winInst.CreateBrowserView !== "function") {
          setInitError("WindowStore.CreateBrowserView không khả dụng.");
          return;
        }

        created = winInst.CreateBrowserView("QuickWalkthrough", {
          strInitialURL: startUrl,
          ...(fitMode ? { strUserAgentOverride: MOBILE_UA } : {}),
        });
        if (disposed) {
          const p = created?.GetBrowser?.() || created?.m_browserView;
          p?.SetVisible?.(false);
          created?.Destroy?.();
          return;
        }
        if (!created) {
          setInitError("Không thể khởi tạo BrowserView.");
          return;
        }

        browserRef.current = created;
        const popup = created.GetBrowser?.() || created.m_browserView;
        popupRef.current = popup;

        // Intercept SteamBrowserContainer's SetBounds in QAM so MainWindow-attached BrowserView
        // always uses hostRef's true DOM bounds (never stale unmapped rects) & never covers top toolbars.
        if (compact && popup && typeof popup.SetBounds === "function") {
          const origSetBounds = popup.SetBounds.bind(popup);
          const syncContainerBounds = () => {
            if (disposed) return;
            const mapped = computeQamScreenRect(
              hostRef.current,
              winStore,
              topAnchorRef.current
            );
            if (mapped) {
              origSetBounds(mapped.x, mapped.y, mapped.w, mapped.h);
              popup.SetWindowStackingOrder?.(1);
            }
          };
          syncBoundsRef.current = syncContainerBounds;
          popup.SetBounds = () => {
            syncContainerBounds();
          };
          for (const delay of [60, 180, 380, 750, 1300]) {
            timers.push(window.setTimeout(syncContainerBounds, delay));
          }
          if (typeof ResizeObserver !== "undefined" && hostRef.current) {
            resizeObs = new ResizeObserver(syncContainerBounds);
            resizeObs.observe(hostRef.current);
          }
        }

        setDirectPopupReady(false);
        setBrowserObj(created);
        setInitError(null);

        bindPopupEvents(popup, created);
        created.LoadURL?.(startUrl);
        persistCurrentPage(startUrl, pageTitleRef.current);
      } catch (e: any) {
        if (!disposed) {
          setInitError(e?.message || "Lỗi khởi tạo trình duyệt nhúng.");
        }
      }
    };

    initBrowser();

    return () => {
      disposed = true;
      for (const t of timers) window.clearTimeout(t);
      resizeObs?.disconnect();
      removeScrollListener?.();
      try {
        if (directPopup) {
          directPopup.SetVisible?.(false);
          bvApiUsed?.Destroy?.call(bvApiUsed, directPopup);
        }
        if (created) {
          const popup = created?.GetBrowser?.() || created?.m_browserView;
          popup?.SetVisible?.(false);
          created?.Destroy?.();
        }
      } catch (e) {
        console.error("Error destroying BrowserView:", e);
      }
      browserRef.current = null;
      popupRef.current = null;
      syncBoundsRef.current = null;
      setDirectPopupReady(false);
    };
  }, [loadKey, compact, fitMode, persistCurrentPage]);

  // Apply zoom/fit CSS live whenever zoomPct or fitMode changes
  useEffect(() => {
    applyPageZoomAndFit(pageTitleRef.current, zoomPct, fitMode);
  }, [zoomPct, fitMode]);

  // Sync BrowserView visibility with QAM state and overlay drawer state
  const hostDocHidden = Boolean(hostRef.current?.ownerDocument?.hidden);
  const isBrowserVisible =
    (compact ? Boolean(qamVisible) || !hostDocHidden : true) && !suspended;
  useEffect(() => {
    const popup =
      popupRef.current ||
      browserRef.current?.GetBrowser?.() ||
      browserRef.current?.m_browserView;
    if (!popup) return;
    try {
      if (isBrowserVisible) {
        popup.SetWindowStackingOrder?.(1);
        syncBoundsRef.current?.();
      }
      popup.SetVisible?.(isBrowserVisible);
    } catch {
      // ignore
    }
  }, [isBrowserVisible, chromeHidden]);

  // Re-sync BrowserView bounds immediately whenever chrome auto-hide changes height
  useEffect(() => {
    if (!compact || suspended) return;
    syncBoundsRef.current?.();
    const t = window.setTimeout(() => syncBoundsRef.current?.(), 60);
    return () => window.clearTimeout(t);
  }, [compact, suspended, chromeHidden]);

  const handleToggleBookmark = async () => {
    const next = !bookmarked;
    setBookmarked(next);
    bookmarkedRef.current = next;
    await persistCurrentPage(
      currentUrlRef.current,
      pageTitleRef.current,
      next,
      true
    );
  };

  const handleOpenFullscreen = () => {
    patchActiveReaderMeta({
      source: "web",
      guide_id: currentUrlRef.current,
      guide_url: currentUrlRef.current,
      guide_title: pageTitleRef.current,
      view_mode: "browser",
      bookmarked: bookmarkedRef.current,
    });
    Navigation.Navigate(FULL_READER_ROUTE);
    Navigation.CloseSideMenus();
  };

  const sendKey = (hidCode: number) => {
    try {
      SteamClient.Input.ControllerKeyboardSetKeyState(hidCode as any, true);
      SteamClient.Input.ControllerKeyboardSetKeyState(hidCode as any, false);
    } catch {
      // ignore
    }
  };

  const handleDirection = (evt: GamepadEvent) => {
    const level = browserRef.current?.GetGameInputSupportLevel?.();
    if (level === 4) return;
    switch (evt.detail.button) {
      case GamepadButton.DIR_UP:
        sendKey(75); // Page Up
        break;
      case GamepadButton.DIR_DOWN:
        sendKey(78); // Page Down
        break;
      case GamepadButton.DIR_LEFT:
        sendKey(80); // Left Arrow
        break;
      case GamepadButton.DIR_RIGHT:
        sendKey(79); // Right Arrow
        break;
    }
  };

  const handleStepZoom = (delta: number) => {
    setZoomPct((prev) => {
      const idx = ZOOM_STEPS.findIndex((z) => z >= prev);
      const curIdx = idx >= 0 ? idx : ZOOM_STEPS.indexOf(100);
      const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, curIdx + delta));
      return ZOOM_STEPS[nextIdx];
    });
  };

  const handleCycleCompactZoom = () => {
    const presets = [65, 75, 85, 100];
    setZoomPct((prev) => {
      const idx = presets.indexOf(prev);
      return presets[(idx + 1) % presets.length];
    });
  };

  const navTarget = () => browserRef.current || popupRef.current;
  const BrowserViewComponent = SteamBrowserContainer;

  if (initError || (!compact && !BrowserViewComponent)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "8px 0" }}>
        {headerLeft}
        <div style={{ fontSize: "12px", color: "#ff8a8a", lineHeight: 1.4 }}>
          {initError || "BrowserContainer không khả dụng."}
        </div>
        <Focusable flow-children="horizontal" style={{ display: "flex", gap: "6px" }}>
          {compact ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogButton
                onClick={handleOpenFullscreen}
                style={{ width: "100%", minWidth: 0, padding: "6px 6px", fontSize: "11px" }}
              >
                Đọc (Toàn màn hình)
              </DialogButton>
            </div>
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <DialogButton
              onClick={() => openUrlInBrowser(currentUrl)}
              style={{ width: "100%", minWidth: 0, padding: "6px 6px", fontSize: "11px" }}
            >
              Mở trình duyệt Steam
            </DialogButton>
          </div>
        </Focusable>
      </div>
    );
  }

  const rowBtnStyle = {
    width: "100%",
    minWidth: 0,
    height: compact ? "26px" : "28px",
    minHeight: compact ? "26px" : "28px",
    maxHeight: compact ? "26px" : "28px",
    lineHeight: 1,
    padding: compact ? "0 3px" : "0 5px",
    margin: 0,
    boxSizing: "border-box" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const navButtons = (
    <>
      {headerLeft}
      <div style={{ width: compact ? "24px" : "28px", height: rowBtnStyle.height, flexShrink: 0 }}>
        <DialogButton
          disabled={!canGoBack}
          onClick={() => navTarget()?.GoBack?.()}
          style={rowBtnStyle}
        >
          <FaArrowLeft size={9} />
        </DialogButton>
      </div>
      <div style={{ width: compact ? "24px" : "28px", height: rowBtnStyle.height, flexShrink: 0 }}>
        <DialogButton
          disabled={!canGoForward}
          onClick={() => navTarget()?.GoForward?.()}
          style={rowBtnStyle}
        >
          <FaArrowRight size={9} />
        </DialogButton>
      </div>
      <div style={{ width: compact ? "24px" : "28px", height: rowBtnStyle.height, flexShrink: 0 }}>
        <DialogButton
          onClick={() =>
            popupRef.current?.Reload?.() ??
            browserRef.current?.GetBrowser?.()?.Reload?.() ??
            navTarget()?.LoadURL?.(currentUrl)
          }
          style={rowBtnStyle}
        >
          <FaSyncAlt size={9} />
        </DialogButton>
      </div>
      <div style={{ width: compact ? "24px" : "64px", height: rowBtnStyle.height, flexShrink: 0 }}>
        <DialogButton
          onClick={handleToggleBookmark}
          style={{
            ...rowBtnStyle,
            fontSize: "10px",
            gap: "3px",
            backgroundColor: bookmarked ? "rgba(245, 197, 66, 0.2)" : undefined,
          }}
        >
          {bookmarked ? (
            <FaBookmark size={9} color="#f5c542" />
          ) : (
            <FaRegBookmark size={9} />
          )}
          {!compact ? <span>{bookmarked ? "Đã lưu" : "Lưu"}</span> : null}
        </DialogButton>
      </div>
    </>
  );

  const zoomAndFitControls = (
    <>
      <div style={{ width: "24px", height: rowBtnStyle.height, flexShrink: 0 }}>
        <DialogButton
          onClick={() => handleStepZoom(-1)}
          style={rowBtnStyle}
        >
          <FaSearchMinus size={9} />
        </DialogButton>
      </div>
      <div
        style={{
          minWidth: "30px",
          textAlign: "center",
          fontSize: "10px",
          fontWeight: 700,
          color: "#c7d5e0",
          flexShrink: 0,
        }}
      >
        {zoomPct}%
      </div>
      <div style={{ width: "24px", height: rowBtnStyle.height, flexShrink: 0 }}>
        <DialogButton
          onClick={() => handleStepZoom(1)}
          style={rowBtnStyle}
        >
          <FaSearchPlus size={9} />
        </DialogButton>
      </div>
      <div style={{ width: "42px", height: rowBtnStyle.height, flexShrink: 0 }}>
        <DialogButton
          onClick={() => setFitMode((prev) => !prev)}
          style={{
            ...rowBtnStyle,
            fontSize: "10px",
            gap: "3px",
            backgroundColor: fitMode ? "rgba(102, 192, 244, 0.28)" : undefined,
          }}
        >
          <FaCompress size={9} />
          <span>Fit</span>
        </DialogButton>
      </div>
    </>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        height: compact ? undefined : "100%",
        minHeight: compact ? undefined : 0,
      }}
    >
      {/* Slim Reveal Bar when both top rows auto-hide during downward scroll in QAM */}
      {compact && chromeHidden ? (
        <div ref={topAnchorRef} style={{ width: "100%", flexShrink: 0 }}>
          <DialogButton
            onClick={() => setQamChromeHidden(false)}
            style={{
              width: "100%",
              minWidth: 0,
              height: "18px",
              minHeight: "18px",
              maxHeight: "18px",
              padding: "0",
              fontSize: "9px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              backgroundColor: "rgba(255,255,255,0.08)",
            }}
          >
            <FaChevronDown size={8} />
            <span>Hiện thanh công cụ</span>
          </DialogButton>
        </div>
      ) : (
        /* Toolbar (single uniform-height row in both QAM and Fullscreen) */
        <div ref={topAnchorRef} style={{ width: "100%", flexShrink: 0 }}>
          <Focusable
            flow-children="horizontal"
            style={{
              display: "flex",
              gap: "3px",
              width: "100%",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            {navButtons}

            {!compact ? (
              <>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: rowBtnStyle.height,
                    lineHeight: rowBtnStyle.height,
                    fontSize: "11px",
                    color: "#c7d5e0",
                    backgroundColor: "rgba(0,0,0,0.32)",
                    padding: "0 8px",
                    borderRadius: "4px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {loading ? "⏳ " : ""}
                  {pageTitle || currentUrl}
                </div>
                {zoomAndFitControls}
              </>
            ) : (
              <>
                <div style={{ width: "34px", height: rowBtnStyle.height, flexShrink: 0 }}>
                  <DialogButton
                    onClick={handleCycleCompactZoom}
                    style={{
                      ...rowBtnStyle,
                      fontSize: "9px",
                      fontWeight: 700,
                    }}
                  >
                    {zoomPct}%
                  </DialogButton>
                </div>
                <div style={{ width: "30px", height: rowBtnStyle.height, flexShrink: 0 }}>
                  <DialogButton
                    onClick={() => setFitMode((prev) => !prev)}
                    style={{
                      ...rowBtnStyle,
                      fontSize: "9px",
                      backgroundColor: fitMode ? "rgba(102, 192, 244, 0.28)" : undefined,
                    }}
                  >
                    Fit
                  </DialogButton>
                </div>
                <div style={{ flex: 1, minWidth: 0, height: rowBtnStyle.height }}>
                  <DialogButton
                    onClick={handleOpenFullscreen}
                    style={{
                      ...rowBtnStyle,
                      fontSize: "10px",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      gap: "3px",
                      backgroundColor: "rgba(102, 192, 244, 0.22)",
                    }}
                  >
                    <FaExpand size={9} />
                    <span>Đọc</span>
                  </DialogButton>
                </div>
              </>
            )}

            <div style={{ width: compact ? "24px" : "28px", height: rowBtnStyle.height, flexShrink: 0 }}>
              <DialogButton
                onClick={() => openUrlInBrowser(currentUrl)}
                style={rowBtnStyle}
              >
                <FaExternalLinkAlt size={9} />
              </DialogButton>
            </div>
            {compact ? (
              <div style={{ width: "22px", height: rowBtnStyle.height, flexShrink: 0 }}>
                <DialogButton
                  onClick={() => setQamChromeHidden(true)}
                  style={rowBtnStyle}
                >
                  <FaChevronUp size={8} />
                </DialogButton>
              </div>
            ) : null}
          </Focusable>
        </div>
      )}

      {loadError ? (
        <div style={{ fontSize: "11px", color: "#ff8a8a", flexShrink: 0 }}>
          Lỗi tải trang: {loadError}
        </div>
      ) : null}

      {/* Reset Steam BrowserContainer header/top padding so no blank strip wastes space */}
      <style>{`
        .qw-browser-host > div,
        .qw-browser-host > div > div {
          padding-top: 0 !important;
          margin-top: 0 !important;
          height: 100% !important;
        }
      `}</style>

      {/* Native SteamOS Chromium BrowserView Host */}
      <div
        ref={hostRef}
        className="qw-browser-host"
        onClick={() => {
          popupRef.current?.SetFocus?.(true);
          popupRef.current?.NotifyUserActivation?.();
        }}
        style={{
          position: "relative",
          width: "100%",
          height: compact
            ? chromeHidden
              ? "calc(100vh - 54px)"
              : "calc(100vh - 90px)"
            : undefined,
          minHeight: compact ? (chromeHidden ? "590px" : "555px") : 0,
          flex: compact ? undefined : 1,
          borderRadius: compact ? "2px" : "4px",
          overflow: "hidden",
          backgroundColor: "#0e141b",
          border: compact ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {directPopupReady ? (
          <Focusable
            noFocusRing={true}
            style={{ position: "relative", width: "100%", height: "100%" }}
            onFocus={() => {
              popupRef.current?.SetFocus?.(true);
            }}
            onOKButton={() => {
              popupRef.current?.SetFocus?.(true);
              popupRef.current?.NotifyUserActivation?.();
              sendKey(88);
            }}
            onGamepadDirection={handleDirection}
          >
            <div style={{ width: "100%", height: "100%", backgroundColor: "#0e141b" }} />
          </Focusable>
        ) : !browserObj || !mountSettled || !BrowserViewComponent ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#0e141b",
            }}
          >
            <div style={{ width: "26px", height: "26px" }}>
              <Spinner style={{ width: "26px", height: "26px" }} />
            </div>
          </div>
        ) : (
          <Focusable
            noFocusRing={true}
            className="qw-browser-host"
            style={{ position: "relative", width: "100%", height: "100%" }}
            onOKButton={() => sendKey(88)}
            onGamepadDirection={handleDirection}
          >
            <BrowserViewComponent
              browser={browserObj}
              className={[
                mainBrowserClasses?.BrowserContainer,
                mainBrowserClasses?.Visible,
              ]
                .filter(Boolean)
                .join(" ")}
              visible={isBrowserVisible}
              hideForModals={true}
              external={false}
              displayURLBar={false}
              autoFocus={false}
            />
          </Focusable>
        )}
      </div>
    </div>
  );
};
