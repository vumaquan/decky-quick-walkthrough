# Quick Walkthrough (Decky Loader Plugin for SteamOS)

A **Decky Loader** plugin by **maQuan** for Steam Deck / SteamOS Gaming Mode that lets you search, translate, ad-block, zoom, and bookmark live web game walkthroughs directly inside the Quick Access Menu (`...`) or Fullscreen (`/quick-walkthrough/reader`) without leaving your game.

## Installation (Steam Deck / SteamOS)

> **Prerequisite:** [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) must already be installed on your Steam Deck.

### Method 1: Install from URL (Recommended)
1. In **Gaming Mode**, press **`...` (Quick Access)** → open the **Decky** tab (plug icon) → tap **Settings (`⚙`)**.
2. Under **General**, enable **Developer Mode**.
3. Open the **Developer** section in Decky Settings.
4. Choose **Install Plugin from URL** and paste the latest ZIP link from the [Releases](https://github.com/vumaquan/decky-quick-walkthrough/releases) page:
   ```text
   https://github.com/vumaquan/decky-quick-walkthrough/releases/download/v1.4.2/decky-quick-walkthrough-v1.4.2.zip
   ```
5. Confirm installation — **Quick Walkthrough** will appear immediately in your Decky plugin list.

### Method 2: Install from Local ZIP
1. Download the latest `decky-quick-walkthrough-v*.zip` from [GitHub Releases](https://github.com/vumaquan/decky-quick-walkthrough/releases) on your Steam Deck (e.g. into `/home/deck/Downloads/`).
2. In **Gaming Mode**, open **Decky Settings (`⚙`)** → enable **Developer Mode** → go to **Developer** → **Install Plugin from ZIP**.
3. Select the downloaded `.zip` file and confirm.

### Method 3: Manual Install (Desktop Mode / SSH)
1. Download and unzip the latest release ZIP into `/home/deck/homebrew/plugins/` so that `/home/deck/homebrew/plugins/decky-quick-walkthrough/plugin.json` exists.
2. Restart Decky Loader:
   ```bash
   sudo systemctl restart plugin_loader
   ```

## Key Features

- **Automatic Running Game & Location Detection**: Detects your currently active Steam or non-Steam game (`Router.MainRunningApp`) and Steam Rich Presence hints, placing the running game box at the top of Search with chapter/boss/location filtering.
- **Google-First Walkthrough Results & Configurable Quick Search**: Automatically populates Walkthrough Results from Google Search (with multi-source backend fallback across **IGN Wikis**, **PowerPyx**, **PC Gamer**, **Game8**, **Steam Community Guides**, and **StrategyWiki**), plus a customizable **Quick Search** button in Settings (**IGN Wikis**, **PowerPyx**, **PC Gamer**, **Game8**, **Steam Community Guides**, **GameFAQs**, or **StrategyWiki**) alongside **Google Search**.
- **Live Embedded Chromium `BrowserView` in QAM & Fullscreen**:
  - Renders live guide websites directly inside the QAM mini panel (with automatic coordinate alignment) and Fullscreen (`Read` button).
  - **One-Tap Google Translate**: Built-in toolbar button toggles full-page Google Translate on/off while saving canonical original URLs in bookmarks, with configurable target language in Settings (`Auto`, `English`, `Tiếng Việt`, `Japanese`, `Chinese`, `Korean`, `Spanish`, `French`, `German`).
  - **Built-in AdBlock**: Enabled by default (toggleable in Settings) to hide ad banners, floating video ads, and ad frames for cleaner reading.
  - Auto-hides top toolbars by default (`Show toolbar`) to maximize reading space, with **Zoom** (`65%–130%`) and **Mobile Fit** (`Fit`).
  - Keeps pages loaded in memory across QAM open/close toggles (`alwaysRender: true`) so you never lose your spot.
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
