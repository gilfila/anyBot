# anyBot

anyBot is a local-first workspace for named AI employees. It combines a Grok-style team conversation UI with adapters for Claude Code, Codex CLI, Gemini CLI, Hermes, Cursor Agent CLI, and owner-configured harnesses. Employees can collaborate in a shared conversation, delegate bounded work to one another, preserve artifacts, run recurring routines, and remain available while the desktop runtime is available.

The current product is intentionally local-owner first. The Electron desktop app is the primary runtime; the mobile companion and headless server reuse the same coordinator and scoped HTTP gateway.

## Release history

### 0.2.16

- One-click in-app updater: Update button in sidebar footer downloads and installs updates without leaving the app
- Update states: available → downloading (with progress) → ready to restart → installing
- Secure electron-updater integration with configurable public update feed URL
- No embedded tokens: private source repo remains private; binaries served from separate public endpoint
- Manual "Check for updates" in Settings for on-demand version checking
- Error handling with retry capability for failed update operations

### 0.2.16

- Formatted agent outputs: Markdown rendering, code blocks with language labels, XSS-safe HTML preview (PR #6)
- In-app Browser panel for previewing HTML artifacts and navigating URLs
- In-app Terminal panel with streaming command output
- In-app File Explorer panel for workspace navigation
- Workspace tools toggle buttons in topbar (Browser, Terminal, Files)

### 0.2.14

- Slime avatars for employees (PR #4)
- Working indicator at the bottom of chat (PR #4)
- Collapsible sidebars (PR #4)

### 0.2.13

- UI polish: dismissible banners, simplified sidebar, unread indicators (PR #1)
- Update notification near Settings when new releases are available (PR #2)

### 0.2.12

- Bump version and installer references for initial Windows packaging.

## Start locally

```powershell
npm ci
npm start
```

Run the repeatable local acceptance gate with `npm run verify:local`. It runs the unit/integration suite, desktop renderer build, Electron runtime smoke, and mobile web/Capacitor sync checks in order.

`npm start` builds the renderer automatically before opening Electron, so a fresh checkout does not fail because `dist/` has not been generated yet.

The desktop shell attempts Electron's Chromium renderer sandbox first. On Windows hosts that reject the sandbox launch before page load, it retries with context isolation, disabled Node integration, and the same narrow IPC surface so the app remains usable.

The desktop app stores its SQLite workspace and employee workspaces under Electron's per-user application data directory. Closing the window hides anyBot to the tray while the coordinator and active employees continue running. Use **Quit and stop active work** from the tray when you need to stop it explicitly.

If Windows denies every persistent profile location, the desktop shell starts in an explicitly marked temporary profile so the app remains recoverable. Repair the profile permissions before relying on saved history or long-running work across restarts.

If the renderer or coordinator fails before the workspace appears, anyBot records the startup error in `startup.log` beside the SQLite workspace and shows the path in its error dialog.

### Windows launch recovery

If an older installation shows a Windows breakpoint dialog or does nothing, use the current NSIS installer [`release/anyBot Setup 0.2.16.exe`](release/anyBot%20Setup%200.2.16.exe), the verified launcher in [`release/Launch anyBot.cmd`](release/Launch%20anyBot.cmd), or [`release/win-unpacked/anyBot.exe`](release/win-unpacked/anyBot.exe). A portable self-extractor is available at [`release/anyBot 0.2.16.exe`](release/anyBot%200.2.16.exe) when the NSIS installer is inconvenient. Remove the stale **anyBot** entry from Windows Settings â†’ Apps before reinstalling; an ACL-corrupted `%LOCALAPPDATA%\\Programs\\anyBot` directory can prevent Windows from replacing the old executable.

To verify downloaded binaries against the tested build, run `npm run release:manifest` and compare the generated [`release/SHA256SUMS.txt`](release/SHA256SUMS.txt). The manifest is an integrity check, not a code-signing replacement.

### Automatic updates

anyBot 0.2.16+ supports one-click in-app updates via `electron-updater`. Updates are fetched from a **separate public binary-only repository**:

- **Source repo** (`gilfila/anyBot`): Private, contains source code
- **Update feed repo** (`gilfila/anyBot-updates`): Public, contains only compiled binaries and metadata

This separation keeps the source private while enabling automatic updates without embedding any tokens or credentials in the application.

**Default update feed:**

The built-in default feed URL is:
```
https://github.com/gilfila/anyBot-updates/releases/latest/download
```

To override with a custom feed, set the `ANYBOT_UPDATE_FEED_URL` environment variable:
```powershell
$env:ANYBOT_UPDATE_FEED_URL = "https://your-custom-feed.example.com/updates"
```

**Required release artifacts:**

When publishing a new version to `gilfila/anyBot-updates`, upload these files as release assets:

| File | Description | Required |
|------|-------------|----------|
| `anyBot Setup X.Y.Z.exe` | NSIS installer | Yes |
| `latest.yml` | electron-updater metadata | Yes |
| `anyBot Setup X.Y.Z.exe.blockmap` | Delta update data | Optional |

These files are generated by `npm run package` in the `release/` directory.

**Security considerations:**

- The source repository (`gilfila/anyBot`) remains private
- The update feed repo contains only compiled binaries and metadata — no source code
- No GitHub tokens, PATs, or credentials are embedded in the application
- The update feed URL must be HTTPS without embedded credentials
- electron-updater verifies checksums from `latest.yml` before installation
- For unsigned Windows builds, Windows SmartScreen may show a warning on first install
- Consider code signing for production releases to improve user experience

**Publishing updates:**

1. Build the installer in the source repo:
   ```powershell
   npm run package
   ```
2. Create a new release in `gilfila/anyBot-updates` with tag `vX.Y.Z`
3. Upload release assets from the `release/` directory:
   - `anyBot Setup X.Y.Z.exe`
   - `latest.yml`
   - `anyBot Setup X.Y.Z.exe.blockmap` (optional)
4. Users will see the update in-app automatically

Runtime & privacy includes an opt-in **Launch at login** setting. It starts the local runtime after you sign in so scheduled work and long-running employees remain available; the computer still needs to stay powered on.

Before creating an employee, install and authenticate the harness you want to use. The Harnesses view probes the current machine. Claude model choices come from the installed CLI; Codex, Gemini, and Hermes can use an owner-maintained [`models.json` catalog](docs/model-catalog.md), with a Custom model field for provider identifiers that are not known to the UI. The supported built-in adapters are:

- Claude Code
- Codex CLI
- Gemini CLI
- Hermes Agent
- Cursor Agent CLI

Owner-configured CLI adapters can be added through [`harnesses.json` guidance](docs/custom-harnesses.md). All harnesses execute under the desktop user's account and remain trusted local processes; a workspace directory is not an OS sandbox.

For a private VPS, the headless gateway supports configured human conversation ACLs and an optional short-lived RS256/OIDC token boundary. See [`docs/server.md`](docs/server.md) and [`server/config.vps-oidc.example.json`](server/config.vps-oidc.example.json); this does not yet provide multi-tenant worker isolation.

## Product behavior

- Named employees have a role, instructions, harness, model override, workspace, and bounded run duration.
- A run defaults to 10 minutes and can be configured per employee to 1 hour, 6 hours, or 24 hours. The harness stays active until it exits, is cancelled, or reaches that safety limit.
- Conversations support multiple employees and explicit structured delegation. Delegated child work returns to the parent employee through the coordinator.
- Routines persist in SQLite, skip missed occurrences, prevent overlap, and keep bounded checks running while the desktop runtime is available.
- Runs support pause, cancellation, stop-all, output streaming, artifact capture, content-addressed storage, and safe text previews.
- The app uses a sandboxed Electron renderer with narrow IPC and a separate coordinator utility process.

## Mobile and shared humans

The touch-first client lives in [`mobile`](mobile) and is built with Capacitor for Android and iOS:

```powershell
npm run mobile:dev
npm run mobile:build
npm run mobile:sync
npx playwright test --config playwright.mobile.config.mjs
```

The opt-in gateway requires TLS outside explicit loopback development mode. Pairing codes are single-use and expire after two minutes. Device capabilities are `viewer`, `contributor`, and `operator`. Configured human members can be bound to separate sessions, invited to conversations, and filtered from conversations they do not belong to; the desktop pairing panel lists configured members as a dropdown. See [mobile setup and security](docs/mobile.md).

The current Android debug APK is a development artifact. iOS source is synchronized but requires Xcode, signing, and a Mac for a real build. Push notifications, durable OS-protected mobile credentials, external identity/OIDC, and production store signing are not yet release-complete.

## Headless/VPS mode

The same coordinator can run without Electron:

```powershell
node server/index.mjs --config C:\path\to\server.json
```

Use loopback HTTP only for local development. A VPS deployment needs TLS or a private reverse proxy, persistent WAL-aware backups, exact origins, configured human members, a dedicated service account, and separately authenticated harnesses. See [headless server mode](docs/server.md). [`server/Dockerfile`](server/Dockerfile) is a starting image and intentionally does not package credentials, TLS keys, or a reverse proxy.

## Design and Open Design

The architecture and Phase 2 security model are documented in [design.md](design.md). The UI follows the installed Open Design direction recorded in [design/visual-direction.md](design/visual-direction.md). Open Design is a development tool, not a runtime dependency.

## Artifact test: Orbit Snake

[Open the playable Orbit Snake game](games/snake/index.html). It is a self-contained anyBot artifact built from a two-agent Mira/Sol conversation: procedural neon graphics, keyboard/WASD and swipe controls, a persistent top-five high-score board, and a responsive mobile layout. The build plan, technical notes, agent transcript, and acceptance tests live under [games/snake/docs](games/snake/docs).

## Verification

```powershell
npm test
npm run build
npm run test:runtime
npm run doctor
npx playwright test --config playwright.mobile.config.mjs
npx playwright test --config playwright.snake.config.mjs
```

`npm run doctor` prints detected harness executables and the model choices discovered from their local configuration without running a provider request.

To produce the Windows desktop deliverables locally:

```powershell
npm run package
npm run package:portable
npm run release:manifest
```

The first command creates the selectable-directory NSIS installer; the second creates the portable executable for hosts where the prior install directory is unusable.

`npm test` covers SQLite persistence, delegation, cancellation, artifact safety, routines, model discovery, subprocess failure paths, mobile gateway roles, human-member conversation ACLs, bounded run duration, headless server startup, and the Snake agent handoff. Provider-authenticated tests are opt-in because they depend on installed CLIs and account state. The current detailed evidence is in [docs/verification.md](docs/verification.md) and [docs/implementation-status.md](docs/implementation-status.md).

## Security boundaries

Employees run with the desktop or server account's configured credentials. anyBot does not copy OAuth secrets, bypass harness approvals, or claim that trusted local workspaces are OS sandboxes. Queue admission is idempotent, cancellation is explicit, and ambiguous interrupted work is not automatically replayed. Hosted multi-human deployment remains gated on external identity, durable organization membership, isolated workers, audit persistence, backups, and emergency revocation.
