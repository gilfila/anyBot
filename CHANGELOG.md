# Changelog

All notable changes to anyBot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.2.27] - 2026-09-23

### Added
- **Voice settings** (Settings → Voice) with an optional **ElevenLabs connection**: paste an API key to get Scribe transcription and ElevenLabs voices, pick a default voice and model (Flash v2.5 or Multilingual v2), give each bot its own voice, and preview them. The key is encrypted with Electron `safeStorage` (DPAPI on Windows), used only from the main process, and never returned to the renderer. Local system speech stays the default.
- Voice chat and dictation record with a built-in voice-activity detector when ElevenLabs is connected, so they work in the desktop app, where Chromium's speech recognition cannot.
- **Voice on the phone**: the phone follows the desktop's Voice settings. With ElevenLabs connected, the phone records audio and the desktop transcribes and speaks through new gateway endpoints (`GET /v1/voice`, `POST /v1/voice/transcribe`, `POST /v1/voice/speak`). The key stays on the desktop, and each bot keeps its voice. Access is limited to contributor or operator devices, at 30 calls a minute per device, and is audited. Without a key, the installed app uses the phone's own speech recognition and text-to-speech (`@capgo/capacitor-speech-recognition`, `@capacitor-community/text-to-speech`).
- Phone voice chat is now a continuous conversation like the desktop: it listens, says "On it.", waits for the reply, speaks it, and listens again. Desktop and phone share the same reply-wait logic (`src/lib/voice-turn.js`).

### Fixed
- **Voice chat gave up after 24 seconds**: it now waits for the bot's run to finish, however long it takes, says "On it." straight away, and gives a short "still working" cue on long runs. Failed runs are reported aloud. Mobile voice chat no longer times out after 24 seconds either.
- **Voice chat could hear itself**: the microphone now pauses while the bot works and speaks, then resumes.
- **Replies were read out as raw markdown**, including code blocks, tables and artifact manifests. Spoken replies are now a short cleaned-up summary (`src/lib/speech.js`) that points to the chat for details, and system voices speak in sentence-sized chunks so long replies aren't cut off.
- The voice button could say "Stop voice chat" after listening had already ended. Voice now also stops cleanly when you switch conversations.
- "System speech recognition isn't available" is now explained clearly (Chromium's recognizer returns `network` in Electron), rather than showing a bare error code.

- **The phone apps never declared microphone access**, so voice couldn't work once installed. Added Android `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` and speech-service `<queries>`, and iOS microphone and speech-recognition usage descriptions.

### Security
- Electron granted every permission request by default, so a remote page in the rail browser could use the microphone or camera. Only the app page may now use the microphone (audio only); other permissions are denied apart from clipboard write and fullscreen for the app page.

## [0.2.26] - 2026-09-22

### Changed
- **Studio paper redesign**: warm paper surfaces, near-black ink type, and a single vermilion signal color (unread, live work, send, updates). Every color in `style.css` now resolves to OKLCH design tokens on `:root`; body text moves from 11–13px low-contrast grey to 13.5–14.5px ink.
- **Team page is a live roster**: each bot shows its status and what it is doing right now (last line of streaming output, the queued assignment, or its latest reply). The marketing hero and principle cards are gone from populated workspaces; first run gets a focused "Hire your first bot" flow with role templates.
- **Conversations**: your messages are right-aligned ink bubbles, handoffs are quoted briefs with a label, coordinator notices are quiet centred lines, and streaming run output is shown in a bounded mono panel.
- **Sidebar**: bot rows show role or live status ("Working…", "Queued"); the non-functional "My workspace" card is removed; a pending update gets a full-width button instead of squeezing the owner row.
- **Markdown**: ordered lists, blockquotes, horizontal rules, and bare URL auto-linking.
- Routine intervals read as "Every week" / "Every 2 hours" instead of raw minutes.

### Fixed
- **Dismissing failed-run notices did nothing**: `runs.dismiss` was missing from the desktop IPC allowlist, so every dismiss failed with "Operation not allowed" (since 0.2.21). Added a static test that every method the renderer calls is allowlisted.
- **Update chrome flickered after any action**: only `snapshot` responses carried updater and tray state, so the Update button and settings toggles vanished for up to 4s after each command. All command responses now include it.
- **"Check now" could discard a downloaded update**: re-checking while downloading or ready-to-restart reset the state to "available". Checks are now skipped in those states. Periodic checks also run while a dismissed update is pending, so a newer release still surfaces.
- **Unread dots**: the open conversation no longer shows as unread while you watch replies arrive, your own last message no longer marks a conversation unread, and read state survives restarts.
- **Links in employee messages** now open in the system browser (they were silently blocked); "Open external" in the rail browser works for the same reason.
- **HTML "Open in Browser"** from a preview did nothing when the rail browser had no page loaded.
- **The in-app browser could never load a web page**: the renderer CSP (`default-src 'self'`) blocked all framing. Added `frame-src https: http:`; remote pages stay cross-origin and sandboxed.
- **Owner block CSS leaked onto your messages** (`.user` matched `.message.user`), adding a stray rule and padding above each of your messages.
- Sidebar said "Closing the window shuts down the local runtime" while tray mode (the default) keeps it running.
- Enter no longer sends mid-IME composition; voice chat no longer compares against stale messages.
- File explorer no longer fails a whole folder when one entry is locked; the terminal's 60s timeout is cleared when a command exits.

### Security
- **Employee HTML previews could reach `window.anybot`**: previews used a same-origin `blob:` iframe with `sandbox="allow-scripts allow-same-origin"`, which is equivalent to no sandbox and exposes the `runCommand` shell bridge. Previews now use `srcdoc` in an opaque-origin sandbox (`allow-scripts` only).
- **Markdown rendered raw HTML from employee output**: text is now HTML-escaped before markdown is applied, and links are limited to http, https, and mailto. Inline-HTML replies use a stricter sanitizer (no forms, frames, styles, or non-web URLs). Covered by `tests/markdown.test.mjs`.
- `openUrl` and new-window requests only hand http(s) URLs to the OS.

### CI
- **Desktop build failed on every push to main**: electron-builder auto-published on CI without a token. Packaging now runs with `--publish never` (releases to `anyBot-updates` stay manual; `latest.yml` is still generated), and the artifact upload uses the real file names instead of the stale 0.2.6 paths.
- **Android build**: `setup-android` splits `packages` on spaces, not newlines, so the multi-line list was read as one invalid package.
- `release:manifest` now hashes the `anyBot-Setup-X.Y.Z.exe` installer name electron-builder actually produces.
- `android/gradlew` is committed as executable (the Android job failed with "Permission denied" once SDK setup worked).

### Removed
- Dead code: the repo-root `main.cjs` (a stale 0.2.11 copy of `desktop/main.cjs`) and the unused `src/components/WorkspaceTools.jsx` (duplicated the context rail tools).

## [0.2.25] - 2026-09-22

### Changed
- **Bolder robot avatars**: Increased color saturation and contrast for robot avatars after user feedback that 0.2.24's colors were too muted
- **Richer color palette**: Avatar fills are more saturated, strokes are darker and richer, accent colors (eye glow, antenna, chest light) are hotter/more vivid
- **Stronger contrast**: Darker body shadows, brighter highlight stops, increased rim light opacity for better 3D depth
- **Improved small-size visibility**: Thicker outline strokes (1.5→2px), stronger drop shadows, and enhanced glow filters ensure robots read clearly at sidebar size (~25px)

### Technical
- `avatarColors` in constants.js updated with higher saturation hex values (same color keys/ids for config compatibility)
- Computed color adjustments in RobotAvatar: reduced highlight lightening (0.7→0.45), increased body darkening (0.08→0.18), stronger shadow darkening (0.2→0.35)
- SVG filters: drop shadow opacity 0.15→0.25, glow filter with added saturation matrix for hotter eye/antenna glow
- CSS drop-shadow filters strengthened for both normal and small avatar sizes

## [0.2.24] - 2026-09-22

### Changed
- **Robot avatars**: Replaced amorphous slime blob avatars with cute cartoony 2.5D robot characters featuring rounded heads, antennas, glowing eyes, and simple torsos
- **Robot head styles**: Six head shape variants (Dome, Square, Hexagon, Visor, Bubble, Angular) replace the old blob shapes
- **Robot eye styles**: Six eye style variants (Round, Oval, Visor, LED, Dots, Slits) replace the old face expressions
- **Desynchronized animations retained**: Each robot's idle (bob, blink, antenna glow) and working (bounce, eye pulse, arm wiggle) animations run with deterministic per-employee phase offsets
- **2.5D visual depth**: Linear gradients for head/body shading, rim lighting, drop shadows, and glowing antenna/eye effects create a faux-3D cartoony appearance

### Technical
- Renamed `SlimeAvatar.jsx` to `RobotAvatar.jsx` with complete SVG redesign
- New constants: `avatarHeadStyles` and `avatarEyeStyles` replace `avatarShapes` and `avatarFaces` (backward-compatible aliases retained)
- CSS custom properties renamed from `--slime-*` to `--robot-*` for animation timing control
- New keyframe animations: `robot-bob`, `robot-blink`, `robot-antenna-glow`, `robot-bounce`, `robot-eye-active`, `robot-arm-wiggle`
- Animations respect `prefers-reduced-motion` (disabled when reduced motion preferred)
- Robot renders cleanly at sidebar small size (~25px) and larger card sizes (~40-80px)

## [0.2.23] - 2026-09-22

### Changed
- **Sidebar bots right-aligned**: Bot rows in the left sidebar BOTS list now align content (avatar + name) toward the right/main-pane edge for improved visual hierarchy
- **Enhanced slime avatar depth**: Richer volumetric appearance with radial gradients, softer outer drop-shadows, clearer specular highlights, inner shading, and rim lighting effects
- **Desynchronized avatar animations**: Each bot's idle (breathe, wobble, blink) and working (bounce, jiggle, look) animations now run with deterministic per-employee phase offsets derived from their seed hash, so multiple bots on screen animate visibly out of sync

### Technical
- Replaced linear gradient with multi-stop radial gradient for 3D body shading
- Added CSS custom properties (`--slime-breathe-delay`, `--slime-wobble-delay`, `--slime-blink-delay`, etc.) for animation timing control
- Added `drop-shadow` filter to `.slime-avatar` for softer outer glow
- SVG filter enhanced with colored shadow offset for depth
- Animation delays respect `prefers-reduced-motion` (animations disabled entirely when reduced motion preferred)

## [0.2.22] - 2026-09-22

### Fixed
- **Sidebar bot rows**: Fixed regression where bot rows in the BOTS list showed only an unread dot (and hover menu) instead of avatar and name. Root cause: CSS selectors `.conversation-list button` and `.bot-list button` were too broad, matching the nested `.bot-row-menu-trigger` and forcing `width: 100%` on it, which broke the flex layout. Changed to direct-child (`.conversation-list > button`) and specific class (`.bot-list .bot-row-main`) selectors (PR #16)

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
- **Run notice dismissals now persist**: Dismissed failed/interrupted/cancelled run notices stay dismissed after app restart (fixes issue where "bot issues keep coming back")

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
