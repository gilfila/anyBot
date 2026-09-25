# Changelog

All notable changes to anyBot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.3.24] - 2026-09-25

### Added
- **Get the phone app by scanning a code.** When you click **Connect a phone** in **Settings → Your phone**, the first code now downloads the Any Bot Android app. Install it, tap **I have the app**, and scan the second code to connect. If a phone is already connected, you go straight to the connect code.
- The Android app is attached to every release on the [Any Bot releases page](https://github.com/gilfila/anyBot/releases/latest) as **AnyBot-phone.apk**. It has the same version as the desktop app, and a newer one installs over the old one.

## [0.3.23] - 2026-09-25

### Changed
- **Any Bot now updates from its main GitHub page.** Installers and updates are published on the [Any Bot releases page](https://github.com/gilfila/anyBot/releases/latest), and the top of the project page has a **Download** link. You don't need to do anything: this update switches your copy over, and the old download page keeps receiving every version too.

## [0.3.22] - 2026-09-24

### Changed
- **Bots are sent much less text each turn, so they use fewer tokens.** In a busy project thread, what Any Bot sends a bot each turn drops by about two thirds. In direct chats it drops by about a third.
  - What a bot is asked about always arrives whole: your message, the message that mentioned it, and everything posted since its last turn.
  - Older messages are trimmed to fit: the newest come first. A teammate's long older report keeps its beginning and end, unless you mention that teammate by name ("look at Sam's analysis again"), in which case it arrives whole.
  - Your own messages are never shortened.
- **Two bots can't have the same name any more**, because @mentions go by name. Creating or renaming a bot to a name that's taken asks you to pick another.
- An @name inside code or a quoted line ("> …") no longer pulls that bot into the thread.

### Fixed
- **Reports from your team could go missing.** When a manager bot's turn failed, the reports it was about to read were marked as read anyway. They now stay unread until a turn that includes them finishes.
- A bot's assignment was sent to it twice, once in the conversation and once at the end. It's now sent once.
- A bot waiting its turn in a project could see a reply you posted in another thread after you'd asked it, as if it came first. It now sees the project as it was when you asked, plus teammates' answers that arrived since.

## [0.3.21] - 2026-09-24

### Added
- **See how many tokens your bots use.** Each run in **Activity** now shows the tokens it used, as its CLI reported them: input, how much of that came from the provider's cache, output, and the cost when Claude Code reports one. A **Tokens today** panel at the top of Activity adds them up per bot.
  - Works for Claude Code, Codex, and Gemini. Cursor Agent shows only the run time, because its CLI doesn't report tokens. Hermes and custom CLIs report nothing.
  - Only numbers are recorded, never message or prompt text.
- This is the first step of making Any Bot leaner: with these numbers, the next updates can show exactly how much less they send to your bots.

### Changed
- **Any Bot keeps less on disk.** The full text of what was sent to a bot is now kept only for the newest 50 runs (older runs keep just its size). The internal event log keeps 90 days.

### Fixed
- **Codex replies ran their sentences together.** Codex often says what it's about to do ("I'll run the tests.") before its answer, and the two were joined with no space ("I'll run the tests.All 12 pass."). Each Codex message now starts its own paragraph.
- A thread's header and its "Goes to …" line now include bots whose turn failed.
- The thread message box says "who is in this thread" when there's only one bot.

## [0.3.20] - 2026-09-24

### Fixed
- **Your phone briefly lost touch after Any Bot restarted on your computer.** The phone reconnected on its own, but anything it asked for in that first moment failed with "Reconnecting…", so it showed as offline until its next refresh. It now waits the moment the reconnect takes. This fix is in the phone app, so it arrives with the next phone app build.
- **A phone that reconnected, for example after switching networks, could lose its next request.** When the relay noticed that the phone's old connection had closed, it told your computer the phone had left, even though the phone was already back on a new connection. The relay now says so only when the phone has no connection left. This takes effect once the relay is redeployed.
- **On a self-hosted relay, a phone could lose touch after your computer reconnected.** The relay kept passing the phone's messages to the computer's old connection while that connection closed, so the messages were lost. It now uses the open connection. The hosted relay wasn't affected.

## [0.3.19] - 2026-09-24

### Fixed
- **Codex bots failed every run within two seconds** ("Codex is ignoring 1 unrecognized configuration setting"). Codex reports startup warnings, such as a `config.toml` setting it doesn't recognize, as error items. It then carries on, but Any Bot stopped the run at the first one. Warnings before Codex starts its turn now show in the bot's terminal as ⚠ lines, and the run continues. An error during the turn still stops it right away.
  - This also let bots confer again: when Dario @mentioned Altman, Altman's turn had been failing the same way.

## [0.3.18] - 2026-09-24

### Added
- **Watch a bot's terminal.** In **Activity**, click a bot's row to open its terminal underneath and see exactly what its CLI is doing, live:
  - the command it ran
  - each tool call (commands, file reads and edits, searches) with the start of its output
  - the model's text as it writes
  - warnings the CLI prints
  - the exit, and at the end the turns, time, cost, and tokens used
  - It works for Claude Code, Codex, Gemini, Cursor, Hermes, and custom CLIs. Secrets in the output are hidden, as in replies.
  - Each run's log is kept on this computer (the newest 300 runs).

### Fixed
- **Bots stopped doing any work, and everything sat in the queue.** The **Stop all** button above the message box also paused new work for the whole workspace, and the only sign was a small "New work paused" line at the bottom of the sidebar.
  - **Stop all** in a chat now stops only that chat's work.
  - When new work is paused, a banner says so in the chat and on Activity, and the sidebar has a **Resume** button. **Stop the team** in Runtime & privacy still stops everything and pauses on purpose.
  - A queued run's terminal says when it's waiting because new work is paused.
  - Workspaces that the old **Stop all** left paused are resumed once when you update, so work already waiting in the queue starts.
- **Bots asked together couldn't confer.** When two bots worked on the same thread at once, the first to finish could @mention the other, but that mention was dropped because the other bot was still busy. Now the mention waits: the teammate answers it as soon as its own reply is done, with the whole thread in view.
- **Up to 8 bots work at the same time**, up from 2. Each bot still works on one assignment at a time.

### Changed
- **Bots in every project can pass work to each other.** There's no longer a setting for it: in any project with two or more bots, a bot can hand off a task or @mention a teammate into its thread. This applies to projects you've already made, including ones created with handoffs off.
  - The switch is gone from New project and Edit project on the desktop, and from new chats on the phone.
  - The project header now says "Bots hand work to each other".
  - Direct chats with one bot are unchanged, and the limits stay: 8 runs per task, and 6 bot-to-bot @mentions in a thread before it waits for you.

## [0.3.17] - 2026-09-24

### Added
- **Edit and delete projects, like bots.** Hover a project in the sidebar and click "…" for **Edit** and **Delete**. The **Settings** button in a project's channel opens the same Edit form, with Delete at the bottom.
  - **Edit** changes the project's name and folders, and now also whether bots hand work to each other and bring teammates into threads (before, that could only be set when the project was created).
  - **Delete** archives the project, the way deleting a bot does. It leaves the sidebar, and any work in progress stops. Its autopilot and routines are turned off. Its messages, board, canvas, and files are kept.
  - **Archived** at the end of the Projects list shows deleted projects. Open one to read its history, or restore it from the list or from the banner in its channel.
  - An archived project can't take new work until it's restored, from the desktop, the phone, a routine, or the board. It's hidden from the phone app and the knowledge graph.

## [0.3.16] - 2026-09-24

### Fixed
- **The welcome in a new, empty project was hard to read over the Solarpunk and Cyberpunk scenes** (as low as 2.2:1). It now sits on a card. The contrast audit now also checks empty projects and open threads.
- **Update notes showed raw HTML** (`<p>Windows installer…`). The update card now shows what changed in the new version as plain text. Each release's notes on the update feed are now that version's entry from this changelog.

## [0.3.15] - 2026-09-24

### Added
- **Threads.** In a project, a message that puts bots to work opens a thread under it. The bots work and reply there, so the channel stays a list of topics.
  - Under each message, a summary shows who is in the thread, how many replies it has, who is working now, and any failed runs. Click it to open the thread beside the channel.
  - The thread keeps its own reply box. A reply with no @mention goes to the bots already in the thread.
  - A bot in a thread sees the whole thread, plus the latest few channel topics (each with its latest reply) as background.
- **@mentions decide who works.** Type `@` for a menu of your bots (arrow keys, then Enter or Tab), or click a bot under "To", which now adds or removes its @mention in the message.
  - A project message with no @mention posts as a note, and no bot runs. The hint under the box says so before you send, or lists who the message goes to.
  - Direct chats are unchanged: the bot always answers.
  - @mentions of your bots are highlighted in messages.
- **Bots collaborate in threads.** When "Let bots delegate" is on for a project, a bot can bring in a teammate by writing `@Name` in its reply. The teammate joins the same thread with the reply as its assignment.
  - A bot that's already working isn't started twice.
  - After six bot-to-bot hand-offs without a message from you, the thread pauses and asks you to reply to keep it going.

### Fixed
- **"Has a question" no longer shows when a bot's closing question is to a teammate** ("@Morgan can you build the page?").

## [0.3.14] - 2026-09-24

### Fixed
- **A bot could get stuck on "Waiting for the harness" forever, and stopping it left it on "cancelling".** Seen with Codex on Windows:
  - Codex started a helper process (its computer-use runtime) that kept Codex's output pipes open after Codex itself exited.
  - Stopping the run killed Codex's process tree, but the helper was already cut off from that tree, so it survived.
  - The helper held the run open, and the bot couldn't start new work.

  Two changes stop this happening again:
  - **Runner:** once the harness process has exited, Any Bot waits at most two seconds for its output instead of waiting on leftover helpers.
  - **Coordinator:** a stopped run that still hasn't exited after 20 seconds is recorded as cancelled, its bot is freed, and Diagnostics shows "didn't stop cleanly".
- **Text is readable in every theme (WCAG AA).** An audit of every view in all four themes checked each piece of text and each icon against the worst case, a pure black or pure white scene behind it. It found 621 problems; now there are none.
  - **Solarpunk, Cyberpunk, and Matrix:** text over the animated scenes now always sits on an opaque box, and the scene shows in the space between them.
    - The sidebars, chat heading, and tabs are solid.
    - Each message's name, time, and status sit in a pill above its bubble.
    - Pages and the canvas are sheets floating on the scene.
    - Cyberpunk's hologram bubble for your own messages has a solid base.
  - **The faintest grey text** (timestamps, counts, hints, chips) passed as low as 2.6:1, even in Studio paper. Every theme's two lightest ink steps now reach at least 4.5:1 on every surface they're used on.

### Added
- **Bots show what they need from you.** An icon right of each bot's name in the sidebar:
  - shield: needs your approval
  - red alert: its last run failed
  - warning triangle: its last reply asks you a question
  - pull request: it linked a PR for review
  - check: it finished and you haven't read the reply

  The line under the name says the same in words. A question or PR clears once you reply.

### Technical
- **Theme rules:** `validateTheme` now requires `ink-3` and `ink-4` to reach 4.5:1 on paper, card, paper-2, and paper-3. The new values (paper ink-3 0.49, ink-4 0.505; Solarpunk ink-3 0.49, ink-4 0.505; Matrix ink-4 0.61; Cyberpunk ink-4 0.635) are mirrored in `style.css`.
- **Backdrop themes:** in `themes.css`, text containers get `var(--paper)`, and glass covers only empty space.
- **Attention icons:** `src/lib/attention.js` decides a bot's state (with tests in `tests/attention.test.mjs`), and `AttentionIcon.jsx` draws it.
- **Stuck runs:**
  - `runHarness` also settles on the child's `exit` plus a `pipeGraceMs` drain (2 s).
  - `Coordinator.forceCancelled` runs `stuckCancelMs` (20 s) after a cancel. It records the run as cancelled, frees the bot and workspace, and writes a `harness.stuck_cancel` diagnostic.
  - `tests/stuck-runs.test.mjs` reproduces the pipe-holding detached helper (it hangs without the fix) and a runner that ignores cancellation.

## [0.3.13] - 2026-09-23

### Added
- **Connect your phone with one QR code.** Open **Settings → Your phone** on the computer and click **Connect a phone**. On the phone, tap **Scan QR code**.
  - No addresses, certificates, config files, or accounts.
  - The phone stays paired across restarts and works on Wi-Fi or mobile data.
  - The Settings card lists paired phones, with when each was last seen and a **Remove** button.
- **End-to-end encryption.** The phone and the computer meet through a small relay, and everything between them is encrypted with keys from the QR code. The relay can't read or change anything.
  - A code works once, for ten minutes.
  - A phone removed on the computer is cut off immediately and told why.
- **The phone app starts with Scan QR code.** Pasting the code works too. The old server form moved under **Advanced: connect to a server**.

### Technical
- **Protocol (`runtime/link-protocol.mjs`):** WebCrypto on both ends.
  - Keys: P-256 ECDH with long-term and per-connection keys, HKDF-SHA-256 over a full transcript, and two directional AES-256-GCM keys.
  - Frames: 8-byte counters reject replays.
  - Pairing: HMAC proof of the QR code's one-time secret, plus a desktop key confirmation.
- **Desktop (`runtime/phone-link.mjs`):**
  - It holds one outbound WebSocket to the relay, with backoff and keepalive.
  - It pairs phones; a new phone stays pending until its first real request.
  - It serves requests through the mobile gateway's new `handle()`, which was extracted from the HTTPS server with no behavior change; the 15 gateway tests are unchanged.
  - `createMobileGateway({ serve: false })` runs without any listener.
  - Secrets at rest use Electron `safeStorage`.
  - IPC: `phone.status`, `phone.pair`, `phone.cancelPairing`, `phone.remove`.
- **Phone:**
  - `mobile/link-client.mjs` exposes the same `request()` as the HTTPS client and keeps the pairing in IndexedDB with a non-extractable key.
  - `mobile/Scanner.jsx` scans with the camera plus jsQR, so no native plugin is needed.
  - The Android app gains the CAMERA permission, and its CSP allows `wss:`.
- **Relay (`relay/`):**
  - `room.mjs` holds the shared room logic.
  - `worker.mjs` is the Cloudflare Worker with hibernating Durable Objects.
  - `node-server.mjs` runs the same logic on Node for tests and self-hosting.
  - `wrangler.toml` configures deployment; see `relay/README.md`.
  - The relay is deployed at `https://anybot-relay.anybot-desktop.workers.dev` (Tony's Cloudflare account) as `DEFAULT_RELAY_URL` in `desktop/main.cjs`, and `ANYBOT_RELAY_URL` overrides it.
- **Tests:**
  - `tests/phone-link.test.mjs` passes on the Node relay and on the real Worker under `wrangler dev`. It covers pairing, requests and errors, used/expired/tampered codes, restarts on both ends, removal, desktop offline, replay and tamper, and relay room ownership and frame cap.
  - Also verified: the real mobile UI scanning through Chromium's fake camera, and real Electron pairing through IPC into the coordinator.

## [0.3.12] - 2026-09-23

### Fixed
- **Automated publishing works.** Its first real run found two bugs in `scripts/publish-release.mjs`, which had never run before because of the billing block.
  - It requested `repos/gilfila/anyBot/` with a trailing slash, which GitHub answers with 404. The test mock accepted the slash, so the tests missed it; the mock now returns 404 for trailing slashes, as GitHub does.
  - It refused to publish unless the source repo was private. The source is public now, so only the distribution repo is required to be public. A new test covers a private distribution repo.
  - The public download page no longer says the source is private.
- **Release builds no longer fail on a slow test.** The first automated release of 0.3.11 failed because one test's wait for queued runs gave up after 5 seconds. GitHub's Windows runners took over 8, even though the test passes easily on a PC.
  - Every test that waits for runs to settle now allows up to 30 seconds.
  - Passing tests are no faster or slower; only a real hang takes longer to report.

## [0.3.11] - 2026-09-23

### Added
- **Every bot reply has its own bubble.** Bot messages sit on a solid, rounded bubble instead of blending into the page or the animated backgrounds.
- **Choose each bot's bubble color** in the bot editor, under Chat bubble.
  - **Match robot** (the default) or one of nine tints: Plain, Sky, Mint, Sage, Sand, Peach, Rose, Lilac, Slate.
  - A sample bubble previews the choice in the current theme.
  - Each theme picks the shade: a pale tint in light themes and a deep one in dark themes, so the text stays readable either way.

### Changed
- **Larger bots again, about 20% bigger:**
  - sidebar: 60px
  - chat: 64px
  - team roster: 88px
  - org chart cards: 80px (the cards are wider, so roles no longer get cut off)
  - agent panel: 108px
  - approval cards and the working indicator: 52px
- **Solarpunk and Cyberpunk have living, detailed backgrounds.** The flat drawings are replaced with looping scenes:
  - **Solarpunk:** a sunlit valley with orchards, terraced gardens, wheat, a river, wind turbines, and robots tending the crops.
  - **Cyberpunk:** a rainy neon megacity at night with holograms and flying cars.

  Both were made with Higgsfield. The theme cards in Settings show the same scenes. Turning off animations (in Settings or in Windows) shows a still frame instead, and the video pauses while the window is hidden.
- **Check for updates is back at the top of Settings,** above Appearance.

### Technical
- **Bubble colors:**
  - `src/lib/bubbles.js` holds the palette. A bot's choice is stored as `bubble` in its avatar JSON, so no schema change was needed.
  - `parseAvatarConfig` keeps the key, and `"auto"` is the default.
  - Messages get `from-bot` plus `--bubble-h`/`--bubble-k` custom properties.
  - `style.css` sets the shade per `data-scheme`, which `applyTheme` now writes.
  - The Matrix, Solarpunk, and Cyberpunk bubble presets layer over the tint.
  - `tests/bubbles.test.mjs` checks every tint in every theme: ink ≥ 7:1, ink-2 and links ≥ 4.5:1.
- **Video backdrops:** `VideoScene` in `ThemeBackdrop.jsx` plays `src/themes/media/{solarpunk,cyberpunk}.webm` (VP9, 1080p, no audio) over its first-frame JPEG, with a veil (`.scene-veil-*`) that keeps text on the glass surfaces readable.
- **Seamless loops:** each clip is animated from one keyframe back to the same keyframe, and the encode crossfades its last second into its first. `scripts/make-scene-loop.sh` reproduces the encode.
- **Glass levels retuned for the busier scenes:**
  - Solarpunk's side panels are more opaque (`glass-2` 0.8).
  - Cyberpunk's main surface is lighter (`glass` 0.5), so the city shows through.
- **Old scenes removed:** the SVG `Meadow`/`NeonCity` scenes and their CSS are gone. That removes a second `@keyframes robot-bob` in `themes.css` that collided with the avatar animation of the same name in `style.css`.

## [0.3.10] - 2026-09-23


### Changed
- Unified Any Bot branding around the approved darker sage Scout helmet, with matching desktop, taskbar, tray, installer, app header, browser, and mobile launcher artwork.
- Product display name is now **Any Bot**. Existing app IDs, executable/update filenames, installation identity and user profiles remain compatible.
- Enabled Windows icon and executable metadata embedding while retaining unsigned builds. Added reproducible icon exports from one approved master.
## [0.3.9] - 2026-09-23

### Added
- **The model list stays current on its own.** Every time you open the bot editor, anyBot reads each harness's own list. New models show up the day they ship, with no anyBot update:
  - **Claude Code:** its server-provided list, including context variants such as `claude-fable-5-1[1m]`. Models that need a newer CLI appear grayed out, with the reason.
  - **Codex:** its model cache.
  - **Gemini:** the models in the installed CLI.
  - **Hermes:** its configured provider's catalog.

  The old filter that showed only Fable, Sonnet, and Opus for Claude is gone. A model you typed under Custom switches to the list entry once it appears there.
- **A features-first README** with screenshots of the current app. The technical material (running from source, updates, publishing releases, verification, mobile, headless mode, security boundaries) moved to `docs/operations.md`.

### Changed
- **Bigger bot avatars.** The robots were too small to show their animation and detail, so they are larger everywhere:
  - sidebar and chat: about 50px (from 38px)
  - team roster and first-run templates: 64–72px
  - org chart and knowledge-graph cards: 64–88px
  - approval cards and the working indicator: 44px
- **The bot editor's close button and Save stay on screen.** In every dialog, the heading and close button stay pinned at the top and the Save button at the bottom. Only the form scrolls.

### Technical
- **`discoverLiveModels(harnessId)`** in `runtime/adapters.mjs` reads the lists:
  - Claude Code: `~/.claude.json` `additionalModelOptionsCache`
  - Codex: `models_cache.json` in `CODEX_HOME`, in priority order, skipping hidden models
  - Gemini: model ids scanned from the CLI bundle, cached by the bundle's modified time
  - Hermes: `config.yaml` names the provider, then its `cache/model_catalog.json` (CRLF-safe)
- **`mergeModelOptions`** dedupes the entries, with the owner's `models.json` first.
- **Refresh on open:** the new coordinator command `harnesses.models` (on the IPC allowlist) refreshes only the model lists. The editor calls it when it opens.
- **Bracketed model ids** such as `[1m]` are now valid. Models are passed as a single argv entry, never through a shell.
- **Tests:** `tests/models.test.mjs`.


## [0.3.8] - 2026-09-23

### Fixed
- **Bots could get blocked with no way to approve anything.** Claude bots ran headless in "ask" mode, so every gated action (writing a file, running a command, opening a browser) raised a permission prompt that could never be shown. Each one quietly became a denial.

### Added
- **Auto mode is the new default.** Claude bots use Claude Code's auto mode:
  - safe actions just run
  - file edits inside the bot's workspace are always allowed
  - only risky actions wait for you, such as deleting files, force-pushing, or work outside the workspace

  Existing bots that were on "Ask before acting" were moved to Auto, since that mode could only deny.
- **Approvals in the chat.** When a bot needs permission, an approval card appears above the composer. It shows exactly what the bot wants to do (the command, file, or address) with **Approve** and **Decline**.
  - The bot's run pauses until you answer. Requests nobody answers within 15 minutes are declined.
  - Each answer, expiry, or withdrawal leaves a line in the chat, so you and the bot can see what happened.
  - The bot's row in the sidebar says "Needs your approval", and a Windows notification appears if anyBot isn't in front.
- **Three permission modes** on the bot form:
  - **Auto** (safe actions run, risky ones ask you)
  - **Edits run, everything else asks you**
  - **Ask before every action**

  Codex, Gemini, and Cursor have no approval hook. In Auto they edit files in their workspace, and actions that would need approval are skipped.

### Technical
- **Claude runs:** `--permission-mode auto --allowedTools "Edit(./**)"` (or `acceptEdits` / `default`), plus `--permission-prompts host --permission-prompt-tool mcp__anybot__approve --mcp-config <per-run file>`.
- **The bridge:** `runtime/approval-mcp.mjs` is a dependency-free stdio MCP server, run with `ELECTRON_RUN_AS_NODE` and unpacked from `app.asar`. It forwards each request over loopback HTTP, with a random 256-bit per-run token, to `runtime/approvals.mjs`, which holds the request open until the owner decides.
- **Limits:** tokens die with the run, request bodies are capped at 64 KB, and each run can have at most 20 pending requests.
- **Schema v12:** an `approvals` table. The owner decides through the `approvals.decide` IPC method. Gemini's Auto maps to `--approval-mode auto_edit`.
- **Verified with the real Claude Code CLI** through anyBot's coordinator. In auto mode, a file write and `ls` ran without asking, and `rm -f old.txt` waited for approval, then ran once approved. Declined requests are reported to the bot. Tests: `tests/approvals.test.mjs`.

## [0.3.7] - 2026-09-23

### Added
- **Themes** (Settings → Appearance). Each theme changes colors, type, the background behind the app, and how chat boxes look:
  - **Matrix:** phosphor green on black, terminal type, square corners, faint CRT scanlines, code raining down behind the app, and a shell prompt in front of your messages.
  - **Solarpunk:** a light, airy look with a sunny sky, drifting clouds, and a valley of rolling hills. The valley has terraced wheat, fruit trees, sunflowers, solar panels, a turning wind turbine, and robots tending the gardens. Rounded glass panels and leaf-shaped chat boxes.
  - **Cyberpunk:** neon on midnight, with a glowing skyline and a rolling grid. Borders cycle through neon colors, and chat boxes are holograms with scanlines and corner brackets that flicker in.
  - **Studio paper** stays the default.

  Every card previews its theme in that theme's own colors. The choice is saved on this computer and applied before the first paint.
- **Animated backgrounds and effects** switch. It is always off when Windows asks for reduced motion, and backgrounds pause while the window is hidden.
- **Custom themes are designed but not built yet:** `docs/themes.md` describes import, editing, and sharing. Themes are data only (colors, a font, and named presets) and must pass readability checks, so a theme can't run code.

### Fixed
- **The bot menu (Edit, Delete) no longer gets clipped by the sidebar's bot list or adds a scrollbar to it.** It opens as a top-level popup over everything, flips upward near the bottom of the window, takes keyboard focus (arrow keys move between items, Escape closes it), and closes when the list scrolls.

### Technical
- `src/themes/themes.js` holds the themes as data, plus OKLCH-to-sRGB contrast math and `validateTheme()`. The same checks will gate imported themes.
- `src/lib/theme.js` stores and applies the theme. `ThemeBackdrop` draws the canvas code rain, the SVG meadow, and the neon city. `themes.css` holds the decoration presets.
- The knowledge-graph category colors are re-validated for each theme's surface (lightness band, all pairs, color-vision deficiency). The UI font is now the `--font-ui` token.
- New `FloatingMenu` component (portal, fixed position, focus management). Tests: `tests/themes.test.mjs`.
- The Organization page (org chart, knowledge graph, d3) is code-split and loads on first visit, keeping the main bundle under Vite's 500 KB advisory.

## [0.3.6] - 2026-09-23

### Added
- PR-driven Windows release workflow with version validation, packaged dependency/UI verification, exact-source provenance, and an installer-only public asset allowlist. Merging to main publishes after verification once the scoped GitHub App and Actions billing are configured.
- Direct installer download page and safeguards against reused versions, mismatched source tags, incomplete uploads, and update-feed downgrades.

## [0.3.4] - 2026-09-23

### Added
- Three sculpted bot avatars: Scout, Orbit, and Tinker, each available in cobalt, coral, citron, and violet. Customization includes live model, expression, and activity previews; existing avatar settings migrate automatically.
- Bots rest at a 30-degree angle, turn toward a holographic screen while working, and face you with a hello wave when they have unread replies. Opening their conversation returns them to idle; active work takes precedence. Reduced-motion preferences are respected.

## [0.3.3] - 2026-09-23

### Added
- **Knowledge graph** (Organization → Knowledge graph). One graph connects your bots, projects, tasks, and files with the facts that bots and you write about them.
  - **Workspace links** are derived from what already exists: who reports to whom, project membership, task assignees and completions, and the files each run produced. They stay current on their own.
  - **Bots add facts** with a `kg.fact` action (subject, relation, object, optional note). Names of bots, projects, and tasks link to those nodes. New names become entities such as a decision, a person, or a tool. Repeating a fact updates it instead of duplicating it, and every written fact records who wrote it, in which run, and when.
  - **Recall:** each run gets the facts relevant to its assignment (SQLite FTS5), labelled as workspace data. Facts written by bots are marked `[bot-written]`, so other bots treat them as unverified.
  - **You curate:** add facts; rename, retype, annotate, or delete entities. Pinning a fact vouches for it: it is always recalled and loses the bot-written marker. Pinning an entity puts all of its facts in every prompt.
  - **The view:**
    - a force layout with visible labels, and a type legend that doubles as a filter
    - search, and a neighborhood focus of 1 or 2 hops (double-click a node)
    - a written-facts-only filter and a Facts table
    - distinct line styles for workspace links, your facts, and bot facts
  - **Ask the graph:** sends your question, with the facts that match it, to a bot you choose as a direct message. The answer arrives in that chat.

### Fixed
- Board search showed a doubled focus ring.

### Technical
- **Schema v11:** `kg_entities`, `kg_edges`, and an FTS5 index (`kg_fts`). Workspace nodes are derived on read (ids `agent:`, `project:`, `task:`, `artifact:`) and never stored. New `runtime/knowledge.mjs`.
- **New IPC methods:** `graph.get`, `graph.fact`, `graph.entityUpdate`, `graph.entityDelete`, `graph.edgeUpdate`, `graph.edgeDelete`, `graph.ask`.
- **New renderer dependency:** `d3-force`. Categorical color tokens `--cat-agent`, `--cat-task`, `--cat-project` were validated as a set for color-vision deficiency on the paper surface. Tests: `tests/knowledge.test.mjs`.

## [0.3.2] - 2026-09-23

### Added
- **Chain of command.** Every bot can report to another bot or to you ("Reports to" on the employee form, or drag it on the new org chart). Reporting loops are rejected.
  - Managers can delegate to anyone below them from **any** conversation, including a direct chat where peer delegation is off. The report runs as a guest in the manager's conversation.
  - Delegating sideways or upward still needs a shared project with delegation enabled.
- **Manager reviews:** a task's reviewer defaults to the lead assignee's manager, even when that manager isn't in the project. When a card reaches Review, a review run is queued for the reviewer. The reviewer answers with a `review` action: approving finishes the task, and requesting changes sends it back to the lead with the comment and re-runs the lead. Tasks get at most three review rounds; after that you decide.
- **Roll-up reports:** when a bot finishes task or delegated work, a report goes to its manager. The summary is the bot's own `report` action, or else the start of its reply. Managers read unread reports at the start of their next run. Reports addressed to you collect in **Organization → Reports**, with an unread badge in the sidebar.
- **Memory:** bots save durable facts with `memory.save` and remove their own with `memory.forget`. Memories are scoped:
  - private: visible to the bot, its managers, and you
  - team: visible to every bot
  - project: visible in that project only

  Each run recalls pinned memories plus the most relevant ones, ranked by SQLite FTS5 `bm25`. You can add, pin, and delete memories from a bot's panel.
- **Organization page** (new sidebar item):
  - **Org chart:** a tidy tree with you at the root. Each card shows live status and done/open counts, and you drag a card onto another to re-parent it.
  - **Agent panel:** manager, direct reports, current work, recent finished work and reports, and editable memory.
  - **Reports feed:** filter "To you" or "Whole org", with mark-all-read.

### Technical
- Schema v10: `employees.manager`, `memories` with an FTS5 index (`memories_fts`), and `reports`. New `runtime/org.mjs` and `runtime/memory.mjs`. Actions add `memory.save`, `memory.forget`, `report`, and `review`.
- New IPC methods: `employees.setManager`, `org.get`, `reports.markRead`, `memory.list|create|update|delete`. The allowlist test now scans every renderer module (`act`, `request`, `call`).
- New renderer dependency: `d3-hierarchy`. Tests: `tests/org.test.mjs`.

## [0.3.1] - 2026-09-23

### Added
- **Project doc page.** Projects get a third tab, **Doc**: a Notion-style page of blocks (headings, text, bulleted/numbered lists, to-dos, quotes, callouts, code, dividers) with a `/` command menu, Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `---`), Enter/Backspace list behavior, and drag handles to reorder.
- **Live embeds and mentions:** `/task` and `/file` embed board tasks and returned files (task cards show live status and assignees). `@` links a bot, task, or file inline, and clicking a task mention opens its side peek.
- **Employees write to the doc** with `doc.append` (add to the end) and `doc.section` (replace the content under a heading, or add the section) actions. They never rewrite the whole page. Their blocks carry an author badge. Every run in a project sees the doc's section list and first ~3k characters as untrusted workspace data.
- **Saves and history:** edits save automatically (debounced) with revision checks. If an employee changed the page meanwhile, the owner's edits are merged by block instead of overwritten. **History** keeps the last 20 versions with one-click restore.

### Fixed
- Board: task start is logged before its runs are queued, so a card no longer stays In progress when the clock ticks between the two (also shipped to PR #25).

### Technical
- Schema v9: `docs` and `doc_history`. New `runtime/docs.mjs` (block validation, markdown↔blocks, agent section edits), `src/components/doc/*` (editor plus pure `blocks.js` helpers), and mention tokens `@[label](task|agent|file:id)` rendered escape-first by `renderMarkdownInline(text, { mentions: true })`.
- New IPC methods: `docs.get|save|history|restore`. Tests: `tests/docs.test.mjs` and `tests/doc-editor.test.mjs`.

## [0.3.0] - 2026-09-23

### Added
- **Project boards.** Every project (a conversation with more than one bot) gets **Chat** and **Board** tabs. The board has Backlog, In progress, Review, and Done columns with drag and drop (pointer and keyboard), a sortable **Table** view, filters (text, assignee, priority), and inline "New task" rows.
- **Task side peek:** editable title, status, assignees (the first is the lead), reviewer, priority, due date, labels, description, and checklist, plus linked runs, returned files, and an activity timeline with comments. Buttons for Start, Stop work, Approve, and Request changes.
- **Collaborative task runs:** Start queues one run per assignee. The lead and collaborators each get the task brief, checklist, co-assignees, and recent activity in their prompt, and delegated work inherits the task. When the work ends, a card still In progress moves to Review (if it has a reviewer) or Done (if every run succeeded); failures leave it In progress with a note.
- **Agent board actions** (`anybot-actions` block, at most 20 per reply): `task.update` (status, progress note, checklist), `task.create` (Backlog only), and `task.claim` (unassigned Backlog tasks). The coordinator validates each one: only project members, only a task's assignees or reviewer, only the reviewer (or the owner) past Review, and only once collaborators finish when a lead asks to finish early. Results are posted as a notice, and the JSON block is hidden from the chat.
- **Autopilot** per project (off by default) starts an idle assignee's highest-priority Backlog task.
- Task starts appear in the chat as a compact card linking to the board.

### Technical
- Schema v8: `tasks`, `task_activity`, `runs.task`, and `conversations.autopilot`. `SCHEMA_VERSION` is now a single constant in `runtime/store.mjs`.
- New `runtime/board.mjs` (task data, fractional sort keys, permission rules) and `runtime/actions.mjs` (action-block parser and prompt guide).
- New IPC methods: `tasks.get|create|update|move|delete|comment|start|stop|review` and `conversations.setAutopilot`.
- New renderer dependency: `@dnd-kit/core`/`sortable`/`utilities`.
- Tests: `tests/board.test.mjs` and `tests/actions.test.mjs`.

## [0.2.27] - 2026-09-22

### Fixed
- **Updates from 0.2.25 failed to install** (installer exit code 2, app did not relaunch). 0.2.25 bundled `@capacitor/android` with its Gradle build output under `resources\app.asar.unpacked`, at install paths up to 258 characters. Before installing, NSIS runs the old uninstaller, which moves every file into `%TEMP%\nsXXXX.tmp\old-install\` for rollback; that pushed those paths past Windows' 260-character limit, the move failed, and the update rolled back. The installer now removes that folder in place (`build/installer.nsh`, `customInit`) before the old uninstaller runs. Verified by updating a real broken 0.2.25 install with the updater's own arguments (`--updated /S --force-run`): exit 0, app relaunched, data intact.
- The desktop package no longer includes mobile-only `@capacitor` modules, so a local Android build can't leak into the installer again. Guarded by `tests/packaging.test.mjs`.

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
