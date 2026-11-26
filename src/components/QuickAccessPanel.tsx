import { toaster, useQuickAccessVisible } from "@decky/api";
import {
  ButtonItem,
  DialogButton,
  DropdownItem,
  Focusable,
  PanelSection,
  PanelSectionRow,
  ProgressBar,
  Spinner,
  TextField,
  ToggleField,
} from "@decky/ui";
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaBookmark,
  FaBookOpen,
  FaExternalLinkAlt,
  FaGamepad,
  FaGlobe,
  FaPlay,
  FaRegBookmark,
  FaSearch,
  FaStar,
  FaTimesCircle,
  FaTrash,
} from "react-icons/fa";
import {
  NetworkDiagResult,
  RunningGameInfo,
  buildQuickSearchUrl,
  clearCache,
  diagnoseNetwork,
  getLibrary,
  getRunningGame,
  listGuides,
  openGoogleInBrowser,
  openUrlInBrowser,
  removeGame,
  resolveGuideUrl,
  searchGoogleViaBrowserView,
  searchWalkthroughs,
  setGameBookmarked,
  updateSettings,
  withTimeout,
} from "../api";
import { formatRelativeTime, getStrings } from "../i18n";
import {
  mergeLibraryGames,
  removeLocalSavedGame,
  setActiveReaderTarget,
  setQamTab,
  setSharedSettings,
  upsertLocalSavedGame,
  useSharedStore,
} from "../state";
import {
  ActiveReaderTarget,
  FontSizeOption,
  GameSearchResult,
  GuideSource,
  GuideSummary,
  LanguageOption,
  PluginSettings,
  QuickSearchSourceOption,
  SavedGameEntry,
  TranslateLangOption,
} from "../types";
import { EmbeddedBrowser } from "./EmbeddedBrowser";

function calcOverallProgress(entry: SavedGameEntry): number {
  if (!entry.total_sections || entry.total_sections <= 0) return 0;
  const secShare = 100 / entry.total_sections;
  const pct = entry.section_index * secShare + (entry.scroll_ratio || 0) * secShare;
  return Math.max(2, Math.min(100, Math.round(pct)));
}

function sourceBadge(source: GuideSource, author?: string): { label: string; color: string } {
  switch (source) {
    case "google":
      return { label: "Google", color: "#fbbc04" };
    case "ign":
      return { label: "IGN Wiki", color: "#ff6b6b" };
    case "web":
      return { label: author || "Web Guide", color: "#c084fc" };
    case "steam":
      return { label: "Steam Guide", color: "#66c0f4" };
    case "strategywiki":
      return { label: "StrategyWiki", color: "#80e27e" };
  }
}

const CompactSpinner: FC<{ text?: string }> = ({ text }) => (
  <div
    style={{
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      padding: "14px 8px",
    }}
  >
    <div style={{ width: "24px", height: "24px", flexShrink: 0 }}>
      <Spinner style={{ width: "24px", height: "24px" }} />
    </div>
    {text ? <span style={{ fontSize: "12px", color: "#b8bcbf" }}>{text}</span> : null}
  </div>
);

export const QuickAccessPanel: FC = () => {
  const qamVisible = useQuickAccessVisible();
  const readerWrapRef = useRef<HTMLDivElement | null>(null);
  const {
    activeTarget,
    targetLoadVersion,
    activeTab: tab,
    settings,
    savedGames: games,
  } = useSharedStore();
  const s = getStrings(settings.language);
  const sRef = useRef(s);
  sRef.current = s;
  const setTab = setQamTab;

  // Whenever user switches to Đọc (including from Đã lưu scrolled down), reset QAM scroll to top
  useEffect(() => {
    if (tab !== "reader") return;
    const resetAncestorsScroll = () => {
      let node: HTMLElement | null = readerWrapRef.current;
      while (node) {
        if (node.scrollTop > 0) {
          node.scrollTop = 0;
        }
        node = node.parentElement;
      }
    };
    resetAncestorsScroll();
    const t = window.setTimeout(resetAncestorsScroll, 60);
    return () => window.clearTimeout(t);
  }, [tab, targetLoadVersion]);

  const [libraryLoading, setLibraryLoading] = useState(games.length === 0);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [runningGame, setRunningGame] = useState<RunningGameInfo | null>(() =>
    getRunningGame()
  );

  // Search state (unified 1-step walkthrough search)
  const [query, setQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<GameSearchResult | null>(null);
  const [guideSearchText, setGuideSearchText] = useState("");
  const [loadingGuides, setLoadingGuides] = useState(false);
  const [hasSearchedGuides, setHasSearchedGuides] = useState(false);
  const [guidesError, setGuidesError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [fallbackAllGuides, setFallbackAllGuides] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResults, setDiagResults] = useState<NetworkDiagResult[] | null>(null);
  const searchReqIdRef = useRef(0);
  const autoSyncedGameKeyRef = useRef("");
  const lastSyncedHintRef = useRef("");
  const autoSearchedKeyRef = useRef("");

  const refreshLibrary = useCallback(async () => {
    setLibraryError(null);
    try {
      const lib = await withTimeout(
        getLibrary(),
        8000,
        sRef.current.errBackendNoResponse
      );
      mergeLibraryGames(lib.games || []);
      if (lib.settings) {
        setSharedSettings(lib.settings);
      }
    } catch (e: any) {
      console.error("Failed to load library:", e);
      if (games.length === 0) {
        setLibraryError(e?.message || sRef.current.errBackendConnect);
      }
    } finally {
      setLibraryLoading(false);
    }
  }, [games.length]);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    setRunningGame(getRunningGame());
    if (qamVisible || tab === "library") {
      refreshLibrary();
    }
  }, [qamVisible, tab, refreshLibrary]);

  const runningSavedEntry = useMemo(() => {
    if (!runningGame) return null;
    return (
      games.find(
        (g) =>
          g.game_key === runningGame.game_key ||
          (runningGame.appid > 0 && g.appid === runningGame.appid) ||
          g.game_name.toLowerCase() === runningGame.name.toLowerCase()
      ) || null
    );
  }, [runningGame, games]);

  const openSavedEntry = useCallback((entry: SavedGameEntry) => {
    if (!entry.active_guide_id || !entry.active_source) return;
    const target: ActiveReaderTarget = {
      game_key: entry.game_key,
      appid: entry.appid,
      game_name: entry.game_name,
      game_image: entry.game_image,
      source: entry.active_source,
      guide_id: entry.active_guide_id,
      guide_title: entry.active_guide_title,
      guide_author: entry.active_guide_author,
      view_mode: "browser",
      bookmarked: entry.bookmarked,
    };
    setActiveReaderTarget(target);
    setTab("reader");
  }, []);

  const openEmbeddedUrl = useCallback(
    (url: string, title: string, gameInfo?: RunningGameInfo | null) => {
      const g = gameInfo || runningGame;
      const cleanName = g?.name || query.trim() || title;
      const slug = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const gameKey = g?.game_key || `web:${slug || "guide"}`;
      const existing = games.find((e) => e.game_key === gameKey);
      setActiveReaderTarget({
        game_key: gameKey,
        appid: g?.appid || 0,
        game_name: cleanName,
        game_image: g?.image || "",
        source: "web",
        guide_id: url,
        guide_url: url,
        guide_title: title,
        guide_author: "Live Web",
        location_hint: guideSearchText.trim() || g?.locationHint || "",
        view_mode: "browser",
        bookmarked: existing?.bookmarked ?? false,
      });
      setTab("reader");
    },
    [runningGame, query, games, guideSearchText]
  );

  const loadGuidesForGame = useCallback(
    async (game: GameSearchResult, filter = "", hintOverride?: string) => {
      setSelectedGame(game);
      setLoadingGuides(true);
      setGuidesError(null);
      setSourceErrors([]);
      setGuides([]);
      setFallbackAllGuides(false);
      const effectiveHint =
        hintOverride !== undefined
          ? hintOverride
          : runningGame &&
            (runningGame.game_key === game.game_key ||
              runningGame.name.toLowerCase() === game.name.toLowerCase())
          ? runningGame.locationHint
          : "";
      try {
        const res = await withTimeout(
          listGuides(
            game.appid,
            game.name,
            game.image,
            filter,
            settings.walkthrough_only,
            settings.english_only,
            game.wiki_slug || "",
            effectiveHint
          ),
          25000,
          sRef.current.errSearchTimeout
        );
        setGuides(res.guides || []);
        setFallbackAllGuides(Boolean(res.fallback_all_guides));
        setSourceErrors(res.errors || []);
      } catch (e: any) {
        console.error(e);
        setGuidesError(e?.message || sRef.current.errLoadGuidesFailed);
      } finally {
        setLoadingGuides(false);
      }
    },
    [settings.walkthrough_only, settings.english_only, runningGame]
  );

  const handleUnifiedSearch = useCallback(
    async (
      termOverride?: string,
      runningOverride?: RunningGameInfo | null,
      hintOverride?: string,
      preserveSelectedGame = false
    ) => {
      const activeRun = runningOverride !== undefined ? runningOverride : runningGame;
      const term = (
        termOverride ??
        selectedGame?.name ??
        activeRun?.name ??
        query
      ).trim();
      if (!term) return;

      const reqId = ++searchReqIdRef.current;

      const matchedRunning =
        activeRun &&
        (term.toLowerCase() === activeRun.name.toLowerCase() ||
          term.toLowerCase().includes(activeRun.name.toLowerCase()));

      const effectiveHint =
        hintOverride !== undefined ? hintOverride.trim() : guideSearchText.trim();

      if (!preserveSelectedGame) {
        setSelectedGame(null);
      }
      setHasSearchedGuides(true);
      setLoadingGuides(true);
      setGuidesError(null);
      setSourceErrors([]);
      setGuides([]);
      setFallbackAllGuides(false);

      const isDirectUrl = /^https?:\/\//i.test(term);
      const googleQuery = [term, effectiveHint, "walkthrough"].filter(Boolean).join(" ");

      const googlePromise = isDirectUrl
        ? Promise.resolve<GuideSummary[]>([])
        : searchGoogleViaBrowserView(
            googleQuery,
            matchedRunning ? activeRun.appid : 0,
            term,
            7500
          ).catch(() => [] as GuideSummary[]);

      const backendPromise = withTimeout(
        searchWalkthroughs(
          term,
          matchedRunning ? activeRun.appid : 0,
          matchedRunning ? activeRun.name : "",
          effectiveHint,
          settings.walkthrough_only,
          settings.english_only
        ),
        25000,
        sRef.current.errSearchTimeout
      );

      try {
        // Prefer live Google Search results first; fall back seamlessly to multi-source backend if empty.
        const googleResults = await googlePromise;
        if (reqId !== searchReqIdRef.current) return;

        if (googleResults.length > 0) {
          setGuides(googleResults);
          return;
        }

        const res = await backendPromise;
        if (reqId !== searchReqIdRef.current) return;
        setGuides(res.guides || []);
        setSourceErrors(res.errors || []);
        if (res.resolved_hint && !guideSearchText.trim()) {
          setGuideSearchText(res.resolved_hint);
        }
      } catch (e: any) {
        if (reqId !== searchReqIdRef.current) return;
        console.error(e);
        setGuidesError(e?.message || sRef.current.errSearchGuidesFailed);
      } finally {
        if (reqId === searchReqIdRef.current) {
          setLoadingGuides(false);
        }
      }
    },
    [
      query,
      guideSearchText,
      runningGame,
      selectedGame,
      settings.walkthrough_only,
      settings.english_only,
    ]
  );

  // Sync running game name/location hint and default Walkthrough Results to Google Search on Search tab.
  useEffect(() => {
    if (!runningGame) return;
    const hint = runningGame.locationHint || "";
    const isNewGame = autoSyncedGameKeyRef.current !== runningGame.game_key;
    const hintChanged = hint !== lastSyncedHintRef.current;

    if (isNewGame) {
      autoSyncedGameKeyRef.current = runningGame.game_key;
      lastSyncedHintRef.current = hint;
      setQuery(runningGame.name);
      setGuideSearchText(hint);
    } else if (hintChanged && hint) {
      lastSyncedHintRef.current = hint;
      setGuideSearchText(hint);
    }

    if (tab === "search" && !selectedGame) {
      const autoKey = `${runningGame.game_key}::${hint}`;
      if (autoSearchedKeyRef.current !== autoKey) {
        autoSearchedKeyRef.current = autoKey;
        handleUnifiedSearch(
          runningGame.name,
          runningGame,
          isNewGame || hintChanged ? hint : guideSearchText
        );
      }
    }
  }, [runningGame, tab, selectedGame, guideSearchText, handleUnifiedSearch]);

  const handleFindRunningGameGuides = () => {
    if (!runningGame) return;
    setSelectedGame(null);
    setQuery(runningGame.name);
    setGuideSearchText(runningGame.locationHint || "");
    autoSearchedKeyRef.current = `${runningGame.game_key}::${runningGame.locationHint || ""}`;
    setTab("search");
    handleUnifiedSearch(runningGame.name, runningGame, runningGame.locationHint || "");
  };

  const handleOpenGuideSummary = (g: GuideSummary) => {
    const game = selectedGame;
    const gameKey =
      game?.game_key ||
      (g.appid > 0
        ? `steam:${g.appid}`
        : `${g.source}:${(g.game_name || g.title).replace(/\s+/g, "_")}`);

    const existing = games.find((entry) => entry.game_key === gameKey);
    const sameGuide =
      existing &&
      existing.active_guide_id === g.guide_id &&
      existing.active_source === g.source;

    const hint =
      guideSearchText.trim() ||
      (runningGame &&
      (runningGame.game_key === gameKey ||
        runningGame.name.toLowerCase() === (game?.name || g.game_name).toLowerCase())
        ? runningGame.locationHint
        : "");

    const target: ActiveReaderTarget = {
      game_key: gameKey,
      appid: game?.appid ?? g.appid,
      wiki_slug: game?.wiki_slug,
      game_name: game?.name || g.game_name || g.title,
      game_image: game?.image || g.game_image || "",
      source: g.source,
      guide_id: g.guide_id,
      guide_url: g.url,
      guide_title: g.title,
      guide_author: g.author,
      location_hint: hint,
      view_mode: "browser",
      resume_section_index: sameGuide ? existing.section_index : undefined,
      resume_section_id: sameGuide ? existing.section_id : undefined,
      resume_scroll_ratio: sameGuide ? existing.scroll_ratio : undefined,
      bookmarked: existing?.bookmarked ?? false,
    };
    setActiveReaderTarget(target);
    setTab("reader");
  };

  const handleToggleBookmark = async (entry: SavedGameEntry) => {
    const nextBookmarked = !entry.bookmarked;
    upsertLocalSavedGame({ ...entry, bookmarked: nextBookmarked });
    try {
      await setGameBookmarked(
        entry.game_key,
        nextBookmarked,
        entry.appid,
        entry.game_name,
        entry.game_image
      );
      await refreshLibrary();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRemoveGame = async (entry: SavedGameEntry) => {
    removeLocalSavedGame(entry.game_key);
    try {
      await removeGame(entry.game_key);
      await refreshLibrary();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateSetting = async <K extends keyof PluginSettings>(
    key: K,
    value: PluginSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSharedSettings(next);
    try {
      const saved = await updateSettings({ [key]: value });
      setSharedSettings(saved);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {/* Quick jump back to active webpage if browsing Đã lưu / Tìm / Cài đặt */}
      {tab !== "reader" && activeTarget ? (
        <div style={{ padding: "0 8px 2px 8px" }}>
          <DialogButton
            onClick={() => setTab("reader")}
            style={{
              width: "100%",
              minWidth: 0,
              padding: "4px 8px",
              fontSize: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              backgroundColor: "rgba(102, 192, 244, 0.22)",
            }}
          >
            <FaBookOpen size={9} />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.currentlyOpen(activeTarget.guide_title || activeTarget.game_name)}
            </span>
          </DialogButton>
        </div>
      ) : null}

      {/* TAB 1: LIBRARY (RUNNING GAME + BOOKMARKED & RECENT GAMES) */}
      {tab === "library" ? (
        <>
          {runningGame ? (
            <PanelSection title={s.nowPlayingSection}>
              <PanelSectionRow>
                <div
                  style={{
                    width: "100%",
                    backgroundColor: "rgba(102, 192, 244, 0.12)",
                    border: "1px solid rgba(102, 192, 244, 0.35)",
                    borderRadius: "6px",
                    padding: "8px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <FaGamepad color="#66c0f4" size={16} />
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "13px",
                        color: "#fff",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {runningGame.name}
                    </div>
                  </div>
                  {runningGame.locationHint ? (
                    <div style={{ fontSize: "11px", color: "#80e27e" }}>
                      {s.inGameLocation} <strong>{runningGame.locationHint}</strong>
                    </div>
                  ) : null}
                  {runningSavedEntry && runningSavedEntry.active_guide_id ? (
                    <>
                      <div style={{ fontSize: "11px", color: "#c7d5e0" }}>
                        {s.readingProgressPrefix} <strong>{runningSavedEntry.section_title}</strong>{" "}
                        {s.readingProgressPart(
                          runningSavedEntry.section_index + 1,
                          runningSavedEntry.total_sections
                        )}
                      </div>
                      <Focusable
                        flow-children="horizontal"
                        style={{ display: "flex", gap: "6px", width: "100%" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <DialogButton
                            onClick={() => openSavedEntry(runningSavedEntry)}
                            style={{
                              width: "100%",
                              minWidth: 0,
                              padding: "6px 8px",
                              fontSize: "12px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                            }}
                          >
                            <FaPlay size={10} />
                            <span>{s.resumeBtn}</span>
                          </DialogButton>
                        </div>
                        <div style={{ width: "36px", flexShrink: 0 }}>
                          <DialogButton
                            onClick={() =>
                              openUrlInBrowser(
                                resolveGuideUrl(
                                  runningSavedEntry.active_source,
                                  runningSavedEntry.active_guide_id
                                )
                              )
                            }
                            style={{
                              width: "100%",
                              minWidth: 0,
                              padding: "6px 0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <FaExternalLinkAlt size={11} />
                          </DialogButton>
                        </div>
                      </Focusable>
                    </>
                  ) : (
                    <Focusable
                      flow-children="horizontal"
                      style={{ display: "flex", gap: "6px", width: "100%" }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <DialogButton
                          onClick={handleFindRunningGameGuides}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            padding: "6px 6px",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "4px",
                          }}
                        >
                          <FaSearch size={10} />
                          <span>{s.findGuideBtn}</span>
                        </DialogButton>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <DialogButton
                          onClick={() => {
                            const q = [
                              runningGame.name,
                              runningGame.locationHint,
                              "walkthrough",
                            ]
                              .filter(Boolean)
                              .join(" ");
                            openEmbeddedUrl(
                              `https://www.google.com/search?q=${encodeURIComponent(q)}`,
                              `Google: ${runningGame.name}`,
                              runningGame
                            );
                          }}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            padding: "6px 6px",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "4px",
                          }}
                        >
                          <FaGlobe size={10} />
                          <span>{s.webGoogleBtn}</span>
                        </DialogButton>
                      </div>
                    </Focusable>
                  )}
                </div>
              </PanelSectionRow>
            </PanelSection>
          ) : null}

          <PanelSection title={s.savedGamesSection(games.length)}>
            {libraryLoading ? (
              <PanelSectionRow>
                <CompactSpinner text={s.loadingSaved} />
              </PanelSectionRow>
            ) : libraryError ? (
              <PanelSectionRow>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "12px", color: "#ff7a7a" }}>{libraryError}</div>
                  <DialogButton
                    onClick={() => {
                      setLibraryLoading(true);
                      refreshLibrary();
                    }}
                    style={{ width: "100%", minWidth: 0, padding: "6px 10px", fontSize: "12px" }}
                  >
                    {s.retryBtn}
                  </DialogButton>
                </div>
              </PanelSectionRow>
            ) : games.length === 0 ? (
              <PanelSectionRow>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#8f98a0",
                    padding: "6px 0",
                    lineHeight: 1.4,
                  }}
                >
                  {s.noSavedBeforeTab}
                  <strong>{s.tabSearch}</strong>
                  {s.noSavedAfterTab}
                </div>
              </PanelSectionRow>
            ) : (
              games.map((entry) => {
                const pct = calcOverallProgress(entry);
                return (
                  <PanelSectionRow key={entry.game_key}>
                    <div
                      style={{
                        width: "100%",
                        backgroundColor: "rgba(255,255,255,0.04)",
                        borderRadius: "6px",
                        padding: "8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        marginBottom: "4px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {entry.game_image ? (
                          <img
                            src={entry.game_image}
                            alt={entry.game_name}
                            style={{
                              width: "52px",
                              height: "24px",
                              objectFit: "cover",
                              borderRadius: "3px",
                              flexShrink: 0,
                            }}
                          />
                        ) : null}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: "13px",
                              fontWeight: 700,
                              color: "#fff",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {entry.bookmarked ? "★ " : ""}
                            {entry.game_name}
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#8f98a0",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {entry.active_guide_title || s.noGuideSelected}
                          </div>
                        </div>
                      </div>

                      {entry.active_guide_id ? (
                        <>
                          <div style={{ fontSize: "11px", color: "#66c0f4" }}>
                            {s.stoppedAtPrefix} {entry.section_title || s.firstSection} (
                            {entry.section_index + 1}/{entry.total_sections}) •{" "}
                            {formatRelativeTime(entry.updated_at, settings.language)}
                          </div>
                          <ProgressBar nProgress={pct} />
                        </>
                      ) : null}

                      <Focusable
                        flow-children="horizontal"
                        style={{ display: "flex", gap: "4px", width: "100%" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {entry.active_guide_id ? (
                            <DialogButton
                              onClick={() => openSavedEntry(entry)}
                              style={{
                                width: "100%",
                                minWidth: 0,
                                padding: "5px 6px",
                                fontSize: "11px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px",
                              }}
                            >
                              <FaPlay size={9} />
                              <span>{s.resumeBtn}</span>
                            </DialogButton>
                          ) : (
                            <DialogButton
                              onClick={() => {
                                setTab("search");
                                loadGuidesForGame({
                                  game_key: entry.game_key,
                                  source: entry.appid > 0 ? "steam" : "ign",
                                  appid: entry.appid,
                                  name: entry.game_name,
                                  image: entry.game_image,
                                });
                              }}
                              style={{
                                width: "100%",
                                minWidth: 0,
                                padding: "5px 6px",
                                fontSize: "11px",
                              }}
                            >
                              {s.chooseGuideBtn}
                            </DialogButton>
                          )}
                        </div>
                        {entry.active_guide_id ? (
                          <div style={{ width: "34px", flexShrink: 0 }}>
                            <DialogButton
                              onClick={() =>
                                openUrlInBrowser(
                                  resolveGuideUrl(
                                    entry.active_source,
                                    entry.active_guide_id
                                  )
                                )
                              }
                              style={{
                                width: "100%",
                                minWidth: 0,
                                padding: "5px 0",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <FaExternalLinkAlt size={10} />
                            </DialogButton>
                          </div>
                        ) : null}
                        <div style={{ width: "34px", flexShrink: 0 }}>
                          <DialogButton
                            onClick={() => handleToggleBookmark(entry)}
                            style={{
                              width: "100%",
                              minWidth: 0,
                              padding: "5px 0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {entry.bookmarked ? (
                              <FaBookmark size={11} color="#f5c542" />
                            ) : (
                              <FaRegBookmark size={11} />
                            )}
                          </DialogButton>
                        </div>
                        <div style={{ width: "34px", flexShrink: 0 }}>
                          <DialogButton
                            onClick={() => handleRemoveGame(entry)}
                            style={{
                              width: "100%",
                              minWidth: 0,
                              padding: "5px 0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <FaTrash size={11} />
                          </DialogButton>
                        </div>
                      </Focusable>
                    </div>
                  </PanelSectionRow>
                );
              })
            )}
          </PanelSection>
        </>
      ) : null}

      {/* TAB 2: UNIFIED 1-STEP WALKTHROUGH SEARCH */}
      {tab === "search" ? (
        <>
          <PanelSection title={s.quickSearchSection}>
            {/* Game box right under section header (replaces old Game+boss & Search row) */}
            {runningGame && !selectedGame ? (
              <PanelSectionRow>
                <DialogButton
                  onClick={() => {
                    setSelectedGame(null);
                    setQuery(runningGame.name);
                    handleUnifiedSearch(runningGame.name, runningGame, guideSearchText);
                  }}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                    backgroundColor: "rgba(102, 192, 244, 0.14)",
                  }}
                >
                  <FaGamepad color="#66c0f4" size={14} />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {runningGame.name}
                  </span>
                </DialogButton>
              </PanelSectionRow>
            ) : (
              <PanelSectionRow>
                <div style={{ width: "100%" }}>
                  <TextField
                    value={selectedGame?.name || query}
                    onChange={(e) => {
                      if (selectedGame) setSelectedGame(null);
                      setQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleUnifiedSearch(query, runningGame, guideSearchText);
                      }
                    }}
                    placeholder={s.gameTitlePlaceholder}
                  />
                </div>
              </PanelSectionRow>
            )}

            {/* Chapter / location filter row below game box */}
            <PanelSectionRow>
              <style>{`
                .qw-clearable-input input {
                  padding-right: 28px !important;
                }
              `}</style>
              <Focusable
                flow-children="horizontal"
                style={{
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <div
                  className={guideSearchText ? "qw-clearable-input" : undefined}
                  style={{ position: "relative", flex: 1, minWidth: 0 }}
                >
                  <TextField
                    value={guideSearchText}
                    onChange={(e) => setGuideSearchText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const targetName =
                          selectedGame?.name || runningGame?.name || query.trim();
                        if (targetName) {
                          handleUnifiedSearch(
                            targetName,
                            selectedGame ? null : runningGame,
                            guideSearchText,
                            Boolean(selectedGame)
                          );
                        }
                      }
                    }}
                    placeholder={s.filterPlaceholder}
                  />
                  {guideSearchText ? (
                    <DialogButton
                      onClick={() => setGuideSearchText("")}
                      style={{
                        position: "absolute",
                        right: "6px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: "22px",
                        height: "22px",
                        minWidth: 0,
                        minHeight: 0,
                        padding: 0,
                        margin: 0,
                        backgroundColor: "transparent",
                        border: "none",
                        boxShadow: "none",
                        color: "#b8bcbf",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 2,
                      }}
                    >
                      <FaTimesCircle size={13} />
                    </DialogButton>
                  ) : null}
                </div>
                <div style={{ width: "38px", flexShrink: 0 }}>
                  <DialogButton
                    onClick={() => {
                      const targetName =
                        selectedGame?.name || runningGame?.name || query.trim();
                      if (targetName) {
                        handleUnifiedSearch(
                          targetName,
                          selectedGame ? null : runningGame,
                          guideSearchText,
                          Boolean(selectedGame)
                        );
                      }
                    }}
                    style={{
                      width: "100%",
                      minWidth: 0,
                      padding: "8px 0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <FaSearch size={12} />
                  </DialogButton>
                </div>
              </Focusable>
            </PanelSectionRow>

            <PanelSectionRow>
              <Focusable
                flow-children="horizontal"
                style={{ display: "flex", gap: "6px", width: "100%" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <DialogButton
                    onClick={() => {
                      const baseName =
                        selectedGame?.name || runningGame?.name || query.trim() || "walkthrough";
                      const appid = selectedGame?.appid || runningGame?.appid || 0;
                      const { url, labelPrefix } = buildQuickSearchUrl(
                        settings.quick_search_source || "ign",
                        baseName,
                        guideSearchText,
                        appid,
                        selectedGame?.wiki_slug
                      );
                      openEmbeddedUrl(url, `${labelPrefix}: ${baseName}`);
                    }}
                    style={{
                      width: "100%",
                      minWidth: 0,
                      padding: "6px 4px",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                    }}
                  >
                    <FaGlobe size={10} />
                    <span>{s.quickSearchBtn}</span>
                  </DialogButton>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <DialogButton
                    onClick={() => {
                      const baseName =
                        selectedGame?.name || runningGame?.name || query.trim() || "game";
                      const q = [baseName, guideSearchText.trim(), "walkthrough"]
                        .filter(Boolean)
                        .join(" ");
                      openEmbeddedUrl(
                        `https://www.google.com/search?q=${encodeURIComponent(q)}`,
                        `Google: ${baseName}`
                      );
                    }}
                    style={{
                      width: "100%",
                      minWidth: 0,
                      padding: "6px 4px",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                    }}
                  >
                    <FaGlobe size={10} />
                    <span>{s.googleSearchBtn}</span>
                  </DialogButton>
                </div>
              </Focusable>
            </PanelSectionRow>
          </PanelSection>

          <PanelSection
            title={
              selectedGame
                ? s.resultsHeaderGame(selectedGame.name)
                : s.resultsHeaderCount(guides.length)
            }
          >
            {fallbackAllGuides ? (
              <PanelSectionRow>
                <div style={{ fontSize: "11px", color: "#f5c542" }}>
                  {s.fallbackTopRatedNote}
                </div>
              </PanelSectionRow>
            ) : null}

            {loadingGuides ? (
              <PanelSectionRow>
                <CompactSpinner text={s.searchingWalkthroughs} />
              </PanelSectionRow>
            ) : guidesError ? (
              <PanelSectionRow>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ fontSize: "12px", color: "#ff7a7a" }}>{guidesError}</div>
                  <DialogButton
                    onClick={() => {
                      const targetName =
                        selectedGame?.name || runningGame?.name || query.trim();
                      if (targetName) {
                        handleUnifiedSearch(
                          targetName,
                          selectedGame ? null : runningGame,
                          guideSearchText,
                          Boolean(selectedGame)
                        );
                      }
                    }}
                    style={{ width: "100%", minWidth: 0, padding: "6px 8px", fontSize: "12px" }}
                  >
                    {s.retryBtn}
                  </DialogButton>
                </div>
              </PanelSectionRow>
            ) : guides.length === 0 ? (
              <PanelSectionRow>
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "12px", color: "#8f98a0", lineHeight: 1.4 }}>
                    {hasSearchedGuides || selectedGame
                      ? s.noGuidesFound(selectedGame?.name || runningGame?.name || query)
                      : s.searchEmptyPrompt}
                  </div>
                  {sourceErrors.length > 0 ? (
                    <div style={{ fontSize: "10px", color: "#ff9b9b", lineHeight: 1.3 }}>
                      {s.detailsPrefix} {sourceErrors.join(" | ")}
                    </div>
                  ) : null}
                  {hasSearchedGuides || selectedGame ? (
                    <DialogButton
                      onClick={() =>
                        openGoogleInBrowser(
                          selectedGame?.name || runningGame?.name || query,
                          guideSearchText
                        )
                      }
                      style={{
                        width: "100%",
                        minWidth: 0,
                        padding: "7px 8px",
                        fontSize: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <FaExternalLinkAlt size={10} />
                      <span>{s.searchGoogleExternal}</span>
                    </DialogButton>
                  ) : null}
                </div>
              </PanelSectionRow>
            ) : (
              guides.map((g) => {
                const badge = sourceBadge(g.source, g.author);
                const extUrl = resolveGuideUrl(g.source, g.guide_id, g.url);
                return (
                  <PanelSectionRow key={`${g.source}-${g.guide_id}`}>
                    <Focusable
                      flow-children="horizontal"
                      style={{
                        display: "flex",
                        gap: "4px",
                        alignItems: "stretch",
                        width: "100%",
                        marginBottom: "4px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <DialogButton
                          onClick={() => handleOpenGuideSummary(g)}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            textAlign: "left",
                            padding: "8px 8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "3px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: 700,
                              color: "#ffffff",
                              lineHeight: 1.3,
                            }}
                          >
                            {g.title}
                          </div>
                          <div
                            style={{
                              fontSize: "10px",
                              color: "#8f98a0",
                              display: "flex",
                              gap: "6px",
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <span style={{ color: badge.color, fontWeight: 700 }}>
                              {badge.label}
                            </span>
                            {g.match_reason ? (
                              <span
                                style={{
                                  color: "#80e27e",
                                  fontWeight: 700,
                                  backgroundColor: "rgba(128, 226, 126, 0.12)",
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                }}
                              >
                                {g.match_reason}
                              </span>
                            ) : null}
                            <span>• {g.author}</span>
                            {g.rating_stars > 0 && g.source === "steam" ? (
                              <span style={{ color: "#f5c542" }}>
                                • <FaStar size={9} /> {g.rating_stars}/5
                              </span>
                            ) : null}
                          </div>
                        </DialogButton>
                      </div>
                      {extUrl ? (
                        <div style={{ width: "36px", flexShrink: 0, display: "flex" }}>
                          <DialogButton
                            onClick={() => openUrlInBrowser(extUrl)}
                            style={{
                              width: "100%",
                              minWidth: 0,
                              padding: "0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <FaExternalLinkAlt size={11} />
                          </DialogButton>
                        </div>
                      ) : null}
                    </Focusable>
                  </PanelSectionRow>
                );
              })
            )}
          </PanelSection>
        </>
      ) : null}

      {/* KEEP LIVE BROWSER MOUNTED (hidden & SetVisible(false) when on other tabs so closing/opening QAM or switching tabs NEVER reloads the webpage) */}
      {activeTarget ? (
        <div
          ref={readerWrapRef}
          style={{
            display: tab === "reader" ? "block" : "none",
            marginTop: "-4px",
            padding: "0 6px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <EmbeddedBrowser
            target={activeTarget}
            loadKey={targetLoadVersion}
            compact={true}
            suspended={tab !== "reader"}
            onProgressSaved={refreshLibrary}
          />
        </div>
      ) : tab === "reader" ? (
        <div style={{ fontSize: "12px", color: "#8f98a0", padding: "10px" }}>
          {s.readerEmptyState}
        </div>
      ) : null}

      {/* TAB 4: SETTINGS */}
      {tab === "settings" ? (
        <PanelSection title={s.settingsTitle}>
          <PanelSectionRow>
            <DropdownItem
              label={s.languageLabel}
              rgOptions={[
                { data: "en", label: s.languageEn },
                { data: "vi", label: s.languageVi },
              ]}
              selectedOption={settings.language || "en"}
              onChange={(opt) =>
                handleUpdateSetting("language", opt.data as LanguageOption)
              }
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label={s.translateLangLabel}
              rgOptions={[
                { data: "auto", label: s.translateLangAuto },
                { data: "en", label: "English" },
                { data: "vi", label: "Tiếng Việt" },
                { data: "ja", label: "日本語 (Japanese)" },
                { data: "zh-CN", label: "简体中文 (Chinese)" },
                { data: "ko", label: "한국어 (Korean)" },
                { data: "es", label: "Español (Spanish)" },
                { data: "fr", label: "Français (French)" },
                { data: "de", label: "Deutsch (German)" },
              ]}
              selectedOption={settings.translate_lang || "auto"}
              onChange={(opt) =>
                handleUpdateSetting("translate_lang", opt.data as TranslateLangOption)
              }
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label={s.quickSearchSourceLabel}
              rgOptions={[
                { data: "ign", label: s.quickSearchSourceIgn },
                { data: "powerpyx", label: s.quickSearchSourcePowerpyx },
                { data: "pcgamer", label: s.quickSearchSourcePcgamer },
                { data: "game8", label: s.quickSearchSourceGame8 },
                { data: "steam", label: s.quickSearchSourceSteam },
                { data: "gamefaqs", label: s.quickSearchSourceGamefaqs },
                { data: "strategywiki", label: s.quickSearchSourceStrategywiki },
              ]}
              selectedOption={settings.quick_search_source || "ign"}
              onChange={(opt) =>
                handleUpdateSetting("quick_search_source", opt.data as QuickSearchSourceOption)
              }
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={s.adblockLabel}
              description={s.adblockDesc}
              checked={settings.adblock !== false}
              onChange={(val) => handleUpdateSetting("adblock", val)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label={s.fontSizeLabel}
              rgOptions={[
                { data: "small", label: s.fontSmall },
                { data: "medium", label: s.fontMedium },
                { data: "large", label: s.fontLarge },
              ]}
              selectedOption={settings.font_size}
              onChange={(opt) =>
                handleUpdateSetting("font_size", opt.data as FontSizeOption)
              }
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={s.walkthroughOnlyLabel}
              description={s.walkthroughOnlyDesc}
              checked={settings.walkthrough_only}
              onChange={(val) => handleUpdateSetting("walkthrough_only", val)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={s.englishOnlyLabel}
              description={s.englishOnlyDesc}
              checked={settings.english_only}
              onChange={(val) => handleUpdateSetting("english_only", val)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={s.hideSpoilersLabel}
              description={s.hideSpoilersDesc}
              checked={settings.hide_spoilers}
              onChange={(val) => handleUpdateSetting("hide_spoilers", val)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={s.autoCacheLabel}
              description={s.autoCacheDesc}
              checked={settings.auto_cache_saved}
              onChange={(val) => handleUpdateSetting("auto_cache_saved", val)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={async () => {
                setDiagLoading(true);
                setDiagResults(null);
                try {
                  const res = await withTimeout(
                    diagnoseNetwork(),
                    15000,
                    sRef.current.diagTimeout
                  );
                  setDiagResults(res);
                } catch (e: any) {
                  setDiagResults([
                    {
                      name: "Backend",
                      ok: false,
                      ms: 0,
                      error: e?.message || sRef.current.diagError,
                    },
                  ]);
                } finally {
                  setDiagLoading(false);
                }
              }}
            >
              {diagLoading ? s.diagRunning : s.diagButton}
            </ButtonItem>
          </PanelSectionRow>
          {diagResults ? (
            <PanelSectionRow>
              <div
                style={{
                  width: "100%",
                  backgroundColor: "rgba(0,0,0,0.28)",
                  borderRadius: "6px",
                  padding: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  fontSize: "11px",
                }}
              >
                {diagResults.map((r) => (
                  <div key={r.name} style={{ color: r.ok ? "#80e27e" : "#ff8a8a" }}>
                    <strong>{r.name}</strong>:{" "}
                    {r.ok ? `OK (${r.ms}ms)` : `${s.diagErrorLabel} (${r.ms}ms) - ${r.error}`}
                  </div>
                ))}
              </div>
            </PanelSectionRow>
          ) : null}
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={async () => {
                const count = await clearCache();
                toaster.toast({
                  title: sRef.current.clearCacheToastTitle,
                  body: sRef.current.clearCacheToastBody(count),
                });
              }}
            >
              {s.clearCacheButton}
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      ) : null}
    </div>
  );
};
