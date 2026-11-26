import hashlib
import json
import os
import re
import time
from typing import Any, Dict, List, Optional


DEFAULT_SETTINGS: Dict[str, Any] = {
    "language": "en",
    "quick_search_source": "ign",
    "adblock": True,
    "font_size": "medium",
    "english_only": True,
    "walkthrough_only": True,
    "hide_spoilers": True,
    "auto_cache_saved": True,
}


def _safe_filename(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value).strip("_") or "item"


def _atomic_write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp.{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


class WalkthroughStorage:
    """Persists saved games, reading progress, settings, and offline guide cache."""

    def __init__(self, settings_dir: str, runtime_dir: str) -> None:
        self.settings_dir = settings_dir
        self.runtime_dir = runtime_dir
        self.library_path = os.path.join(settings_dir, "library.json")
        self.cache_dir = os.path.join(runtime_dir, "cache")
        os.makedirs(self.settings_dir, exist_ok=True)
        os.makedirs(self.cache_dir, exist_ok=True)
        self._data = self._load()

    def _load(self) -> Dict[str, Any]:
        if os.path.exists(self.library_path):
            try:
                with open(self.library_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict):
                    loaded.setdefault("version", 1)
                    merged_settings = dict(DEFAULT_SETTINGS)
                    merged_settings.update(loaded.get("settings", {}))
                    loaded["settings"] = merged_settings
                    loaded.setdefault("games", {})
                    loaded.setdefault("guide_progress", {})
                    return loaded
            except Exception:
                pass
        return {
            "version": 1,
            "settings": dict(DEFAULT_SETTINGS),
            "games": {},
            "guide_progress": {},
        }

    def _save(self) -> None:
        _atomic_write_json(self.library_path, self._data)

    def get_settings(self) -> Dict[str, Any]:
        return dict(self._data["settings"])

    def update_settings(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        for key in DEFAULT_SETTINGS:
            if key in patch:
                self._data["settings"][key] = patch[key]
        self._save()
        return self.get_settings()

    def get_library(self) -> Dict[str, Any]:
        games = list(self._data["games"].values())
        # Bookmarked games first, then most recently read
        games.sort(
            key=lambda g: (1 if g.get("bookmarked") else 0, float(g.get("updated_at", 0.0))),
            reverse=True,
        )
        return {
            "games": games,
            "settings": self.get_settings(),
        }

    def get_game_entry(self, game_key: str) -> Optional[Dict[str, Any]]:
        entry = self._data["games"].get(game_key)
        return dict(entry) if entry else None

    def get_guide_progress(self, source: str, guide_id: str) -> Optional[Dict[str, Any]]:
        key = f"{source}:{guide_id}"
        entry = self._data["guide_progress"].get(key)
        return dict(entry) if entry else None

    def save_progress(
        self,
        game_key: str,
        appid: int,
        game_name: str,
        game_image: str,
        source: str,
        guide_id: str,
        guide_title: str,
        guide_author: str,
        section_index: int,
        section_id: str,
        section_title: str,
        total_sections: int,
        scroll_ratio: float,
        bookmarked: Optional[bool] = None,
    ) -> Dict[str, Any]:
        now = time.time()
        clamped_ratio = max(0.0, min(1.0, float(scroll_ratio)))
        clamped_idx = max(0, int(section_index))

        existing = self._data["games"].get(game_key, {})
        is_bookmarked = (
            bool(bookmarked)
            if bookmarked is not None
            else bool(existing.get("bookmarked", False))
        )

        game_record = {
            "game_key": game_key,
            "appid": int(appid or existing.get("appid", 0) or 0),
            "game_name": game_name or existing.get("game_name", "Unknown Game"),
            "game_image": game_image or existing.get("game_image", ""),
            "bookmarked": is_bookmarked,
            "active_source": source,
            "active_guide_id": guide_id,
            "active_guide_title": guide_title,
            "active_guide_author": guide_author,
            "section_index": clamped_idx,
            "section_id": section_id,
            "section_title": section_title,
            "total_sections": max(1, int(total_sections or 1)),
            "scroll_ratio": clamped_ratio,
            "pinned_sections": existing.get("pinned_sections", []),
            "updated_at": now,
        }
        self._data["games"][game_key] = game_record

        guide_key = f"{source}:{guide_id}"
        self._data["guide_progress"][guide_key] = {
            "section_index": clamped_idx,
            "section_id": section_id,
            "section_title": section_title,
            "total_sections": max(1, int(total_sections or 1)),
            "scroll_ratio": clamped_ratio,
            "updated_at": now,
        }

        self._prune_unbookmarked_history(max_recent=25)
        self._save()
        return game_record

    def set_game_bookmarked(
        self,
        game_key: str,
        bookmarked: bool,
        appid: int = 0,
        game_name: str = "",
        game_image: str = "",
    ) -> Dict[str, Any]:
        existing = self._data["games"].get(game_key)
        now = time.time()
        if existing:
            existing["bookmarked"] = bool(bookmarked)
            if game_name:
                existing["game_name"] = game_name
            if game_image:
                existing["game_image"] = game_image
            if appid:
                existing["appid"] = int(appid)
            existing["updated_at"] = existing.get("updated_at", now)
            record = existing
        else:
            record = {
                "game_key": game_key,
                "appid": int(appid or 0),
                "game_name": game_name or "Unknown Game",
                "game_image": game_image,
                "bookmarked": bool(bookmarked),
                "active_source": "",
                "active_guide_id": "",
                "active_guide_title": "",
                "active_guide_author": "",
                "section_index": 0,
                "section_id": "",
                "section_title": "",
                "total_sections": 0,
                "scroll_ratio": 0.0,
                "pinned_sections": [],
                "updated_at": now,
            }
            self._data["games"][game_key] = record

        self._save()
        return record

    def toggle_pinned_section(
        self,
        game_key: str,
        guide_id: str,
        source: str,
        section_index: int,
        section_id: str,
        section_title: str,
    ) -> List[Dict[str, Any]]:
        game = self._data["games"].get(game_key)
        if not game:
            return []
        pins: List[Dict[str, Any]] = game.setdefault("pinned_sections", [])
        for i, p in enumerate(pins):
            if (
                p.get("guide_id") == guide_id
                and p.get("source") == source
                and p.get("section_id") == section_id
            ):
                pins.pop(i)
                self._save()
                return list(pins)
        pins.append(
            {
                "guide_id": guide_id,
                "source": source,
                "section_index": int(section_index),
                "section_id": section_id,
                "section_title": section_title,
                "created_at": time.time(),
            }
        )
        self._save()
        return list(pins)

    def remove_game(self, game_key: str) -> bool:
        removed = self._data["games"].pop(game_key, None)
        if removed is not None:
            self._save()
            return True
        return False

    def _prune_unbookmarked_history(self, max_recent: int = 25) -> None:
        unbookmarked = [
            (k, v)
            for k, v in self._data["games"].items()
            if not v.get("bookmarked")
        ]
        if len(unbookmarked) <= max_recent:
            return
        unbookmarked.sort(key=lambda kv: float(kv[1].get("updated_at", 0.0)))
        to_remove = len(unbookmarked) - max_recent
        for k, _ in unbookmarked[:to_remove]:
            self._data["games"].pop(k, None)

    def _cache_path(self, source: str, guide_id: str) -> str:
        safe = _safe_filename(guide_id)
        if len(safe) > 100:
            digest = hashlib.md5(guide_id.encode("utf-8")).hexdigest()[:12]
            safe = f"{safe[:80]}_{digest}"
        name = f"{_safe_filename(source)}_{safe}.json"
        return os.path.join(self.cache_dir, name)

    def get_cached_guide(self, source: str, guide_id: str) -> Optional[Dict[str, Any]]:
        path = self._cache_path(source, guide_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get("sections"):
                data["cached"] = True
                return data
        except Exception:
            pass
        return None

    def save_cached_guide(self, source: str, guide_id: str, guide_data: Dict[str, Any]) -> None:
        path = self._cache_path(source, guide_id)
        payload = dict(guide_data)
        payload["cached_at"] = time.time()
        _atomic_write_json(path, payload)

    def clear_cache(self) -> int:
        count = 0
        if not os.path.isdir(self.cache_dir):
            return 0
        for fname in os.listdir(self.cache_dir):
            if fname.endswith(".json"):
                try:
                    os.remove(os.path.join(self.cache_dir, fname))
                    count += 1
                except OSError:
                    pass
        return count
