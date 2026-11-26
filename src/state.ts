import { useEffect, useState } from "react";
import { loadStoredLanguage, normalizeLanguage, persistStoredLanguage } from "./i18n";
import { ActiveReaderTarget, PluginSettings, SavedGameEntry } from "./types";

export type QamTab = "library" | "search" | "reader" | "settings";

const LAST_TARGET_KEY = "qw_last_active_target_v1";
const LOCAL_GAMES_KEY = "qw_saved_games_v1";

const DEFAULT_SETTINGS: PluginSettings = {
  language: loadStoredLanguage(),
  font_size: "medium",
  english_only: true,
  walkthrough_only: true,
  hide_spoilers: true,
  auto_cache_saved: true,
};

function loadLastTarget(): ActiveReaderTarget | null {
  try {
    const raw = window.localStorage?.getItem(LAST_TARGET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.guide_id) return parsed as ActiveReaderTarget;
    }
  } catch {
    // ignore
  }
  return null;
}

function persistLastTarget(target: ActiveReaderTarget | null): void {
  try {
    if (target) {
      window.localStorage?.setItem(LAST_TARGET_KEY, JSON.stringify(target));
    } else {
      window.localStorage?.removeItem(LAST_TARGET_KEY);
    }
  } catch {
    // ignore
  }
}

export function loadLocalSavedGames(): SavedGameEntry[] {
  try {
    const raw = window.localStorage?.getItem(LOCAL_GAMES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as SavedGameEntry[];
    }
  } catch {
    // ignore
  }
  return [];
}

function saveLocalGames(games: SavedGameEntry[]): void {
  try {
    window.localStorage?.setItem(LOCAL_GAMES_KEY, JSON.stringify(games.slice(0, 40)));
  } catch {
    // ignore
  }
}

function sortGames(games: SavedGameEntry[]): SavedGameEntry[] {
  return [...games].sort((a, b) => {
    const bDiff = (b.bookmarked ? 1 : 0) - (a.bookmarked ? 1 : 0);
    if (bDiff !== 0) return bDiff;
    return (b.updated_at || 0) - (a.updated_at || 0);
  });
}

const initialTarget = loadLastTarget();

interface SharedStore {
  activeTarget: ActiveReaderTarget | null;
  targetLoadVersion: number;
  activeTab: QamTab;
  qamChromeHidden: boolean;
  settings: PluginSettings;
  savedGames: SavedGameEntry[];
}

let store: SharedStore = {
  activeTarget: initialTarget,
  targetLoadVersion: initialTarget ? 1 : 0,
  activeTab: initialTarget ? "reader" : "library",
  qamChromeHidden: Boolean(initialTarget),
  settings: { ...DEFAULT_SETTINGS },
  savedGames: loadLocalSavedGames(),
};

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) {
    fn();
  }
}

export function setQamTab(tab: QamTab): void {
  const nextHidden = tab === "reader";
  if (store.activeTab === tab && store.qamChromeHidden === nextHidden) return;
  store = { ...store, activeTab: tab, qamChromeHidden: nextHidden };
  notify();
}

export function setQamChromeHidden(hidden: boolean): void {
  if (store.qamChromeHidden === hidden) return;
  store = { ...store, qamChromeHidden: hidden };
  notify();
}

export function setActiveReaderTarget(target: ActiveReaderTarget | null): void {
  persistLastTarget(target);
  store = {
    ...store,
    activeTarget: target,
    targetLoadVersion: store.targetLoadVersion + 1,
    qamChromeHidden: Boolean(target),
  };
  notify();
}

/** Updates current live URL/title/bookmark in-place without triggering BrowserView reload. */
export function patchActiveReaderMeta(patch: Partial<ActiveReaderTarget>): void {
  if (!store.activeTarget) return;
  const updated = { ...store.activeTarget, ...patch };
  persistLastTarget(updated);
  store = { ...store, activeTarget: updated };
  notify();
}

export function setSharedSettings(settings: PluginSettings): void {
  const language = normalizeLanguage(settings.language);
  persistStoredLanguage(language);
  store = { ...store, settings: { ...settings, language } };
  notify();
}

export function upsertLocalSavedGame(entry: SavedGameEntry): SavedGameEntry[] {
  const map = new Map<string, SavedGameEntry>();
  for (const g of store.savedGames) {
    map.set(g.game_key, g);
  }
  const existing = map.get(entry.game_key);
  const merged: SavedGameEntry = {
    ...(existing || {}),
    ...entry,
    pinned_sections: entry.pinned_sections || existing?.pinned_sections || [],
  };
  map.set(entry.game_key, merged);
  const sorted = sortGames(Array.from(map.values()));
  saveLocalGames(sorted);
  store = { ...store, savedGames: sorted };
  notify();
  return sorted;
}

export function removeLocalSavedGame(gameKey: string): SavedGameEntry[] {
  const next = store.savedGames.filter((g) => g.game_key !== gameKey);
  saveLocalGames(next);
  store = { ...store, savedGames: next };
  notify();
  return next;
}

export function mergeLibraryGames(backendGames: SavedGameEntry[]): SavedGameEntry[] {
  const map = new Map<string, SavedGameEntry>();
  for (const g of store.savedGames) {
    map.set(g.game_key, g);
  }
  for (const bg of backendGames) {
    const local = map.get(bg.game_key);
    if (!local) {
      map.set(bg.game_key, bg);
    } else {
      const pickBackend = (bg.updated_at || 0) > (local.updated_at || 0);
      map.set(bg.game_key, {
        ...(pickBackend ? local : bg),
        ...(pickBackend ? bg : local),
        bookmarked:
          (local.updated_at || 0) >= (bg.updated_at || 0)
            ? local.bookmarked
            : bg.bookmarked,
      });
    }
  }
  const sorted = sortGames(Array.from(map.values()));
  saveLocalGames(sorted);
  store = { ...store, savedGames: sorted };
  notify();
  return sorted;
}

export function getSharedStore(): SharedStore {
  return store;
}

export function useSharedStore(): SharedStore {
  const [snapshot, setSnapshot] = useState<SharedStore>(store);
  useEffect(() => {
    const listener = () => setSnapshot({ ...store });
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot;
}
