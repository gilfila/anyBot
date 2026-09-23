# Running, updating, and releasing anyBot

This page covers the technical side of anyBot. For the features, see the [README](../README.md). The architecture and security model are in [design.md](../design.md).

## Run from source

```powershell
npm ci
npm start
```

`npm start` builds the renderer first, so a fresh checkout works without a separate build step.

`npm run verify:local` is the local acceptance gate. It runs these in order:

1. the unit and integration suite
2. the renderer build
3. the Electron runtime smoke test
4. the mobile web and Capacitor sync checks

The desktop shell tries Electron's Chromium renderer sandbox first. Some Windows hosts reject the sandbox before the page loads. On those, anyBot retries with context isolation on, Node integration off, and the same narrow IPC surface.

## Where anyBot keeps its data

- **Workspace:** the SQLite workspace and each employee's workspace folder live in Electron's per-user application data directory.
- **Temporary profile:** if Windows denies every persistent profile location, anyBot starts in a clearly marked temporary profile so the app stays recoverable. Repair the profile permissions before relying on saved history or long-running work.
- **Startup errors:** if the renderer or coordinator fails before the workspace appears, the error goes to `startup.log` beside the SQLite workspace. The error dialog shows the path.
- **Everything else:** other problems are recorded in `logs/diagnostics.jsonl` in the same folder and shown under **Settings → Diagnostics**. The log holds error details only, never conversation text, and it stays on the computer.

## Background work and the tray

Closing the window hides anyBot to the tray. The coordinator and active employees keep running. **Quit and stop active work** in the tray menu stops everything.

**Launch at login** (Settings → Runtime & privacy) is opt-in. It starts the runtime after you sign in to Windows, so routines and long runs keep going. The computer still has to stay on.

## Automatic updates

anyBot 0.2.18 and later update themselves with `electron-updater`:

- The update downloads in the background, with progress shown in the app.
- It installs silently, without the NSIS setup wizard, and restarts into the new version.
- The Update button beside your name starts a one-click upgrade.

Updates come from a separate public repository that holds binaries only:

| Repository | Visibility | Contents |
|---|---|---|
| `gilfila/anyBot` | Public | Source code |
| `gilfila/anyBot-updates` | Public | Installers and update metadata only |

The feed repository holds nothing but release files, and the app reads it anonymously, so no tokens or credentials are embedded in the app.

The default feed is:

```
https://github.com/gilfila/anyBot-updates/releases/latest/download
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

1. Merge the release PR to `main`. It must bump the version in `package.json` and `package-lock.json` and add a CHANGELOG entry.
2. Build from a **clean checkout** of `main`. Run a real `npm ci` and `node node_modules/electron/install.js`, then `npm run package`. A linked or junctioned `node_modules` produces an `app.asar` without its dependencies.
3. Check the build:
   - `npx @electron/asar list release/win-unpacked/resources/app.asar` includes `node_modules/electron-updater` and `node_modules/builder-util-runtime`.
   - `release/win-unpacked/resources/app.asar.unpacked/runtime/approval-mcp.mjs` exists. Claude Code starts it as the approval bridge.
   - The `sha512` and `size` in `release/latest.yml` match `anyBot-Setup-X.Y.Z.exe`.
4. Tag the source repo with an annotated tag `vX.Y.Z` ("anyBot X.Y.Z") and push it.
5. Create the release on the feed repository with the installer, its blockmap, and `latest.yml`:

   ```powershell
   gh release create vX.Y.Z -R gilfila/anyBot-updates --target main --latest --title "anyBot X.Y.Z" `
     release/anyBot-Setup-X.Y.Z.exe release/anyBot-Setup-X.Y.Z.exe.blockmap release/latest.yml
   ```

6. Fetch `https://github.com/gilfila/anyBot-updates/releases/latest/download/latest.yml` and confirm it shows the new version. Installed copies pick it up on their next check.

| File | Purpose | Required |
|---|---|---|
| `anyBot-Setup-X.Y.Z.exe` | NSIS installer | Yes |
| `latest.yml` | electron-updater metadata | Yes |
| `anyBot-Setup-X.Y.Z.exe.blockmap` | Delta updates | Optional |

## Windows install recovery

If an old installation shows a Windows breakpoint dialog or does nothing when opened:

1. Remove the stale **anyBot** entry in Windows Settings → Apps.
2. Install the latest `anyBot-Setup-X.Y.Z.exe` from the [feed repository](https://github.com/gilfila/anyBot-updates/releases/latest).

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

Tests that need a signed-in provider are opt-in, because they depend on installed CLIs and account state. More evidence is in [verification.md](verification.md) and [implementation-status.md](implementation-status.md).

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
| Gemini | model ids in the installed Gemini CLI bundle |
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
