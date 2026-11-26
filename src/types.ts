export type GuideSource = "google" | "ign" | "web" | "steam" | "strategywiki";

export type FontSizeOption = "small" | "medium" | "large";

export type LanguageOption = "en" | "vi";

export type QuickSearchSourceOption =
  | "ign"
  | "powerpyx"
  | "pcgamer"
  | "game8"
  | "steam"
  | "gamefaqs"
  | "strategywiki";

export type TranslateLangOption =
  | "auto"
  | "en"
  | "vi"
  | "ja"
  | "zh-CN"
  | "ko"
  | "es"
  | "fr"
  | "de";

export interface PluginSettings {
  language?: LanguageOption;
  translate_lang?: TranslateLangOption;
  quick_search_source?: QuickSearchSourceOption;
  adblock?: boolean;
  font_size: FontSizeOption;
  english_only: boolean;
  walkthrough_only: boolean;
  hide_spoilers: boolean;
  auto_cache_saved: boolean;
}

export interface GameSearchResult {
  game_key: string;
  source: GuideSource;
  appid: number;
  wiki_slug?: string;
  name: string;
  image: string;
  suggested_hint?: string;
}

export interface GuideSummary {
  guide_id: string;
  source: GuideSource;
  title: string;
  author: string;
  description: string;
  rating_stars: number;
  url: string;
  appid: number;
  game_name: string;
  game_image: string;
  match_score?: number;
  match_reason?: string;
}

export interface ListGuidesResponse {
  guides: GuideSummary[];
  fallback_all_guides?: boolean;
  errors?: string[];
  resolved_hint?: string;
}

export type GuideBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "spoiler"; text: string }
  | { type: "code"; text: string }
  | { type: "quote"; text: string }
  | { type: "image"; url: string; alt: string }
  | { type: "table"; rows: string[][] };

export interface GuideSection {
  id: string;
  title: string;
  blocks: GuideBlock[];
}

export interface RelatedPage {
  guide_id: string;
  title: string;
}

export interface SavedProgress {
  section_index: number;
  section_id: string;
  section_title: string;
  total_sections: number;
  scroll_ratio: number;
  updated_at: number;
}

export interface GuideContent {
  guide_id: string;
  source: GuideSource;
  title: string;
  author: string;
  appid: number;
  game_name: string;
  url: string;
  sections: GuideSection[];
  related_pages: RelatedPage[];
  cached?: boolean;
  stale_offline?: boolean;
  saved_progress?: SavedProgress | null;
}

export interface PinnedSection {
  guide_id: string;
  source: GuideSource;
  section_index: number;
  section_id: string;
  section_title: string;
  created_at?: number;
}

export interface SavedGameEntry {
  game_key: string;
  appid: number;
  game_name: string;
  game_image: string;
  bookmarked: boolean;
  active_source: GuideSource | "";
  active_guide_id: string;
  active_guide_title: string;
  active_guide_author: string;
  section_index: number;
  section_id: string;
  section_title: string;
  total_sections: number;
  scroll_ratio: number;
  pinned_sections: PinnedSection[];
  updated_at: number;
}

export interface LibraryState {
  games: SavedGameEntry[];
  settings: PluginSettings;
}

export interface ActiveReaderTarget {
  game_key: string;
  appid: number;
  wiki_slug?: string;
  game_name: string;
  game_image: string;
  source: GuideSource;
  guide_id: string;
  guide_url?: string;
  guide_title?: string;
  guide_author?: string;
  location_hint?: string;
  view_mode?: "browser" | "text";
  prefetched_html?: string;
  resume_section_index?: number;
  resume_section_id?: string;
  resume_scroll_ratio?: number;
  bookmarked?: boolean;
}
