# Verification record

## Version 0.2.11 package

- `npm test`: 71 passing tests, including five-harness invocation/protocol contracts and subprocess execution, immediate structured-provider failure cancellation, read-only Codex configuration warnings, release checksum verification, configured provider-model discovery, hosted preflight acceptance/rejection and CORS-origin checks, fresh-data-directory creation, the Snake two-agent handoff, model selector guards, owner model-catalog validation, external RS256 identity mapping, durable owner membership management, hosted image/service/Compose hardening checks, headless server identity wiring, mobile ACLs, safe configured-member pairing choices, the installable mobile PWA shell, browser OIDC PKCE state/token handling, headless gateway checks, the VPS backup manifest, and writable deployment preflight validation.
- `npm run build`: passes.
- `npm run test:runtime`: passes, including Electron utility-process startup, SQLite initialization, harness detection, IPC creation/rejection, and clean shutdown.
- `npm run mobile:web`: passes and emits `manifest.webmanifest`, `sw.js`, and the anyBot mark required for a standalone mobile web install; the PWA test verifies the offline shell does not cache authenticated API data.
- `npm run mobile:sync`: passes for Android and iOS web assets. With `JAVA_HOME=C:\Program Files\Android\Android Studio\jbr` and `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`, `npm run mobile:build` completes successfully and emits `release/anyBot-mobile-debug.apk` (4,301,172 bytes, SHA-256 `FA94B6927180F96F8A54D18D4B2243F42062AE5D1E81EA740AF3066D381C59C0`).
- The mobile web build includes external-token and browser OIDC PKCE connection paths; the Android debug artifact is native-build verified, installed successfully, and launched `dev.anybot.mobile/.MainActivity` on the attached emulator. It remains unsigned and no physical-device run is claimed.
- A native emulator screenshot confirms the mobile shell renders the anyBot mark, connection-code form, memory-only token field, and browser OIDC fields at the Android phone viewport.
- The mobile Playwright acceptance flow passes with the installed Windows Chrome executable: phone pairing, conversation creation, human invitation, uncertain-send retry, and disconnect all complete.
- A live `node server/index.mjs --config ...` loopback smoke returned `{"status":"ok"}` from `/healthz` and was then shut down cleanly.
- The latest opt-in live Codex delegation smoke reached the installed CLI and failed fast on the user's obsolete `computer_use.windows.always_allowed_app_ids` setting in `%USERPROFILE%\\.codex\\config.toml`; an earlier attempt reached the provider network and was blocked with Windows error 10013. Codex's structured failure event is now surfaced and cancels the run promptly instead of waiting for the full task timeout; live provider collaboration remains dependent on the installed CLI configuration and network policy.
- Rebuilt `release/anyBot Setup 0.2.11.exe` from the local Electron runtime: 115,526,055 bytes, SHA-256 `CCC58E1A3888B0DA591B793FC999D1580115D5AF158959D42CD8E1D3E7AC48A1`.
- The packaged ASAR contains `server/backup.mjs` and `server/restore.mjs`; the backup/restore test copies durable workspace state through SHA-256 manifests, rejects symbolic links/special files, refuses overwrite destinations, and detects tampering.
- Direct ASAR inspection confirms the packaged desktop artifact contains `runtime/identity.mjs` and `server/config.vps-oidc.example.json`.
- Direct ASAR inspection confirms the packaged desktop artifact contains `server/preflight.mjs`; the preflight command validates data-directory write access and configured PEM/JWKS material before a hosted server starts.
- `node server/preflight.mjs --config <file> --hosted` now rejects loopback, insecure, unauthenticated VPS configurations before startup; local development keeps the existing non-hosted command.
- A running hosted server reloads an atomically replaced JWKS file on the next token verification; the rotation test accepts the new `kid` and rejects the retired key without restarting the process.
- The rebuilt `release/win-unpacked/anyBot.exe` started from the current package and stayed alive for the desktop smoke interval; its process tree was then stopped cleanly.
- The documented `npm start` command now maps to the Electron desktop entrypoint.
- The packaged ASAR contains `games/snake/index.html`, `games/snake/game.js`, and the recorded Mira/Sol conversation, so the playable Snake proof ships with the desktop artifact.
- `scripts/package-electron.mjs` now restores the developer `package.json` after electron-builder prepares its production manifest; packaging no longer removes the repository's test, build, and mobile scripts.
- Runtime & privacy now exposes an opt-in **Launch at login** setting backed by Electron's per-user login-item configuration and a persisted preference under application data.
- The rebuilt executable was launched against the ACL-corrupted default profile and remained alive for five seconds as `anyBot` by selecting an emergency temporary profile; the UI exposes a warning that this profile is not durable. The exact test process was stopped and no exact-path process remained. A clean writable profile also starts normally.
- Installed the current package lineage into a clean per-user directory and started its executable without the prior GPU fatal error. The existing `%LOCALAPPDATA%\\Programs\\anyBot` directory itself still rejects direct access from this session, so the clean install is the authoritative desktop smoke target.
- A fresh silent NSIS install of the current 0.2.11 installer into a new per-user directory launched the installed `anyBot.exe` and stayed alive for the smoke interval. The screenshot's breakpoint dialog comes from the older ACL-protected `%LOCALAPPDATA%\\Programs\\anyBot` copy; that directory cannot be inspected or replaced from this session, so it must be removed or repaired before using that location as a test target.
- A deterministic clean-install QA copy is available at `release/anyBot-clean-install/anyBot.exe`; it launched successfully for the same smoke interval after the final package rebuild.
- `Launch anyBot (verified).lnk` in the repository root points to that clean executable; launching the shortcut produced a responsive `anyBot` window and coordinator process.
- A silent install of the final installer into a new directory completed with exit code 0, and its installed executable stayed alive for the smoke interval. The installer behavior remains the stock selectable-directory flow; no custom NSIS override is shipped.
- The unpacked build in `release/win-unpacked/anyBot.exe` contains the current startup fix. The rebuilt portable self-extractor is `release/anyBot 0.2.11.exe` (102,650,638 bytes, SHA-256 `DC071032D6E0362DFFCC81E23D14CD0CA146011FC7CE9D157445B31F953D172D`); its launcher stayed alive for the smoke interval.
- `release/SHA256SUMS.txt` records the current NSIS installer, portable executable, and Android debug APK. If Windows quarantines the unsigned self-extractor, use the NSIS installer.
- Startup failures now append a diagnostic to `startup.log` beside the workspace database and show its path in the Electron error dialog; the source `npm start` command also builds `dist/` automatically. The packaged shell attempts the Electron sandbox and retries once with the host-compatible isolated renderer when Windows returns `launch-failed (49)`; a fresh packaged launch now opens the `anyBot — Your team, working together` window and remains alive through the smoke interval.
- Restored the package scripts and electron-builder configuration so clean checkouts can build, test, sync mobile, and produce the named anyBot installer. Added a canvas `roundRect` fallback for Chromium/Electron runtimes that do not expose that API, and disabled GPU acceleration in the desktop entrypoint after the packaged app's Windows GPU crash was reproduced and fixed.
- Chrome computer-use opened the local Snake artifact and visually verified the custom neon canvas, high-score panel, responsive layout, and launch controls. The dedicated Snake Playwright run now passes both the deterministic high-score flow and phone viewport checks by selecting installed Chrome when the managed Chromium binary is unavailable.
- A current Chrome computer-use pass clicked **Launch another run** and sent ArrowRight/ArrowDown input; the live artifact changed from `ORBIT LOST` to `SIGNAL ACTIVE`, exposed the enabled Pause control, and retained the high-score and Mira/Sol conversation panels.
- The current browser build's employee dialog was inspected through its accessibility tree: Harness is a selectable menu containing Claude Code, Codex CLI, Gemini CLI, Hermes Agent, and Cursor Agent CLI; Model is a selectable menu containing the harness default and Custom model. Provider-specific stale model IDs are not advertised.
- A current coordinator probe reads the installed Codex config and reports `gpt-6-astra (configured)` dynamically; Gemini and Hermes report no guessed IDs when their local configs contain no model field.
- The packaged ASAR was inspected directly and contains the current build payload. The existing per-user install remains an older payload because its installation directory denies replacement from this session; do not treat its stale model list as evidence against the current package.

## 2026-09-19 initial build

- `npm test`: 7 passing Node tests using real SQLite and a simulated harness.
- `npm run build`: Vite production build passes.
- `npm run package`: Windows x64 NSIS installer generated successfully with Electron 44.4.3.
- Open Design installed CLI 0.22.2 supplied the modern-minimal visual direction.
- Computer plugin opened the installer and reached the per-user installation destination screen. Installation and live app checks are not yet complete.

No live provider execution or cross-harness interoperability is asserted by these checks. Update this record with actual observations after desktop verification.

## Source changes after initial installer

- `npm test`: 13 passing tests after queued-context and routine changes.
- `npm run build`: passes after adding the routines interface.
- Regression coverage verifies that a queued assignment sees earlier completed responses, excludes later human assignments, and has a saved input snapshot.
- Duplicate request IDs with different message contents are rejected.
- Routine checks cover due-occurrence deduplication, overlap prevention, paused runtime behavior, missed-occurrence recovery, membership validation, and manual-run overlap rejection.
- The already-open 0.1.0 installer predates these source changes. Repackage after the initial desktop test; do not treat it as containing the newer routines implementation.
- Installation remains at the final Install step pending the requested confirmation; no live Codex employee result has been obtained yet.

## Employee lifecycle and Electron runtime checks

- `npm test`: 17 passing tests after employee editing, model overrides, archive/restore, and schema-v2 migration.
- `npm run build`: passes with employee lifecycle controls.
- `npm run test:runtime`: passes against real Electron 44.4.3 utility-process IPC and embedded SQLite. It checks startup, five-harness detection results, employee creation, unknown-operation rejection, and graceful shutdown using disposable test data. It opens no app window and calls no provider.
- Migration verification loads a schema-v1 employee and preserves its existing identity/instructions while adding archive, revision, and model fields.
- Archiving disables routines and rejects new chat/routine work; restoring does not silently restart schedules. Stale employee updates and updates during queued work are rejected.
- These checks do not replace the pending Computer-plugin installation and real Codex collaboration test.

## Deliverables

- `npm test`: 24 passing tests after artifact collection and staging.
- `npm run build`: passes with the deliverables panel and preview dialog.
- Verified with real temporary files: preserved content after source changes, HTML returned as text, conversation mismatch rejection, traversal/device/executable path rejection, 10 MB size limit, tamper detection, and Windows junction rejection.
- Following runs receive copies of earlier artifacts from their conversation. This is application-level routing in trusted-local mode, not OS isolation from other files.
- `npm run test:runtime` passes with normal desktop execution permissions and an isolated Chromium profile. The restricted runner produced Chromium GPU helper failures; do not interpret that restricted run as UI verification.
- Initial installer remains older than these source changes. The Computer-plugin installation and real Codex employee test are still pending.

## Historical records (pre-0.2.7)

The entries below preserve earlier test and packaging evidence. Their version numbers, hashes, and test totals describe those historical artifacts rather than the current 0.2.11 build.

## Version 0.2.0 package

- Rebuilt the Windows NSIS installer as `release/anyBot Setup 0.2.0.exe`, including employee editing/archive, routines, and deliverables.
- `npm test`: 24 passing tests. Production build and NSIS packaging both completed successfully.
- This is an unsigned development installer. No installed-app or live provider verification is asserted.
- The older 0.1.0 installer was already open; use 0.2.0 for the upcoming desktop test. Installation confirmation and the two-Codex-employee test remain pending.

## Subprocess failure-path verification

- `npm test`: 30 passing tests, including six tests that launch real Node child processes as controlled provider fixtures.
- Verified literal stdin, split UTF-8 structured output, missing final newline, malformed output rejection, output overflow, timeout, cancellation, and credential redaction in stderr diagnostics.
- Fixed repeated tree-kill attempts and added direct-child termination when Windows taskkill fails. This fallback does not guarantee termination of grandchildren; crash-proof process ownership remains a release-hardening gap.
- Preserved output-limit errors instead of overwriting them when flushing an incomplete JSON buffer. Flush trailing decoded bytes for the plain-text adapter.
- Test fixtures have a three-second emergency exit and assert completion before that deadline; a failed cancellation cannot pass by relying on fixture self-exit.
- The first restricted run hung on tree termination; it was interrupted. A subsequent process inspection found no remaining fixture process. The fixed suite passes in the restricted runner.
- Repackaged the uninstalled 0.2.0 development build with these fixes. These are controlled subprocess tests, not live harness compatibility evidence.

## Live Codex verification

- The installed Codex CLI reached the provider but rejected the configured default `gpt-6-astra`: the service explicitly required a newer Codex version. No global CLI configuration was changed.
- With the explicit employee model override `gpt-5.5`, the adapter returned the exact requested `ANYBOT_CODEX_OK` response.
- `node tests/live-codex-smoke.mjs gpt-5.5` passed against the real installed CLI and existing login. This is an opt-in, provider-using test, outside the default test suite.
- Two actual Codex-backed employees completed three successful runs with concurrency one: lead delegation, calculator response `CALCULATED: 42`, and lead continuation `TEAM_OK: 42`. Inspected records confirm the second run belonged to the calculator and referenced the first run as parent; the third returned to the lead under the same root.
- Local evidence: `.anybot/live-tests/codex-team-1AcxA9/evidence.json` plus SQLite run inputs and history in that directory. Synthetic test data is retained for inspection and ignored by Git.
- This verifies text delegation through the coordinator, not filesystem tool execution, cross-provider interoperability, or the desktop UI. The Computer-plugin installed-app test remains pending confirmation.
- Runtime and UI version labels now derive from package metadata; the development installer was rebuilt with that correction.

## Claude, Hermes, and Gemini launch checks

- Claude Code and Hermes each returned the exact synthetic no-tools response `ANYBOT_PROVIDER_OK` through the production `runHarness` adapter using existing local configuration.
- Reinspection found Gemini CLI 0.57.0 installed. Its npm package uses `bundle/gemini.js`; the earlier adapter expected `dist/index.js` and incorrectly accepted a Unix shim as a Windows executable. Added the bundled entry path and stopped accepting extensionless Windows launchers.
- `npm test`: 31 passing tests, including a filesystem fixture verifying Gemini resolution and rejection of unsupported Unix shims. No shell execution of arbitrary `.cmd` files was introduced.
- Gemini now launches, but its authentication attempt exits with `IneligibleTierError`, reason code `UNSUPPORTED_CLIENT`, for the configured Gemini Code Assist for individuals tier. This is the observed service response, not a claim about every Gemini authentication method. No account or credential changes were made.
- All five adapters are covered by the adapter and runtime checks. Successful text responses are verified for three; Gemini remains externally blocked. Cursor Agent CLI is discovered through the Windows `cursor-agent.cmd` shim path, and the doctor now performs a read-only version probe that reports the current local access/install failure before a run. Authentication and an end-to-end response still need verification. Cross-provider delegation and actual tools/permissions still need end-to-end verification.

## Custom CLI extensibility

- Added owner-controlled `harnesses.json`, loaded at coordinator startup, with validated absolute executable paths, literal argument arrays, optional model flag, and stdin/plain-text stdout transport.
- Custom entries appear in Harnesses and employee selection. Invalid configuration is reported without disabling built-ins. There is no RPC or conversation action to register launchers.
- `npm test`: 33 passing tests. A custom employee successfully ran an actual Node CLI through the real coordinator. Invalid configuration tests cover built-in override, missing trust, relative executables, command strings, unsupported output, and malformed model options.
- Production UI build and Electron runtime check pass. The 0.2.0 development installer has now been rebuilt with custom harness support; all 33 regression tests passed before packaging.

## Installed desktop verification in progress

- User explicitly approved installation. Computer closed the obsolete 0.1.0 installer, launched the current 0.2.0 installer, retained the current-user destination, and clicked Install.
- Computer observed the successful completion screen stating anyBot was installed, then clicked Finish with Run anyBot selected.
- The post-install transition exposed an Explorer window titled with the anyBot Start Menu shortcut; inspecting it timed out at Computer's app-access approval. This does not establish the shortcut error's cause.
- Launching the installed executable directly through Computer also timed out at app-access approval. Installation consent is fulfilled; approval to access the installed app through the Computer tool remains necessary. The installed-app employee creation, conversation, cancellation, and tray checks have not yet run.

## Mobile implementation and verification

- User asked to continue mobile development while desktop testing is deferred. Added a touch-first React entry point and official Capacitor iOS/Android projects, using the established Open Design visual direction.
- Added an opt-in TLS gateway attached to the desktop coordinator: resource-specific routes, two-minute single-use pairing codes, 24-hour owner-device sessions, revocation, CORS checks, and limited pairing attempts. No listener or firewall change was enabled on the installed app.
- `npm test`: 37 passing Node tests. New tests use real loopback HTTP and SQLite to cover authentication, expiry, code reuse/rate limits, revocation, field projection, idempotent sends, and cancellation. Production requires TLS; a real phone-to-host TLS deployment is still unverified.
- `npx playwright test --config playwright.mobile.config.mjs`: passes at 390 × 844. Real client/gateway/coordinator with simulated provider: pairing, two-employee conversation creation, deliberately lost send response, retry without duplicate work, literal HTML rendering, no horizontal overflow, and logout/revocation. Restricted Chromium startup was denied; the test passed with normal process permissions.
- Mobile and desktop production builds pass. Electron runtime test still passes. Capacitor sync succeeds for Android and iOS. npm audit reports zero vulnerabilities after a scoped xcode → uuid 11.1.1 override; native sync was verified afterward.
- Android `assembleDebug` succeeds with the existing Android Studio JDK/SDK. Installed the APK on a headless read-only Pixel_8_Pro emulator (`emulator-5556`), launched `dev.anybot.mobile/.MainActivity`, captured its screen/hierarchy, and visually verified the connection form. The test emulator was shut down afterward; no personal device was used.
- Deliverable: `release/anyBot-mobile-debug.apk` (4,297,544 bytes, SHA-256 `9850D7193FECC8A11BE6388B2D6C07344B8EAE34C8041B865BD0AC4E515B6511`). Screenshots: `docs/assets/mobile-connect.png`, `mobile-conversation.png` (browser fixture), and `android-mobile.png` (actual emulator).
- iOS source was generated and synchronized, but no iOS compilation, signing, simulator run, or device run has occurred. Push, persistent secure credentials, artifacts, and external identity remain unfinished. The currently installed desktop copy may predate the latest gateway; pairing should use the freshly rebuilt installer or current source.

## Employee model selection

- The employee form uses provider aliases where the installed harness documents them, with a Custom model fallback for everything else.
- The installed Claude Code CLI currently advertises `fable`, `sonnet`, and `opus`; the selector now matches those aliases and no longer advertises `haiku`.
- Gemini CLI model availability is account- and release-dependent, so Gemini intentionally exposes the harness default plus Custom model instead of stale aliases.
- Codex and Hermes intentionally expose the harness default plus Custom model because their available model names depend on the installed CLI, account, and provider configuration.
- “Custom model…” preserves existing overrides and supports newly released model IDs without an anyBot release. Switching harnesses clears a model that is not valid for the new harness.
- `npm run build`: passes. The current full suite has 50 passing tests, including a regression check that rejects dated hard-coded model IDs, validates current model choices, and covers safe configured-member pairing choices.
- Codex adapter discovery now prefers the current native Windows installation under `%LOCALAPPDATA%\\OpenAI\\Codex\\bin` over stale npm shims. The live two-employee smoke test reached that native binary but could not complete because this environment denied its authenticated websocket/HTTPS network connections (`os error 10013`); no live collaboration pass is claimed.
- The local Claude CLI help output was rechecked during acceptance and reported the `fable`, `opus`, and `sonnet` aliases. The source model selector and regression test were updated to match that installed CLI; Gemini remains default/Custom-only until its account-specific model list can be queried.
- `npm run package` now uses the locally installed Electron distribution, so packaging does not require downloading Electron. The rebuilt unsigned installer is 115,186,965 bytes with SHA-256 `39336BB53FA63FE43C477928D8C6210C11B19D39F21C2A4058ED591C5F9F2CC2`.
- The employee form filters the Claude dropdown to current aliases (`fable`, `sonnet`, `opus`) and keeps Custom model available, preventing stale dated IDs from being shown even if a provider probe returns them.
- Harness probing refreshes Claude aliases from `claude --help` at runtime and falls back to the checked-in aliases if the probe times out or fails. The parser is covered by the adapter tests.
- The headless server now exposes `/healthz` for supervisors and reverse proxies. Added VPS/Caddy examples under `server/`; the server test verifies the liveness response.
- A direct live Claude probe reached Claude Code 2.1.273 and selected model `claude-fable-5-1`, but its startup hooks could not create `C:\\Users\\Tony\\.claude\\session-env` (`EPERM`) and the API then retried without a response. The adapter is therefore verified through structured subprocess tests, while authenticated live completion remains environment-blocked.
- Rebuilt `release/anyBot Setup 0.2.0.exe` after native Codex discovery, model selector, explicit desktop quit-control, and device-role corrections: 115,096,960 bytes, SHA-256 `2708D6CC752FB052730994344AFB32E05DE16401B1E1CF9B5394F0BBDD6755C8`. It is an unsigned development installer.

## Long-running employee policy

- Employee records now persist a bounded `timeoutMinutes` policy from 10 minutes through 24 hours. Existing schema versions migrate to schema 3 with a 10-minute default.
- The employee form exposes 10-minute, 1-hour, 6-hour, and 24-hour choices. The adapter passes the employee policy to the subprocess and reports the configured limit on timeout.
- `npm test`: 41 passing tests, including bounded-duration validation and migration coverage. `npm run build` and `npm run test:runtime` pass; the Electron runtime test exits cleanly with GPU switches enabled.
- Rebuilt `release/anyBot Setup 0.2.0.exe`: 115,097,215 bytes, SHA-256 `ADDC69333881CF5436C7C558CC2DE7B65D90BE05CFAF03EFC5A7DB8FF7C8FD55`.

## Multi-human local gateway foundation

- Pairing can bind a device session to a configured human member (`owner`, `member`, or `viewer`) in `mobile-access.json`.
- New conversations are scoped to the creating human. Owner/operator sessions can invite configured members through `/v1/conversations/:id/humans`; overview, history, messages, and runs are filtered by that ACL. Uninvited members receive a 404 to avoid resource-existence leaks.
- Gateway actions retain a bounded in-memory audit record with the human member ID. Tokens remain hashed, pairing is single-use, and device capabilities remain separate from human membership.
- `npm test`: 42 passing tests, including owner/Alice/Bob isolation and invitation coverage. Mobile Playwright acceptance: 1 passing test. `npm run build`: passed.
- Rebuilt `release/anyBot Setup 0.2.0.exe`: 115,098,157 bytes, SHA-256 `973539A99DF1F9B9A3183AF2A86855289B6D0B915707E5DFDB500CD4E0134E68`.

## Headless server mode

- Added `server/index.mjs`, a graceful-shutdown headless entrypoint that starts the same Coordinator and scoped mobile gateway used by Electron. Loopback HTTP is opt-in; non-loopback mode requires absolute TLS certificate/key files and an HTTPS public URL.
- Added `server/config.example.json`, `server/Dockerfile`, and [docs/server.md](server.md). The package includes `server/**` so the deployment entrypoint travels with the desktop artifact.
- `tests/server.test.mjs` starts the server on loopback with a temporary SQLite directory, pairs an owner member, and verifies projected member metadata. `npm test`: 43 passing tests.
- Rebuilt `release/anyBot Setup 0.2.0.exe`: 115,099,897 bytes, SHA-256 `6E03BBF8FD0F30DEEC3D99BCDB7F7D0B33A2CB8DFDF0E6DC070D89658E285896`.

## Durable gateway grants and access corrections

- Conversation grants persist through gateway restart; bearer tokens do not. The restart regression verifies Alice retains her invitation, Bob is denied, and the old token returns 401.
- Malformed grant documents fail gateway startup. Operator device roles no longer expose ungranted conversations. Human viewer roles cap write permissions even on operator devices.
- Grants are written before being published in memory; failed invitation writes do not grant transient access. Closing a gateway does not overwrite a newer instance's grant file.
- Gateway actions (`session.paired`, coordinator operations, invitations, and revocations) are appended as token-free JSONL to `mobile-audit.jsonl`, loaded on restart, and bounded to the latest 1,000 entries in memory. Invalid audit lines fail startup rather than silently dropping evidence.
- Current source: 46 Node tests passed and desktop production build passed.
- Rebuilt `release/anyBot Setup 0.2.0.exe` with durable audit logging and final ACL corrections: 115,100,634 bytes, SHA-256 `855F5ADBA45AE2E94AF9928C78CBCB947BB3A6D38B53ED03C694A2AA5D856036`. The packaged ASAR contains `server/index.mjs` and `runtime/mobile-gateway.mjs`.
- Mobile New conversation now submits configured human invitations; `npm run mobile:sync` completed for Android and iOS. Rebuilt installer after the client/gateway contract update: 115,100,495 bytes, SHA-256 `70B03C2F9D55B303A31051B732A63C9519C4B24EDA8B73936B2F4499EA8B9BE6`.
- The mobile Playwright flow now configures an owner and Alice, verifies the **Share with humans** UI, invites Alice into the conversation, completes the uncertain-send retry, and disconnects successfully.
- Owners/operators can review `GET /v1/audit` with bounded `limit`/`before` cursors; viewers and contributors are denied. `npm test`: 47 passing tests.
- Rebuilt installer with the restricted audit endpoint: 115,100,723 bytes, SHA-256 `FD2958A1CBB08A25B7653F71BD1C21A996F860F427EE3BFCFC7939F2DD0D8B08`.
- Mobile Settings now displays the owner/operator audit panel and the configured-member explanation. `npm run mobile:sync` passed for Android and iOS. Final installer after this UI update: 115,100,637 bytes, SHA-256 `5155EFBB0A04E926180DA40DE0479EF89958F775FD78EB45B7CBE7B1A8F750DD`.
- Native Android rebuild after the audit/member UI changes: `android/gradlew.bat assembleDebug` completed successfully. Copied `release/anyBot-mobile-debug.apk`: 4,297,544 bytes, SHA-256 `9850D7193FECC8A11BE6388B2D6C07344B8EAE34C8041B865BD0AC4E515B6511`.
- Limitations: single gateway writer, JSON grants separate from SQLite, bounded local audit, shared host execution. This is not a claim of production multi-tenant isolation.

## Installed desktop acceptance evidence

- The freshly installed Windows package launched successfully as `anyBot — Your team, working together` (version `0.2.0`). The captured window shows the local runtime online, the team workspace, the employee card, and the shared-conversation entry point: [installed-anybot-ui.jpg](assets/installed-anybot-ui.jpg).
- The Computer surface returned a screenshot for the installed window, but no accessibility tree, so this pass confirms launch and visible rendering only. Control-level clicks for employee creation, conversation execution, cancellation, and tray behavior remain pending a Computer session with accessibility access.

## Snake proof app

- [games/snake/index.html](../games/snake/index.html) is a playable responsive Snake game with custom canvas graphics, touch controls, local high-score persistence, and a visual asset at [orbit-snake.png](../games/snake/orbit-snake.png).
- The two-agent handoff test (`Mira` and `Sol`) passes inside the real coordinator and verifies the shared conversation result. It is included in the current 68-test `npm test` run.
- The dedicated Playwright browser run passes both the deterministic high-score flow and the phone viewport check using installed Chrome; the config falls back to managed Chromium on hosts where it can spawn.

- Installed-app Computer acceptance reached the live UI: created `Mira` (Game builder, Claude Code) and `Sol` (Game tester, Claude Code), opened a two-employee conversation with handoffs enabled, and submitted the Snake objective. The conversation visibly entered `Mira — running / Waiting for the harness...`; the run was stopped after the live harness remained unavailable in this environment. Evidence: [installed-snake-conversation.jpg](assets/installed-snake-conversation.jpg). This confirms the desktop creation, team selection, handoff configuration, dispatch, and cancellation controls; it does not claim a live Claude response.
- Reinstalled the latest rebuilt installer silently with exit code 0 and reopened the persisted `Snake game test` conversation. The installed UI still shows both employees, enabled handoffs, and the cancelled run state after upgrade.
