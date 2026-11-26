import { LanguageOption } from "./types";

export const LANGUAGE_STORAGE_KEY = "qw_language_v1";

export function normalizeLanguage(val: unknown): LanguageOption {
  return val === "vi" ? "vi" : "en";
}

export function loadStoredLanguage(): LanguageOption {
  try {
    const raw = window.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(raw);
  } catch {
    return "en";
  }
}

export function persistStoredLanguage(lang: LanguageOption): void {
  try {
    window.localStorage?.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(lang));
  } catch {
    // ignore
  }
}

export interface UiStrings {
  // Header tabs
  tabSaved: string;
  tabSearch: string;

  // EmbeddedBrowser
  toastPageSaved: string;
  toastPageUnsaved: string;
  cannotLoadUrl: (errUrl: string, desc?: string) => string;
  errBrowserContainerUnavailable: string;
  errCreateBrowserViewUnavailable: string;
  errCreateBrowserViewFailed: string;
  errEmbeddedBrowserInit: string;
  errBrowserContainerShort: string;
  readFullscreen: string;
  openSteamBrowser: string;
  savedLabel: string;
  saveLabel: string;
  showToolbar: string;
  readLabel: string;
  pageLoadErrorPrefix: string;

  // FullReaderPage
  savedCountLabel: (count: number) => string;
  fullReaderEmptyBefore: string;
  fullReaderEmptyAfter: string;
  savedAndRecentDrawer: (count: number) => string;
  noSavedGamesShort: string;

  // QuickAccessPanel - errors & status
  errBackendNoResponse: string;
  errBackendConnect: string;
  errSearchTimeout: string;
  errLoadGuidesFailed: string;
  errSearchGuidesFailed: string;
  currentlyOpen: (title: string) => string;
  nowPlayingSection: string;
  inGameLocation: string;
  readingProgressPrefix: string;
  readingProgressPart: (idx: number, total: number) => string;
  resumeBtn: string;
  findGuideBtn: string;
  webGoogleBtn: string;
  webIgnBtn: string;
  savedGamesSection: (count: number) => string;
  loadingSaved: string;
  retryBtn: string;
  noSavedBeforeTab: string;
  noSavedAfterTab: string;
  noGuideSelected: string;
  stoppedAtPrefix: string;
  firstSection: string;
  chooseGuideBtn: string;
  quickSearchSection: string;
  gameTitlePlaceholder: string;
  searchBtn: string;
  filterPlaceholder: string;
  filterBtn: string;
  quickSearchBtn: string;
  googleSearchBtn: string;
  findForRunningGame: (name: string) => string;
  resultsHeaderGame: (name: string) => string;
  resultsHeaderCount: (count: number) => string;
  fallbackTopRatedNote: string;
  searchingWalkthroughs: string;
  noGuidesFound: (name: string) => string;
  searchEmptyPrompt: string;
  detailsPrefix: string;
  searchGoogleExternal: string;
  readerEmptyState: string;

  // Settings
  settingsTitle: string;
  languageLabel: string;
  languageEn: string;
  languageVi: string;
  quickSearchSourceLabel: string;
  quickSearchSourceIgn: string;
  quickSearchSourcePowerpyx: string;
  quickSearchSourcePcgamer: string;
  quickSearchSourceGame8: string;
  quickSearchSourceSteam: string;
  quickSearchSourceGamefaqs: string;
  quickSearchSourceStrategywiki: string;
  adblockLabel: string;
  adblockDesc: string;
  fontSizeLabel: string;
  fontSmall: string;
  fontMedium: string;
  fontLarge: string;
  walkthroughOnlyLabel: string;
  walkthroughOnlyDesc: string;
  englishOnlyLabel: string;
  englishOnlyDesc: string;
  hideSpoilersLabel: string;
  hideSpoilersDesc: string;
  autoCacheLabel: string;
  autoCacheDesc: string;
  diagRunning: string;
  diagButton: string;
  diagTimeout: string;
  diagError: string;
  diagErrorLabel: string;
  clearCacheButton: string;
  clearCacheToastTitle: string;
  clearCacheToastBody: (count: number) => string;

  // api.ts messages
  errSteamBrowserViewUnavailable: string;
  errBackgroundBrowserTimeout: string;
  errBackgroundBrowserCreateFailed: string;
  errPageLoadFailed: string;
  errBackgroundBrowser: string;
  errHtmlParseTimeout: string;
  errBackendGuideTimeout: string;
  errDeckyFetchTimeout: string;
  errOperationTimeout: string;
}

const EN_STRINGS: UiStrings = {
  tabSaved: "Saved",
  tabSearch: "Search",

  toastPageSaved: "Page bookmarked",
  toastPageUnsaved: "Bookmark removed",
  cannotLoadUrl: (errUrl, desc) => (desc ? `${desc} (${errUrl})` : `Failed to load ${errUrl}`),
  errBrowserContainerUnavailable: "Steam BrowserContainer is unavailable in this view.",
  errCreateBrowserViewUnavailable: "WindowStore.CreateBrowserView is unavailable.",
  errCreateBrowserViewFailed: "Could not initialize BrowserView.",
  errEmbeddedBrowserInit: "Failed to initialize embedded browser.",
  errBrowserContainerShort: "BrowserContainer unavailable.",
  readFullscreen: "Read (Fullscreen)",
  openSteamBrowser: "Open in Steam Browser",
  savedLabel: "Saved",
  saveLabel: "Save",
  showToolbar: "Show toolbar",
  readLabel: "Read",
  pageLoadErrorPrefix: "Page load error",

  savedCountLabel: (count) => `Saved (${count})`,
  fullReaderEmptyBefore: "Click ",
  fullReaderEmptyAfter:
    " above to choose a game, or open the Quick Access Menu (...) to search for a new walkthrough.",
  savedAndRecentDrawer: (count) => `Saved & Recent (${count})`,
  noSavedGamesShort: "No saved games yet.",

  errBackendNoResponse: "No response from plugin backend.",
  errBackendConnect: "Failed to connect to Decky backend.",
  errSearchTimeout: "Walkthrough search timed out.",
  errLoadGuidesFailed: "Could not load guide list.",
  errSearchGuidesFailed: "Could not search walkthroughs.",
  currentlyOpen: (title) => `Open: ${title}`,
  nowPlayingSection: "Now Playing",
  inGameLocation: "In-game location:",
  readingProgressPrefix: "Reading:",
  readingProgressPart: (idx, total) => `(Section ${idx}/${total})`,
  resumeBtn: "Resume",
  findGuideBtn: "Find Guide",
  webGoogleBtn: "Web Google",
  webIgnBtn: "Web IGN",
  savedGamesSection: (count) => `Saved & Recent (${count})`,
  loadingSaved: "Loading saved games...",
  retryBtn: "Retry",
  noSavedBeforeTab: "No saved games yet. Switch to the ",
  noSavedAfterTab: " tab to find walkthroughs from IGN Wikis & Steam Guides!",
  noGuideSelected: "No guide selected",
  stoppedAtPrefix: "Stopped at:",
  firstSection: "Start",
  chooseGuideBtn: "Choose guide",
  quickSearchSection: "Quick Walkthrough Search",
  gameTitlePlaceholder: "Game title (e.g. Elden Ring)",
  searchBtn: "Search",
  filterPlaceholder: "Chapter / boss / location (optional)",
  filterBtn: "Filter",
  quickSearchBtn: "Quick Search",
  googleSearchBtn: "Google Search",
  findForRunningGame: (name) => `Find for running game: ${name}`,
  resultsHeaderGame: (name) => `Walkthrough: ${name}`,
  resultsHeaderCount: (count) =>
    count > 0 ? `Walkthrough Results (${count})` : "Walkthrough Results",
  fallbackTopRatedNote: "Showing top-rated guides for this game.",
  searchingWalkthroughs: "Searching Google walkthroughs...",
  noGuidesFound: (name) =>
    `No guides found for "${name}". Try filtering with a shorter English title or tap Google Search above.`,
  searchEmptyPrompt:
    "Enter a game title above (plus chapter/location if needed) and tap Filter, Quick Search, or Google Search.",
  detailsPrefix: "Details:",
  searchGoogleExternal: "Search Google in External Browser",
  readerEmptyState: "Select a saved game or search for a walkthrough to start reading.",

  settingsTitle: "Quick Walkthrough Settings",
  languageLabel: "Language / Ngôn ngữ",
  languageEn: "English",
  languageVi: "Tiếng Việt",
  quickSearchSourceLabel: "Quick Search Source",
  quickSearchSourceIgn: "IGN Wikis",
  quickSearchSourcePowerpyx: "PowerPyx",
  quickSearchSourcePcgamer: "PC Gamer",
  quickSearchSourceGame8: "Game8",
  quickSearchSourceSteam: "Steam Community Guides",
  quickSearchSourceGamefaqs: "GameFAQs",
  quickSearchSourceStrategywiki: "StrategyWiki",
  adblockLabel: "Block Ads (AdBlock)",
  adblockDesc: "Hide ad banners, floating video ads, and trackers in the reader",
  fontSizeLabel: "Reader Font Size",
  fontSmall: "Small",
  fontMedium: "Medium",
  fontLarge: "Large",
  walkthroughOnlyLabel: "Prefer Walkthroughs Tag",
  walkthroughOnlyDesc: "Filter Steam guides by Walkthroughs tag (auto-fallback if none)",
  englishOnlyLabel: "Prefer English Guides",
  englishOnlyDesc: "Filter Steam Guides to English to avoid mixed-language results",
  hideSpoilersLabel: "Hide Spoilers by Default",
  hideSpoilersDesc: "Require clicking Spoiler blocks to reveal content",
  autoCacheLabel: "Save Offline Cache",
  autoCacheDesc: "Auto-save opened guide content for reading without Wi-Fi",
  diagRunning: "Testing connection...",
  diagButton: "Test Network Connection (SteamOS)",
  diagTimeout: "Network check timed out.",
  diagError: "Network check error",
  diagErrorLabel: "Error",
  clearCacheButton: "Clear Offline Guide Cache",
  clearCacheToastTitle: "Offline cache cleared",
  clearCacheToastBody: (count) => `Cleared ${count} cached guide(s).`,

  errSteamBrowserViewUnavailable: "Steam BrowserView is unavailable.",
  errBackgroundBrowserTimeout: "Background browser page load timed out.",
  errBackgroundBrowserCreateFailed: "Could not create background BrowserView.",
  errPageLoadFailed: "Could not load page.",
  errBackgroundBrowser: "Background BrowserView error.",
  errHtmlParseTimeout: "HTML parsing timed out.",
  errBackendGuideTimeout: "Backend guide load timed out.",
  errDeckyFetchTimeout: "Decky fetchNoCors timed out.",
  errOperationTimeout: "Operation timed out",
};

const VI_STRINGS: UiStrings = {
  tabSaved: "Đã lưu",
  tabSearch: "Tìm",

  toastPageSaved: "Đã lưu trang web",
  toastPageUnsaved: "Đã bỏ lưu trang",
  cannotLoadUrl: (errUrl, desc) => (desc ? `${desc} (${errUrl})` : `Không tải được ${errUrl}`),
  errBrowserContainerUnavailable: "Steam BrowserContainer không khả dụng ở giao diện này.",
  errCreateBrowserViewUnavailable: "WindowStore.CreateBrowserView không khả dụng.",
  errCreateBrowserViewFailed: "Không thể khởi tạo BrowserView.",
  errEmbeddedBrowserInit: "Lỗi khởi tạo trình duyệt nhúng.",
  errBrowserContainerShort: "BrowserContainer không khả dụng.",
  readFullscreen: "Đọc (Toàn màn hình)",
  openSteamBrowser: "Mở trình duyệt Steam",
  savedLabel: "Đã lưu",
  saveLabel: "Lưu",
  showToolbar: "Hiện thanh công cụ",
  readLabel: "Đọc",
  pageLoadErrorPrefix: "Lỗi tải trang",

  savedCountLabel: (count) => `Đã lưu (${count})`,
  fullReaderEmptyBefore: "Bấm nút ",
  fullReaderEmptyAfter:
    " ở trên để chọn game, hoặc mở Quick Access Menu (...) để tìm walkthrough mới.",
  savedAndRecentDrawer: (count) => `Game đã lưu & Đọc gần đây (${count})`,
  noSavedGamesShort: "Chưa có game nào được lưu.",

  errBackendNoResponse: "Không phản hồi từ backend plugin.",
  errBackendConnect: "Lỗi kết nối backend Decky.",
  errSearchTimeout: "Tìm walkthrough quá thời gian chờ.",
  errLoadGuidesFailed: "Không thể tải danh sách guide.",
  errSearchGuidesFailed: "Không thể tìm kiếm walkthrough.",
  currentlyOpen: (title) => `Đang mở: ${title}`,
  nowPlayingSection: "Đang chơi",
  inGameLocation: "Vị trí trong game:",
  readingProgressPrefix: "Đang xem:",
  readingProgressPart: (idx, total) => `(Mục ${idx}/${total})`,
  resumeBtn: "Mở tiếp",
  findGuideBtn: "Tìm Guide",
  webGoogleBtn: "Web Google",
  webIgnBtn: "Web IGN",
  savedGamesSection: (count) => `Game đã lưu & vừa xem (${count})`,
  loadingSaved: "Đang tải danh sách đã lưu...",
  retryBtn: "Thử lại",
  noSavedBeforeTab: "Chưa có game nào được lưu. Chuyển sang tab ",
  noSavedAfterTab: " để tìm walkthrough từ IGN Wikis & Steam Guides!",
  noGuideSelected: "Chưa chọn guide",
  stoppedAtPrefix: "Đang dừng ở:",
  firstSection: "Mục đầu",
  chooseGuideBtn: "Chọn guide",
  quickSearchSection: "Tìm nhanh Walkthrough",
  gameTitlePlaceholder: "Tên game (vd: Elden Ring)",
  searchBtn: "Tìm",
  filterPlaceholder: "Chương / boss / khu vực (tùy chọn)",
  filterBtn: "Lọc",
  quickSearchBtn: "Quick Search",
  googleSearchBtn: "Google Search",
  findForRunningGame: (name) => `Tìm cho game đang chơi: ${name}`,
  resultsHeaderGame: (name) => `Walkthrough: ${name}`,
  resultsHeaderCount: (count) =>
    count > 0 ? `Kết quả Walkthrough (${count})` : "Kết quả Walkthrough",
  fallbackTopRatedNote: "Đang hiển thị các guide top-rated của game.",
  searchingWalkthroughs: "Đang tìm trên Google...",
  noGuidesFound: (name) =>
    `Không tìm thấy guide cho "${name}". Thử lọc ngắn hơn hoặc bấm nút Google Search ở trên.`,
  searchEmptyPrompt:
    "Nhập tên game (kèm chương/khu vực nếu muốn) rồi bấm Lọc, Quick Search hoặc Google Search.",
  detailsPrefix: "Chi tiết:",
  searchGoogleExternal: "Tìm trên Google bằng trình duyệt ngoài",
  readerEmptyState: "Chọn một game đã lưu hoặc tìm walkthrough mới để bắt đầu đọc.",

  settingsTitle: "Cài đặt Quick Walkthrough",
  languageLabel: "Language / Ngôn ngữ",
  languageEn: "English",
  languageVi: "Tiếng Việt",
  quickSearchSourceLabel: "Nguồn nút Quick Search",
  quickSearchSourceIgn: "IGN Wikis",
  quickSearchSourcePowerpyx: "PowerPyx",
  quickSearchSourcePcgamer: "PC Gamer",
  quickSearchSourceGame8: "Game8",
  quickSearchSourceSteam: "Steam Community Guides",
  quickSearchSourceGamefaqs: "GameFAQs",
  quickSearchSourceStrategywiki: "StrategyWiki",
  adblockLabel: "Chặn quảng cáo (AdBlock)",
  adblockDesc: "Ẩn banner quảng cáo, video trôi nổi và script theo dõi khi đọc web",
  fontSizeLabel: "Cỡ chữ đọc hướng dẫn",
  fontSmall: "Nhỏ (Small)",
  fontMedium: "Vừa (Medium)",
  fontLarge: "Lớn (Large)",
  walkthroughOnlyLabel: "Ưu tiên tag Walkthroughs",
  walkthroughOnlyDesc: "Lọc guide hướng dẫn chơi trên Steam (tự fallback nếu không có)",
  englishOnlyLabel: "Ưu tiên tiếng Anh",
  englishOnlyDesc: "Lọc Steam Guides tiếng Anh để tránh lẫn ngôn ngữ khác",
  hideSpoilersLabel: "Ẩn Spoiler mặc định",
  hideSpoilersDesc: "Yêu cầu bấm vào khối Spoiler để hiện nội dung",
  autoCacheLabel: "Lưu cache đọc Offline",
  autoCacheDesc: "Tự lưu nội dung guide đã mở để xem tiếp khi không có Wi-Fi",
  diagRunning: "Đang kiểm tra kết nối...",
  diagButton: "Kiểm tra kết nối mạng (SteamOS)",
  diagTimeout: "Kiểm tra mạng quá thời gian chờ.",
  diagError: "Lỗi kiểm tra mạng",
  diagErrorLabel: "Lỗi",
  clearCacheButton: "Xóa cache guide offline",
  clearCacheToastTitle: "Đã xóa cache offline",
  clearCacheToastBody: (count) => `Đã dọn ${count} guide đã cache.`,

  errSteamBrowserViewUnavailable: "Steam BrowserView không khả dụng.",
  errBackgroundBrowserTimeout: "Trình duyệt nền tải trang quá thời gian chờ.",
  errBackgroundBrowserCreateFailed: "Không thể tạo BrowserView nền.",
  errPageLoadFailed: "Không tải được trang.",
  errBackgroundBrowser: "Lỗi BrowserView nền.",
  errHtmlParseTimeout: "Phân tích HTML quá lâu.",
  errBackendGuideTimeout: "Backend tải guide quá lâu.",
  errDeckyFetchTimeout: "Decky fetchNoCors quá thời gian chờ.",
  errOperationTimeout: "Thao tác quá thời gian chờ",
};

export function getStrings(lang?: LanguageOption): UiStrings {
  return normalizeLanguage(lang) === "vi" ? VI_STRINGS : EN_STRINGS;
}

export function formatRelativeTime(epochSec: number, lang?: LanguageOption): string {
  if (!epochSec) return "";
  const isVi = normalizeLanguage(lang) === "vi";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - epochSec));
  if (diff < 60) return isVi ? "Vừa xong" : "Just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return isVi ? `${m} phút trước` : `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return isVi ? `${h} giờ trước` : `${h}h ago`;
  }
  const d = Math.floor(diff / 86400);
  return isVi ? `${d} ngày trước` : `${d}d ago`;
}
