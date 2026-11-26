# Quick Walkthrough (Decky Loader Plugin for SteamOS)

A **Decky Loader** plugin by **maQuan** for Steam Deck / SteamOS Gaming Mode that lets you search, translate, ad-block, zoom, and bookmark live game walkthroughs directly inside the Quick Access Menu (`...`) or Fullscreen without leaving your game.

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

- **Running Game Detection**: Automatically identifies the game you are currently playing to look up matching walkthroughs right away, with optional filtering by chapter, boss, or area.
- **Multi-Source Search**: Shows Google Search walkthrough results by default (with fallback across **IGN Wikis**, **PowerPyx**, **PC Gamer**, **Game8**, **Steam Community Guides**, and **StrategyWiki**), plus a configurable **Quick Search** shortcut in Settings to jump straight to your preferred guide site (**IGN Wikis**, **PowerPyx**, **PC Gamer**, **Game8**, **Steam Community Guides**, **GameFAQs**, or **StrategyWiki**).
- **In-Game Guide Reader (Sidebar & Fullscreen)**:
  - Read live guide webpages directly inside the Quick Access sidebar (`...`) or expand to Fullscreen without leaving your game.
  - Keeps your opened page intact across menu toggles so you never lose your place when returning to gameplay.
  - Built-in **AdBlock** (enabled by default, toggleable in Settings) hides banner and floating ads for cleaner reading.
  - One-tap **Google Translate** translates guides into your chosen language (configurable in Settings).
  - Collapsible toolbar, **Zoom** (`65%–130%`), and **Mobile Fit** formatting maximize reading space on the Steam Deck screen.
- **Bookmarks & Recent Guides**: Save walkthrough pages and quickly resume where you left off across sessions.
- **Bilingual Interface**: Supports **English** (default) and **Vietnamese (`Tiếng Việt`)** in Settings.

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
