# Changelog

All notable changes to anyBot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.2.21] - 2026-09-22

### Added
- **Bot action menu**: Hover "…" (ellipsis) menu on each bot row in the left sidebar for quick Edit and Delete actions (PR #15)
- Keyboard-accessible menu trigger that's always reachable via focus
- Confirmation dialog for Delete action that clearly names the bot and explains the archive behavior
- `shouldShowUpdateChrome(update)` helper for consistent update UI gating across components
- Tests for update chrome visibility logic

### Fixed
- **Update button visibility**: Sidebar Update button and Settings update banner now only appear when an update is actually available or in progress (available, checking, downloading, downloaded, error states), not merely when the update feed is configured
- Removed dangerous default that caused `UpdateButton` to show as "available" when no update state was present

## [0.2.20]

### Added
- **Projects**: Group chats are now called "Projects" with configurable settings
- Project settings: Allowed folders and default artifacts folder per project
- Artifacts are automatically copied to the project artifacts folder when set
- Project allowed folders are included in agent prompts for context

### Fixed
- Settings page no longer shows "Update feed not configured" when the built-in default feed is active
- **Sidebar footer layout stability**: Update button no longer warps/squeezes the user profile row; flex layout now keeps avatar and username stable across all update states (idle, downloading, installing)

### Changed
- electron-builder publish config now targets `gilfila/anyBot-updates` so packaged installers embed the correct update feed URL
- NSIS installer uses stable artifact naming pattern (`${productName}-Setup-${version}.${ext}`)

## [0.2.19]

### Added
- **Bot avatar personalization**: Customizable slime avatars with 10 colors, 6 shapes, and 6 face expressions (PR #11)
- Avatar config stored per-employee with live preview in create/edit forms
- Deterministic default avatars based on name hash and harness type
- **Context Rail**: Unified right sidebar with Context, Deliverables, and Tools tabs (PR #11)
- Tools tab contains Browser, Terminal, and File Explorer panels
- HTML previews auto-open in the right sidebar Browser panel
- Collapsible right rail toggle

### Fixed
- **Claude permission mode mapping**: `dontAsk` now correctly maps to Claude CLI's `acceptEdits` mode instead of auto-denying operations (PR #10)
- Updated permission mode UI labels for accuracy: "Ask before acting" / "Allow edits automatically"
- Default permission mode changed to `ask` (prompting) for safer new employee creation

## [0.2.18]

### Changed
- **Silent in-app updates**: Updates install fully behind the scenes with no NSIS Setup wizard
- `quitAndInstall(true, true)` enables silent install mode (`/S` flag) with auto-restart
- NSIS config changed to `oneClick: true` for silent upgrade support
- Per-user install (`perMachine: false`, `allowElevation: false`) avoids UAC prompts
- In-app progress UI: Downloading → Installing → Restarting (no external windows)
- Update button remains beside the logged-in user name

## [0.2.17]

### Added
- **Security audit and privacy hardening** before public release (PR #7)
- `SECURITY-AUDIT.md` with comprehensive audit report
- `scripts/security-scan.sh` repeatable scan script for pre-commit/CI
- Hardened `.gitignore` with 60+ patterns for credentials, secrets, and sensitive files

### Fixed
- Removed screenshot containing visual PII (`docs/assets/installed-anybot-ui.jpg`)
- Anonymized Windows user paths in documentation

## [0.2.16]

### Added
- **One-click in-app updater**: Update button in sidebar footer downloads and installs updates without leaving the app (PR #8)
- Update states: available → downloading (with progress) → ready to restart → installing
- Secure electron-updater integration with configurable public update feed URL
- Default update feed URL pointing to `gilfila/anyBot-updates` releases
- Manual "Check for updates" in Settings for on-demand version checking
- Error handling with retry capability for failed update operations

### Security
- No embedded tokens: private source repo remains private; binaries served from separate public endpoint
- Update feed URL must be HTTPS without embedded credentials

## [0.2.15]

### Added
- Formatted agent outputs: Markdown rendering, code blocks with language labels, XSS-safe HTML preview (PR #6)
- In-app Browser panel for previewing HTML artifacts and navigating URLs
- In-app Terminal panel with streaming command output
- In-app File Explorer panel for workspace navigation
- Workspace tools toggle buttons in topbar (Browser, Terminal, Files)

## [0.2.14]

### Added
- Slime avatars for employees (PR #4)
- Working indicator at the bottom of chat (PR #4)
- Collapsible sidebars (PR #4)

## [0.2.13]

### Added
- UI polish: dismissible banners, simplified sidebar, unread indicators (PR #1)
- Update notification near Settings when new releases are available (PR #2)

## [0.2.12]

### Changed
- Bump version and installer references for initial Windows packaging.
