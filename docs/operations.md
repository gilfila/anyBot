# Running, updating, and releasing anyBot

This page covers the technical side of anyBot. For the features, see the [README](../README.md). The architecture and security model are in [design.md](../design.md).

## Run from source

```powershell
npm ci
npm start
```

`npm start` builds the renderer first, so a fresh checkout works without a separate build step.

A run from source uses its own profile, `%APPDATA%\anybot-desktop-dev`, not the installed app's `%APPDATA%\anybot-desktop`. So a checkout never migrates the live database, never runs your real bots, routines, Slack or phone link from unreleased code, and never rewrites the Launch at login entry (a run from source only saves that choice). To run a checkout against another profile, the live one included, set `ANYBOT_USER_DATA` to its folder first; test scripts that set their own profile keep it.

`npm run verify:local` is the local acceptance gate. It runs these in order:

1. the unit and integration suite (`npm test`)
2. the renderer build (`npm run build`)
3. the Electron runtime smoke test (`npm run test:runtime`)
4. the Electron thread-collaboration end-to-end test (`npm run test:e2e`)
5. the Electron 3D bot recovery test (`npm run test:avatars`)
6. the mobile web build and Capacitor sync (`npm run mobile:sync`)
7. installed-harness and model discovery (`npm run doctor`)

The desktop shell tries Electron's Chromium renderer sandbox first. Some Windows hosts reject the sandbox before the page loads. On those, anyBot retries with context isolation on, Node integration off, and the same narrow IPC surface.

## Where anyBot keeps its data

- **Workspace:** the SQLite workspace and each employee's workspace folder live in Electron's per-user application data directory.
- **Temporary profile:** if Windows denies every persistent profile location, anyBot starts in a clearly marked temporary profile so the app stays recoverable. Repair the profile permissions before relying on saved history or long-running work.
- **Startup errors:** if the renderer or coordinator fails before the workspace appears, the error goes to `startup.log` beside the SQLite workspace. The error dialog shows the path. After the window has loaded there is no blocking dialog: a crashed window reloads by itself (up to three times in two minutes), and the bots, Slack and the phone link keep running in the other processes. A coordinator that exits unexpectedly restarts up to three times in a row; one that stayed up for ten minutes starts a new count.
- **Everything else:** other problems are recorded in `logs/diagnostics.jsonl` in the same folder and shown under **Settings → Diagnostics**. The log holds error details only, never conversation text, and it stays on the computer.

## Background work and the tray

Closing the window hides anyBot to the tray. The coordinator and active employees keep running. **Quit and stop active work** in the tray menu, or **Quit** in Settings, stops everything the same graceful way: the coordinator stops each run, records it as cut off, and at the next start posts a note in its conversation, tells the bot that handed it the work, and notes its task. Queued work starts again at the next start. Settings asks first when bots are working.

**Launch at login** (Settings → Runtime & privacy) is opt-in. It starts the runtime after you sign in to Windows, so routines and queued work pick up again (runs cut off by a quit or restart are reported, not resumed). The computer still has to stay on.

## Automatic updates

anyBot 0.2.18 and later update themselves with `electron-updater`:

- The update downloads in the background, with progress shown in the app.
- It installs silently, without the NSIS setup wizard, and restarts into the new version.
- The Update button beside your name starts a one-click upgrade.
- **Restart** asks first when bots are working. **Install when they finish** holds new work (queued work starts after the restart) and installs once nothing is running; the button shows **Waiting** and can be cancelled. **Stop and restart now** stops the team gracefully, as Quit does, and only then starts the installer. Nothing installs by itself: `autoInstallOnAppQuit` is off, so an update never interrupts work unless you start it.
- An automatic check that fails because the computer is offline (at login, after sleep) is not shown as a problem; it is noted and tried again five minutes later. Checks you start yourself always show their errors.

Updates come from the source repository's own releases (it has been public since 2026-09-23):

| Repository | Visibility | Releases | Read by |
|---|---|---|---|
| `gilfila/anyBot` | Public | Every version: installer, blockmap, `latest.yml` | 0.3.23 and later |
| `gilfila/anyBot-updates` | Public | A mirror of the same assets; the repo holds nothing but a README | Installs older than 0.3.23 |

The mirror exists only because builds before 0.3.23 have `anyBot-updates` built in as their feed. The publisher keeps it current, so an old install still updates to the newest version and then reads `gilfila/anyBot` from there on. Once no installs older than 0.3.23 remain, the mirror step (and the release GitHub App) can go. The app reads its feed anonymously, so no tokens or credentials are embedded in it.

The default feed is:

```
https://github.com/gilfila/anyBot/releases/latest/download
```

To use a different feed, set `ANYBOT_UPDATE_FEED_URL`:

```powershell
$env:ANYBOT_UPDATE_FEED_URL = "https://your-custom-feed.example.com/updates"
```

Security properties:

- No GitHub tokens, PATs, or credentials are embedded in the app.
- The feed URL must be HTTPS, with no embedded credentials.
- electron-updater verifies the installer against the checksum in `latest.yml` before installing.
- The builds are unsigned, so Windows SmartScreen can warn on first install. Code signing would remove that warning.

**Do not change the install behavior** (`quitAndInstall(true, true)`, NSIS `oneClick` with `perMachine: false`) without testing a real update from the previous release.

## Publishing a release

Releases are published by `.github/workflows/release.yml`, never by hand:

1. Open a PR that bumps the version in `package.json` and `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`) and adds a CHANGELOG entry for it, written for users. The **Release Windows / Verify release** check validates the version and the entry, runs the test suites, builds the installer from a real `npm ci`, and checks the packaged app (its `electron-updater` and `builder-util-runtime`, its UI assets, and `latest.yml` against the installer).
2. Merge it to `main`. A merge is a release, so merge only with the owner's OK. The publish job uploads the verified installer, blockmap and `latest.yml` to `gilfila/anyBot` and to the `gilfila/anyBot-updates` mirror (plus `AnyBot-phone.apk` on `gilfila/anyBot` once the phone signing secrets are set), tags the source commit, and checks both live feeds. The version's CHANGELOG entry becomes the release notes that the in-app update card shows.

The one-time setup, the required PR check and recovery (`workflow_dispatch` on `main`) are in [releasing.md](releasing.md).

**Don't package and upload a version yourself** (`npm run package` plus `gh release create`). The publisher only continues a release that carries its own `<!-- source-commit: ... -->` marker, so a hand-made release blocks that version for good and needs a new patch version to fix. It would also have no release notes and no phone app. A local `npm run package` is still fine for testing, from a clean checkout with a real `npm ci` and `node node_modules/electron/install.js`: a linked or junctioned `node_modules` produces an `app.asar` without its dependencies.

If a publish run fails, read its **Verify release** and **Publish verified installer** logs first. These read-only checks help too:

- `https://github.com/gilfila/anyBot/releases/latest/download/latest.yml` (and the same path on `anyBot-updates`) shows the version the feeds serve.
- In a local build, `npx @electron/asar list release/win-unpacked/resources/app.asar` includes `node_modules/electron-updater` and `node_modules/builder-util-runtime`, and `release/win-unpacked/resources/app.asar.unpacked/runtime/approval-mcp.mjs` exists (Claude Code starts it as the approval bridge).

Each release holds these files:

| File | Purpose | Required |
|---|---|---|
| `anyBot-Setup-X.Y.Z.exe` | NSIS installer | Yes |
| `latest.yml` | electron-updater metadata | Yes |
| `anyBot-Setup-X.Y.Z.exe.blockmap` | Delta updates | Optional |
| `AnyBot-phone.apk` | The Android phone app (`gilfila/anyBot` only) | Only when the signing secrets are set |

## Windows install recovery

If an old installation shows a Windows breakpoint dialog or does nothing when opened:

1. Remove the stale **anyBot** entry in Windows Settings → Apps.
2. Install the latest `anyBot-Setup-X.Y.Z.exe` from the [latest release](https://github.com/gilfila/anyBot/releases/latest).

An `%LOCALAPPDATA%\Programs\anyBot` folder with broken permissions (ACLs) can stop Windows from replacing the old executable. `npm run package:portable` builds a portable executable for machines where that folder is unusable.

To check downloaded binaries against a tested build, run `npm run release:manifest` and compare the generated `release/SHA256SUMS.txt`. This is an integrity check, not a replacement for code signing.

## Verification

```powershell
npm test
npm run build
npm run test:runtime
npm run doctor
npx playwright test --config playwright.mobile.config.mjs
npx playwright test --config playwright.snake.config.mjs
```

`npm run doctor` prints the harness executables it finds and the model choices each one reports, without sending a provider request.

`npm test` covers, among other things:

- SQLite persistence and migrations
- delegation, cancellation, and bounded run duration
- the board, canvas, org, memory, and knowledge-graph rules
- approvals and live model discovery
- artifact safety, routines, and subprocess failure paths
- mobile gateway roles and human-member conversation ACLs
- headless server startup

Tests that need a signed-in provider are opt-in, because they depend on installed CLIs and account state. [verification.md](verification.md), [implementation-status.md](implementation-status.md) and [release-readiness.md](release-readiness.md) are historical records of the 0.2.11 build, not current evidence; the [CHANGELOG](../CHANGELOG.md) records what each release was checked with.

`tests/server.test.mjs` binds port 4319. If another process holds that port, two tests fail with `EADDRINUSE`. CI is unaffected.

## Packaging

```powershell
npm run package
npm run package:portable
npm run release:manifest
```

- `npm run package` builds the NSIS installer, `latest.yml`, and the blockmap in `release/`.
- `npm run package:portable` builds the portable executable.
- `npm run release:manifest` writes `release/SHA256SUMS.txt`.

## Models

anyBot reads each harness's own model list every time the bot editor opens:

| Harness | Where the list comes from |
|---|---|
| Claude Code | `additionalModelOptionsCache` in `~/.claude.json`. Entries that need a newer CLI show as disabled, with the reason. |
| Codex | `models_cache.json` in `CODEX_HOME` (by default `~/.codex`) |
| Antigravity | `agy models`, cached for ten minutes |
| Hermes | its configured provider's catalog. The `openai-codex` provider reuses Codex's list. |

An owner-maintained [`models.json`](model-catalog.md) adds entries to these lists, and **Custom model** accepts any other identifier.

## Custom harnesses

Owner-configured CLI adapters are added through `harnesses.json`. See [custom-harnesses.md](custom-harnesses.md). Every harness runs as the desktop user and is a trusted local process. A workspace folder is not an OS sandbox.

## Mobile companion

The touch-first client is in [`mobile`](../mobile), built with Capacitor for Android and iOS:

```powershell
npm run mobile:dev
npm run mobile:build
npm run mobile:sync
npx playwright test --config playwright.mobile.config.mjs
```

- **TLS:** the opt-in gateway requires TLS, except in explicit loopback development mode.
- **Pairing:** codes are single-use and expire after two minutes.
- **Device roles:** `viewer`, `contributor`, and `operator`.
- **Human members:** configured members can be bound to separate sessions, invited to conversations, and filtered out of conversations they don't belong to.

See [mobile.md](mobile.md).

Not yet release-complete:

- The Android debug APK is a development artifact.
- iOS source is synced, but a real build needs Xcode, signing, and a Mac.
- Push notifications, OS-protected mobile credentials, external identity (OIDC), and store signing are not finished.

## Headless / VPS mode

The same coordinator runs without Electron:

```powershell
node server/index.mjs --config C:\path\to\server.json
```

Use plain loopback HTTP only for local development. A VPS deployment needs:

- TLS or a private reverse proxy
- WAL-aware backups
- exact origins
- configured human members
- a dedicated service account
- separately signed-in harnesses

The gateway supports human conversation ACLs and an optional short-lived RS256/OIDC token boundary. It does not yet provide multi-tenant worker isolation. See [server.md](server.md) and [`server/config.vps-oidc.example.json`](../server/config.vps-oidc.example.json). [`server/Dockerfile`](../server/Dockerfile) is a starting image, and it deliberately packages no credentials, TLS keys, or reverse proxy.

## Security boundaries

Employees run with the desktop or server account's credentials. anyBot does not:

- copy OAuth secrets
- bypass harness approvals
- claim that local workspaces are OS sandboxes

How work is handled:

- Queue admission is idempotent, and cancellation is explicit.
- Interrupted work whose outcome is unclear is not replayed automatically.
- Employee output is treated as untrusted. It is escaped before markdown rendering, and HTML previews run in sandboxed frames.

Hosted multi-human deployment still needs external identity, durable organization membership, isolated workers, audit persistence, backups, and emergency revocation.

## Design

- [design.md](../design.md): architecture and security model
- [design/visual-direction.md](../design/visual-direction.md): the UI direction ("Studio paper")
- [themes.md](themes.md): the theme format and the plan for custom themes

## Artifact test: Orbit Snake

[Orbit Snake](../games/snake/index.html) is a playable, self-contained game built by two bots (Mira and Sol) in one anyBot conversation. It has:

- procedural neon graphics
- keyboard, WASD, and swipe controls
- a saved top-five high-score board
- a responsive mobile layout

The build plan, notes, transcript, and acceptance tests are in [games/snake/docs](../games/snake/docs).
