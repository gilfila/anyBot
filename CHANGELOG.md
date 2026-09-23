# Changelog

All notable changes to anyBot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.3.6] - 2026-09-23

### Changed
- **The Doc page is now the Canvas**, and it works like a Slack canvas: one shared, semi-structured page per conversation that you and your bots both write. Every conversation has one, one-bot chats included: the tabs are **Chat · Board · Canvas** in projects and **Chat · Canvas** in direct chats.
- **Canvas beside the chat:** the chat side panel's **Deliverables** tab is now **Canvas**. It shows the same editable canvas next to the conversation, with **Open full canvas** to expand it.

### Added
- **Files & outputs** at the top of every canvas: every file the bots returned in the conversation, with who made it, size, and age. Click a file to open it, show it in its folder, or add it to the page.
- **Links from the chat:** every link shared in the conversation, newest first, one per address. Click to open, or add it to the page as a link card.
- **Tables:** `/table`, editable in place.
  - Tab and Shift+Tab move between cells, and Enter moves down, adding a row at the end.
  - A toolbar adds and deletes rows and columns.
  - Cells render links, bold, and code.
- **Link cards:** `/link`, or any line in a bot's canvas update that is only a link.
- **Starter templates** for an empty canvas: Project brief, Meeting notes, and Tracker.
- **Markdown tables from bots:** they become canvas tables in `doc.append` and `doc.section`, and they now render as real tables in chat messages instead of raw pipes.

### Technical
- Canvas blocks add `table` (`rows`, at most 100 × 12, cells up to 500 characters) and `link` (http(s) `url` only). `markdownToBlocks` and `blocksToMarkdown` round-trip GFM tables, including escaped pipes.
- Doc actions now work in any conversation whose members include the bot. Prompts and the action guide call it "the canvas".
- New `src/components/doc/CanvasParts.jsx` and `canvas.css`. Tests: `tests/canvas.test.mjs`.

## [0.3.5] - 2026-09-23

### Added
- **Diagnostics** (Settings → Diagnostics). anyBot keeps a local log of problems and shows them grouped by kind, each with a plain-language next step. A badge on **Runtime & privacy** counts new problems. The log keeps error details only (never conversation text), redacts keys, is capped at about 3 MB, and never leaves the computer. Copy report, Open log folder, and Clear are one click each.
  - **Harness failures are sorted by cause:** not installed, sign-in, usage limit, timeout, unavailable model, no answer, failed to start, or another exit. Each has a fix hint and an Edit bot or Open harnesses button.
  - **Bot output anyBot couldn't use:** unreadable `anybot-actions` blocks, refused board, doc, memory, and graph actions, refused handoffs, and files that weren't collected.
  - **Updates:** the updater's timeline and failures are logged. Before installing, anyBot notes the version it expects, so an installer that fails (like the 0.2.25 → 0.2.26 case) shows up as "The update didn't install" on the next start.
  - **Crashes and internal errors:** coordinator exits and error output, crashed background processes, unexpected command failures, window errors, and formatting failures.
- **Crash recovery screen:** a rendering bug now shows "Something went wrong on this screen" with Reload and Copy details, instead of a blank window.

### Fixed
- A message the markdown renderer can't process now falls back to plain text instead of breaking the view.

### Technical
- New `desktop/diagnostics.cjs` (JSONL log with rotation, fingerprint grouping, burst suppression, and the pending-update check), `runtime/diagnostics.mjs` (harness error classification), and `src/lib/diagnostics.js` (reporting, descriptions, and the copyable report).
- The coordinator emits `diagnostic` events, which the worker forwards to the main process. Main-process IPC methods: `diagnostics.list|report|markSeen|clear|reveal`. Snapshots carry `diagnostics: {issues, unseen, errors}`.
- Updater install behavior is unchanged; anyBot only writes `update-pending.json` just before `quitAndInstall`. Tests: `tests/diagnostics.test.mjs`.

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
