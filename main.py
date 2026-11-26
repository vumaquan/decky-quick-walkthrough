import asyncio
import os
import sys
from typing import Any, Dict, List, Optional

import decky

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

from py_modules.storage import WalkthroughStorage
from py_modules.walkthrough_sources import (
    diagnose_connectivity,
    fetch_guide_content,
    list_guides_for_game,
    parse_guide_from_raw_html,
    search_games,
    search_walkthroughs,
)


class Plugin:
    storage: Optional[WalkthroughStorage] = None
    loop: Optional[asyncio.AbstractEventLoop] = None

    def _ensure_storage(self) -> WalkthroughStorage:
        if self.storage is None:
            settings_dir = getattr(
                decky, "DECKY_PLUGIN_SETTINGS_DIR", ""
            ) or os.path.join(PLUGIN_DIR, ".settings")
            runtime_dir = getattr(
                decky, "DECKY_PLUGIN_RUNTIME_DIR", ""
            ) or os.path.join(PLUGIN_DIR, ".runtime")
            self.storage = WalkthroughStorage(
                settings_dir=settings_dir,
                runtime_dir=runtime_dir,
            )
        return self.storage

    async def _main(self) -> None:
        self.loop = asyncio.get_event_loop()
        self._ensure_storage()
        decky.logger.info("Quick Walkthrough plugin initialized")

    async def _unload(self) -> None:
        decky.logger.info("Quick Walkthrough plugin unloading")

    async def _uninstall(self) -> None:
        decky.logger.info("Quick Walkthrough plugin uninstalling")

    async def _run_sync(self, fn, *args, **kwargs):
        loop = self.loop or asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def get_library(self) -> Dict[str, Any]:
        return self._ensure_storage().get_library()

    async def get_game_entry(self, game_key: str) -> Optional[Dict[str, Any]]:
        return self._ensure_storage().get_game_entry(game_key)

    async def update_settings(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        return self._ensure_storage().update_settings(patch)

    async def search_games(self, query: str) -> List[Dict[str, Any]]:
        try:
            return await self._run_sync(search_games, query)
        except Exception as exc:
            decky.logger.exception(f"search_games failed: {exc}")
            raise

    async def search_walkthroughs(
        self,
        query: str,
        appid: int = 0,
        game_name: str = "",
        location_hint: str = "",
        walkthrough_only: bool = True,
        english_only: bool = True,
    ) -> Dict[str, Any]:
        try:
            settings = self._ensure_storage().get_settings()
            return await self._run_sync(
                search_walkthroughs,
                query=query,
                appid=appid,
                game_name=game_name,
                location_hint=location_hint,
                walkthrough_only=walkthrough_only,
                english_only=english_only,
                google_api_key=settings.get("google_api_key", ""),
                google_cx=settings.get("google_cx", ""),
            )
        except Exception as exc:
            decky.logger.exception(f"search_walkthroughs failed: {exc}")
            raise

    async def list_guides(
        self,
        appid: int = 0,
        game_name: str = "",
        game_image: str = "",
        search_text: str = "",
        walkthrough_only: bool = True,
        english_only: bool = True,
        wiki_slug: str = "",
        location_hint: str = "",
    ) -> Dict[str, Any]:
        try:
            return await self._run_sync(
                list_guides_for_game,
                appid=appid,
                game_name=game_name,
                game_image=game_image,
                search_text=search_text,
                walkthrough_only=walkthrough_only,
                english_only=english_only,
                wiki_slug=wiki_slug,
                location_hint=location_hint,
            )
        except Exception as exc:
            decky.logger.exception(f"list_guides failed: {exc}")
            raise

    async def get_guide(
        self,
        source: str,
        guide_id: str,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        storage = self._ensure_storage()
        if not force_refresh:
            cached = storage.get_cached_guide(source, guide_id)
            if cached is not None:
                cached["saved_progress"] = storage.get_guide_progress(source, guide_id)
                return cached

        try:
            guide = await self._run_sync(fetch_guide_content, source, guide_id)
            settings = storage.get_settings()
            if settings.get("auto_cache_saved", True):
                storage.save_cached_guide(source, guide_id, guide)
            guide["cached"] = False
            guide["saved_progress"] = storage.get_guide_progress(source, guide_id)
            return guide
        except Exception as exc:
            cached = storage.get_cached_guide(source, guide_id)
            if cached is not None:
                cached["stale_offline"] = True
                cached["saved_progress"] = storage.get_guide_progress(source, guide_id)
                return cached
            decky.logger.exception(f"Failed to fetch guide {source}:{guide_id}: {exc}")
            raise

    async def save_progress(
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
        return self._ensure_storage().save_progress(
            game_key=game_key,
            appid=appid,
            game_name=game_name,
            game_image=game_image,
            source=source,
            guide_id=guide_id,
            guide_title=guide_title,
            guide_author=guide_author,
            section_index=section_index,
            section_id=section_id,
            section_title=section_title,
            total_sections=total_sections,
            scroll_ratio=scroll_ratio,
            bookmarked=bookmarked,
        )

    async def set_game_bookmarked(
        self,
        game_key: str,
        bookmarked: bool,
        appid: int = 0,
        game_name: str = "",
        game_image: str = "",
    ) -> Dict[str, Any]:
        return self._ensure_storage().set_game_bookmarked(
            game_key=game_key,
            bookmarked=bookmarked,
            appid=appid,
            game_name=game_name,
            game_image=game_image,
        )

    async def toggle_pinned_section(
        self,
        game_key: str,
        guide_id: str,
        source: str,
        section_index: int,
        section_id: str,
        section_title: str,
    ) -> List[Dict[str, Any]]:
        return self._ensure_storage().toggle_pinned_section(
            game_key=game_key,
            guide_id=guide_id,
            source=source,
            section_index=section_index,
            section_id=section_id,
            section_title=section_title,
        )

    async def remove_game(self, game_key: str) -> bool:
        return self._ensure_storage().remove_game(game_key)

    async def parse_guide_html(
        self,
        source: str,
        guide_id: str,
        html: str,
    ) -> Dict[str, Any]:
        storage = self._ensure_storage()
        guide = await self._run_sync(parse_guide_from_raw_html, source, guide_id, html)
        settings = storage.get_settings()
        if settings.get("auto_cache_saved", True) and guide.get("sections"):
            storage.save_cached_guide(source, guide_id, guide)
        guide["cached"] = False
        guide["saved_progress"] = storage.get_guide_progress(source, guide_id)
        return guide

    async def diagnose_network(self) -> List[Dict[str, Any]]:
        return await self._run_sync(diagnose_connectivity)

    async def clear_cache(self) -> int:
        return self._ensure_storage().clear_cache()
