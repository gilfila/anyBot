# Changelog

All notable changes to anyBot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.18]

- **Silent in-app updates**: Updates install fully behind the scenes with no NSIS Setup wizard
- `quitAndInstall(true, true)` enables silent install mode (`/S` flag) with auto-restart
- NSIS config changed to `oneClick: true` for silent upgrade support
- Per-user install (`perMachine: false`, `allowElevation: false`) avoids UAC prompts
- In-app progress UI: Downloading → Installing → Restarting (no external windows)
- Update button remains beside the logged-in user name

## [0.2.16]

- One-click in-app updater: Update button in sidebar footer downloads and installs updates without leaving the app
- Update states: available → downloading (with progress) → ready to restart → installing
- Secure electron-updater integration with configurable public update feed URL
- No embedded tokens: private source repo remains private; binaries served from separate public endpoint
- Manual "Check for updates" in Settings for on-demand version checking
- Error handling with retry capability for failed update operations

## [0.2.15]

- Formatted agent outputs: Markdown rendering, code blocks with language labels, XSS-safe HTML preview (PR #6)
- In-app Browser panel for previewing HTML artifacts and navigating URLs
- In-app Terminal panel with streaming command output
- In-app File Explorer panel for workspace navigation
- Workspace tools toggle buttons in topbar (Browser, Terminal, Files)

## [0.2.14]

- Slime avatars for employees (PR #4)
- Working indicator at the bottom of chat (PR #4)
- Collapsible sidebars (PR #4)

## [0.2.13]

- UI polish: dismissible banners, simplified sidebar, unread indicators (PR #1)
- Update notification near Settings when new releases are available (PR #2)

## [0.2.12]

- Bump version and installer references for initial Windows packaging.
