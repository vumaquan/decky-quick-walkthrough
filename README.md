# Quick Walkthrough (Decky Loader Plugin for SteamOS)

A **Decky Loader** plugin by **maQuan** for Steam Deck / SteamOS Gaming Mode that lets you search, read, zoom, and bookmark live web game walkthroughs directly inside the Quick Access Menu (`...`) or Fullscreen (`/quick-walkthrough/reader`) without leaving your game.

## Key Features

- **Running Game Detection (`Router.MainRunningApp`)**: Automatically detects the currently running game and Steam Rich Presence hints to find matching guides faster.
- **Multi-Source 1-Step Search**: Searches **IGN Wikis**, **PowerPyx**, **PC Gamer**, **Game8**, **Steam Community Guides**, and **StrategyWiki**.
- **Live Embedded Chromium `BrowserView` in QAM & Fullscreen**:
  - Renders live websites directly inside the QAM mini panel (with automatic coordinate alignment) and Fullscreen (`Read` button).
  - Keeps pages loaded in memory across QAM open/close toggles (`alwaysRender: true`) so you never lose your spot.
  - Defaults to hidden top toolbars (`Show toolbar`) to maximize reading area, with **Zoom** (`65%–130%`) and **Mobile Fit** (`Fit`) toggles.
- **Persistent Bookmarks & History**: Saves bookmarked pages and recent guides immediately in both `localStorage` and `DECKY_PLUGIN_SETTINGS_DIR/library.json`.
- **Bilingual UI (`English` & `Tiếng Việt`)**: Defaults to **English**, with **Vietnamese (`Tiếng Việt`)** selectable in Settings.

## Project Structure

- `plugin.json` — Decky Loader plugin metadata & store manifest
- `package.json` & `pnpm-lock.yaml` — Frontend build config & locked dependencies (`pnpm` v9)
- `main.py` — Decky Python backend RPC methods
- `py_modules/walkthrough_sources.py` — Multi-source search engine & connectivity diagnostics
- `py_modules/storage.py` — Persistent library, progress & settings storage
- `src/` — TypeScript/React frontend (`@decky/ui`, `@decky/api`)
- `tests/test_backend.py` — Python backend unit tests
- `LICENSE` — MIT License

## Build & Verify

```bash
pnpm i --frozen-lockfile
pnpm run typecheck
pnpm run build
npm run test:backend
```

To create a Developer Mode installable ZIP (`decky-quick-walkthrough-v<version>.zip`):

```bash
npm run package
```
