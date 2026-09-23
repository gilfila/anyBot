# CLAUDE.md: anyBot

## Purpose
Local-first desktop workspace for named AI "employees" (a Grok-bot-style team UI). Each bot runs through a local harness (Claude Code, Codex CLI, Gemini CLI, Hermes, Cursor Agent CLI, or a custom CLI), can share project conversations, and can delegate to other bots. Source repo `gilfila/anyBot` (private); binaries ship through the public `gilfila/anyBot-updates` feed. README.md has the full product and ops detail; design.md is the architecture/security doc.

## Stack
Electron 44 main process (`desktop/main.cjs`) + sandboxed React 19 renderer (`src/`, Vite) + coordinator in an Electron utility process (`runtime/`, SQLite). `electron-updater` for silent NSIS updates. Capacitor mobile companion (`mobile/`), headless server (`server/`).

## Run / Build / Test
- `npm start` (builds renderer, opens Electron). `npm run build` for the renderer only.
- `npm test` (node:test, ~127 tests), `npm run test:runtime` (Electron utility-process smoke), `npm run doctor`, `npm run verify:local` (all gates).
- `npm run package` builds `release/anyBot-Setup-X.Y.Z.exe` + `latest.yml` + blockmap. Releases are uploaded to `gilfila/anyBot-updates` by hand; CI builds with `--publish never`.

## Structure
- `desktop/main.cjs`: window, tray, IPC, updater state machine. Renderer-callable coordinator methods must be in the `methods` allowlist (enforced by `tests/desktop-ipc.test.mjs`).
- `desktop/preload.cjs`: the only bridge (`window.anybot`). It exposes `runCommand` (a shell), so no untrusted content may ever run same-origin with the app.
- `runtime/coordinator.mjs`: commands, dispatch, delegation. Every command returns a snapshot; main decorates it with `update` + tray/login state (`withShellState`).
- `src/App.jsx`: whole app shell; `src/components/*`; `src/lib/markdown.js` (escape-first inline markdown, unit tested); `src/style.css`.

## Conventions
- **Design system "Studio paper"**: all colors are OKLCH tokens on `:root` in `src/style.css` (paper / ink / rule / accent vermilion / ok / warn / danger / block for dark code). Ink is the primary action color; vermilion only for unread, live work, send, updates. The "Studio paper layer" at the end of style.css overrides older rules. Do not reintroduce hex literals.
- Employee output is untrusted: escape before markdown, iframes for employee HTML use `srcdoc` + `sandbox="allow-scripts"` only (never `allow-same-origin` on local content).
- Each PR bumps `package.json` + `package-lock.json` version and adds a CHANGELOG entry.
- Do not change updater install behavior (`quitAndInstall(true, true)`, NSIS oneClick/perMachine=false) without testing a real update from the previous release.

## Last turn / Pending (2026-09-23)
**Roadmap in progress:** boards + doc pages + agent org/memory/knowledge graph. Plan: `~/.claude/plans/i-want-two-large-generic-liskov.md` (Phases 1–5). Decisions: agents act via `anybot-actions` blocks (MCP server later), the canvas is a Notion-style doc page, the chain of command is enforced, and knowledge is auto-derived plus agent-written.
**Phase 1 done (0.3.0): project boards.** `runtime/board.mjs` owns task data and agent permission rules. `runtime/actions.mjs` parses `anybot-actions` blocks. The coordinator handles `startTask`/`settleTask`/`autopilot`/`boardContext` and applies actions inside the run-completion transaction. UI lives in `src/components/board/*` (dnd-kit), with styles in `board.css` (tokens only). Verified by a real Electron e2e using a fake custom harness (`harnesses.json`) that emits actions.
**Phase 2 done (0.3.1): project doc page.** `runtime/docs.mjs` (block model, `doc.append`/`doc.section`, 20-version history), and `src/components/doc/ProjectDoc.jsx` shows rendered blocks until focused, then a textarea; `blocks.js` holds the pure editing rules and the conflict merge. Doc commands return doc objects (not snapshots), so the renderer calls them with `window.anybot.request` directly, not `act()`.
**Phase 3 done (0.3.2): chain of command + memory.** `runtime/org.mjs` (manager chain, loop checks, reports, stats), `runtime/memory.mjs` (scoped memories, FTS5 recall). The coordinator adds `applyAction` routing, `applyReview`, `onTaskMoved` (queues review runs, capped at 3 rounds), `orgContext` in the prompt (chain, unread reports marked read on delivery, recalled memories), and chain-of-command delegation in `delegate()`. UI: `src/components/org/*` (OrgPage with chart/panel/reports).
**Phase 4 done (0.3.3): knowledge graph.** `runtime/knowledge.mjs` derives workspace nodes and edges on read (never stored; ids `agent:`/`project:`/`task:`/`artifact:`). It stores written entities and edges (schema v11, FTS5 `kg_fts`) with provenance. Name resolution prefers workspace nodes in the run's own project. `recall()` feeds `knowledgeContext` in the prompt: pinned facts, then written facts near the assignment, then workspace edges touching named nodes. Pinning an edge drops its `[bot-written]` marker. `graph.ask` posts into (or creates) the bot's direct chat via `send()`. UI: `src/components/org/KnowledgeGraph.jsx` (d3-force SVG, Facts table, entity panel) + `knowledge.css`. Node colors use the `--cat-*` tokens.
**Next:** Phase 5, a local MCP server so bots can query and write live mid-run. Also publish 0.3.x to the update feed (still at 0.2.27).
**Shared working tree:** another session (Codex, avatar "Character Studio" redesign) edits these files in this checkout: `src/constants.js`, `src/lib/avatar-config.js`, `src/lib/bot-avatar-*.js`, `src/components/RobotAvatar.jsx`, `src/components/robot-avatar.css`, `.superdesign/`, and `design/bot-redesign-options.md`. It also has uncommitted hunks in `src/App.jsx`, `src/components/EmployeeForm.jsx`, and `CHANGELOG.md` (its Unreleased entry). Never stage those; for shared files, stage only your own hunks. Commit with explicit paths, not `git add -A src`.
**Local test caveat:** `tests/server.test.mjs` binds fixed port 4319. When another process holds it (for example a Codex preview server), 2 tests fail with EADDRINUSE; CI is unaffected.

### Earlier (2026-09-22)
**0.2.27: update-install fix.** Updating from 0.2.25 failed (NSIS exit 2): 0.2.25 shipped `@capacitor/android` Gradle output at 258-char install paths, and the old uninstaller's rollback move to `$PLUGINSDIR\old-install` exceeded MAX_PATH. `build/installer.nsh` `customInit` deletes that folder before the old uninstaller runs; `@capacitor` is excluded from `build.files`. Tested on Tony's broken 0.2.25 install with `--updated /S --force-run`: exit 0, relaunched, DB intact. 0.2.26 is on the feed but superseded; skip it.

**Full review + Studio paper redesign (0.2.26)**, merged as PR #23 and released: tag `v0.2.26` on the source repo, installer + `latest.yml` + blockmap published as `v0.2.26` (Latest) on `gilfila/anyBot-updates`. Fixed: `runs.dismiss` missing from IPC allowlist; update chrome flicker after actions; "Check now" wiping a downloaded update; unread-dot logic; blocked external links; broken HTML hand-off to the rail browser; `.user` CSS collision with `.message.user`; both CI workflows failing on every push (electron-builder auto-publish, setup-android package list). Security: same-origin sandboxed preview iframe could reach `window.anybot.runCommand`; markdown rendered raw employee HTML. UI: token sweep to OKLCH, live team roster, first-run hire flow, chat bubbles, sidebar status lines. Verified with `npm test` (127), `test:runtime`, doctor, a mocked-bridge Playwright pass, and a real-Electron e2e with an isolated profile. See CHANGELOG 0.2.26.

**Open:**
- HTML previews render but inline scripts stay blocked by the app CSP (inherited by srcdoc/blob frames). Running bot-built games/apps in-app needs a dedicated custom protocol with its own CSP.
- Sidebar bot rows are left-aligned (as shipped since the 0.2.22 CSS fix), not the right alignment requested in 0.2.23.
- The next release (0.2.28+) is the first real in-app update from a post-fix build; confirm it installs and relaunches.
