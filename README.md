## Quick Walkthrough

**Quick Walkthrough** is a Decky Loader plugin for SteamOS / Steam Deck Gaming Mode that lets you search, translate, and read live game walkthroughs right alongside your game without switching to Desktop Mode or an external browser.

### Key Features
- **Automatic Running Game & Location Detection**: Detects your currently active Steam or non-Steam game (plus Steam Rich Presence hints when available) and shows it at the top of Search with chapter/location filtering.
- **Google-First Walkthrough Results & Configurable Quick Search**: Automatically displays Google Search results by default in Walkthrough Results (with multi-source backend fallback across **IGN Wikis**, **PowerPyx**, **PC Gamer**, **Game8**, **Steam Community Guides**, and **StrategyWiki**), plus a customizable **Quick Search** button in Settings (**IGN Wikis**, **PowerPyx**, **PC Gamer**, **Game8**, **Steam Community Guides**, **GameFAQs**, or **StrategyWiki**) alongside **Google Search**.
- **Live Embedded Chromium Reader (QAM & Fullscreen)**:
  - View live guide webpages directly inside the Quick Access Menu (`...`) or expand to Fullscreen (`Read`).
  - **One-Tap Google Translate**: Built-in toolbar button toggles full-page Google Translate on/off while preserving clean canonical URLs for bookmarks, with configurable target language in Settings (`Auto`, `English`, `Tiếng Việt`, `Japanese`, `Chinese`, `Korean`, `Spanish`, `French`, `German`).
  - **Built-in AdBlock**: Enabled by default (toggleable in Settings) to hide ad banners, floating video ads, and ad frames for cleaner reading.
  - Auto-hides top toolbars by default in QAM (`Show toolbar`) to maximize reading area, with **Zoom** (`65%–130%`) and **Mobile Fit** (`Fit`).
  - Keeps pages loaded in memory when closing and reopening the Quick Access Menu so you never lose your spot.
- **Saved Library & Bookmarks**: Bookmark pages and quickly resume recent guides across sessions (`localStorage` + Decky backend storage).
- **Bilingual UI**: Defaults to **English**, with **Vietnamese (`Tiếng Việt`)** selectable in Settings.
- **SteamOS Network Diagnostics**: Built-in connectivity check in Settings to troubleshoot guide sources.
