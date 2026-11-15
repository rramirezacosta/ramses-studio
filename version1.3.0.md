# Ramses Studio v1.3.0

Released: 2026-11-14

## What's New

### Google Drive Sync

Two-way cloud sync for your entire song library — keep your songs and settings in sync across machines.

- **Two-way sync** with Google Drive for the song library
- **On-demand download** — download songs from Drive when needed and free local space
- **Per-song Drive actions** in the song context menu (upload, download, delete from Drive)
- **Drive badges** on synced songs' covers and sidebar indicators showing per-song location
- Polished Google Drive settings section with OAuth flow improvements

### Library & IndexedDB

The song library now persists in IndexedDB for faster load times and reliable state.

- **IndexedDB persistence** for the song library (breaking change)
- Full-screen **library management view** for browsing and organizing songs
- Redesigned library manager as an inline workspace view
- Improved library management UX and export options
- Preserve multi-word band names across import and rename
- Ignore leading articles (The, A, An) when sorting songs
- Prompt before re-importing an existing song

### Auto-Updater

Automatic update checking and downloading via GitHub Releases.

- **Auto-updater** integrated with `electron-updater`
- Title bar indicator shows update status (checking, downloading, ready)
- **Portable mode detection** — Windows portable and uninstalled AppImage users get a link to GitHub Releases for manual download
- Auto-download disabled by default; user confirms before downloading
- Automatic install on app quit after download

### Audio Performance

- **Waveform peak caching** per resolution to avoid recomputation on every resize

### UI & UX Improvements

- Redesigned library manager as an inline workspace view
- Cleaned up settings dialog and improved sidebar layout
- Improved empty library and newcomer onboarding experience
- Settings close button turns red on hover
- Title bar corner icons reordered with settings on the outer edge
- Widen settings dialog for better readability

### Packaging & Distribution

- **Windows NSIS installer** target for proper installation on Windows
- **RPM package** target for Fedora/RHEL-based distributions

### About & Legal

- Added **About dialog** with app version and credits
- Added **Privacy Policy** and **Terms of Use** pages
- About dialog links to privacy policy and terms of service
- Corrected project license to **GPLv3**
- Reworded about dialog copy in all languages

### Refactoring

- Replaced `yt-dlp` binary with pure-JS YouTube extractor for simpler distribution
- Stem splitter supports lazy model loading
- Restructured about dialog links in App component
- Reformatted privacy and terms HTML files

### Bug Fixes

- Brand link in legal pages navigates to home
- Corrected project license to GPLv3

---

## Upgrade Notes

- The song library now uses **IndexedDB** for persistence. On first launch, the app will migrate your existing library data automatically.
- If you use the Windows portable version, auto-update is unavailable — use the NSIS installer for automatic updates, or download new versions manually from [GitHub Releases](https://github.com/rramirezacosta/ramses-studio/releases).
