# Lean runtime: task list

Working list for `docs/plans/lean-runtime.md`. Check items off in the same PR
that does them. Section numbers (§) point into the plan.

## Working agreements

- One branch and PR per milestone step (`claude/lean-m0-…`), based on `main`.
  Each PR bumps `package.json` + both root entries of `package-lock.json`,
  adds a user-facing `CHANGELOG.md` entry (it becomes the in-app update notes),
  and updates `CLAUDE.md` "Last turn / Pending". `scripts/check-release-version.mjs`
  enforces the first two.
- CI releases on merge to `main`. Never build or upload a release by hand.
- **Ask Tony before merging** each PR (he has approved every merge so far, one
  at a time). Open the PR, get CI green, run the code checkpoint, then ask.
- **Codex checkpoints need the Codex CLI signed in to Tony's account.** If this
  environment has no `codex` on PATH, write the checkpoint as pending in the PR
  body with the exact command (`node scripts/adversarial-review.mjs design|code
  --milestone Mn …`) for Tony's PC, and don't merge until its report is in
  `docs/reviews/` with every high finding fixed or rejected with evidence.
- **Live smoke tests** (real Claude Code / Codex runs) happen on Tony's PC; list
  them in the PR body as pending with the command.
- Tests: `npm test`, `npm run test:runtime`, `npm run build`,
  `npm run mobile:web`, `node scripts/check-release-version.mjs`.
  `tests/phone-link.test.mjs` "survives restarts" is a known flake (a separate
  session is fixing it); rerun it alone before calling a failure real.
- Colors are OKLCH tokens only (no hex in desktop CSS). Employee output is
  untrusted. Renderer-callable coordinator methods go in the `methods`
  allowlist in `desktop/main.cjs` (`tests/desktop-ipc.test.mjs` checks it).
- Assumed answers to the plan's open questions until Tony says otherwise:
  keep full prompts for the newest 50 runs; "Start fresh" exists both per bot
  (bot menu, resets all its sessions) and per thread (thread header); M5 (A2A)
  is not started.

## M0: Measure (0.3.21)

- [x] Plan, ADR-0001, review prompts, `scripts/adversarial-review.mjs`,
      checkpoint 0 report (branch `claude/lean-runtime-plan`, rides in this PR)
- [x] Schema v15: `runs.usage` JSON (OTel GenAI names, §3.5); `run_inputs`
      gains `sections` (sizes per layer), `hash`, and `chars`; migration test
      from a v14 fixture DB (`tests/fixtures/schema-v14.sql`)
- [x] Usage parsing from harness result events (Claude `result`, Codex
      `turn.completed`, Gemini `result`, Cursor `result`), stored at run end;
      unit tests with event fixtures (Claude captured for real; Codex, Gemini,
      Cursor from their documented shapes: replace with captures from Tony's PC)
- [x] Record prompt section sizes (wrap today's `prompt()` pieces; no content
      in metrics)
- [x] Retention: keep full `run_inputs.prompt` for the newest 50 runs (sizes
      and hash kept for all); prune `events` older than 90 days at startup;
      tests
- [x] Activity: tokens per run (in / cached / out) and per-bot daily totals
- [x] `scripts/make-corpus.mjs` (fixed seed, size distribution in M0 of the
      plan) → `tests/fixtures/corpus/` (direct chat, 2-bot thread, 5k-message
      project)
- [x] `scripts/bench-context.mjs` and `scripts/bench-sync.mjs`; record
      `docs/architecture/baseline.json` (`scripts/record-baseline.mjs`)
- [x] `docs/architecture/metrics.md`
- [ ] Code checkpoint (focus: no message content in metrics or logs);
      run `adversarial-review.mjs code` once for real (M0 exit gate)
- [ ] PR, CI green, ask Tony, merge

## M1: Lean prompts (0.3.22)

- [ ] Design checkpoint on §3.1 before coding
- [ ] `runtime/context.mjs`: pure `buildContext()` with layers 1–7 and budgets
      from `tests/budgets.json`; `Coordinator.prompt()` delegates to it
- [ ] Layer order: stable → history → per-turn → assignment
- [ ] Conditional sections: action guide only with a board and no MCP tools;
      delegation text only to bots with direct reports; peers by name in
      projects
- [ ] History hygiene per §3.1 (never clip what the bot is asked about or new
      to it; head+tail for older long messages; strip machine blocks; collapse
      notices)
- [ ] Reports marked read only when delivered (§3.1)
- [ ] Tests: golden section order per corpus scenario; budget tests; the three
      review-derived tests listed under M1 in the plan; existing suites green
- [ ] Measure against `baseline.json`; gate: first-turn prompt on the 2-bot
      corpus down ≥ 60%
- [ ] Docs: `docs/architecture/context-budget.md`, ADR-0002, `design.md` §8–9
- [ ] Code checkpoint (focus: lost context, prompt-injection framing)
- [ ] PR, CI green, ask Tony, merge

## M2: Harness sessions (0.3.23; split Claude/Codex from the spikes if large)

- [ ] Design checkpoint on §3.2
- [ ] Schema: `harness_sessions` (§3.2)
- [ ] `runtime/sessions.mjs`: lookup, capability probe from `--help`, resume
      args per harness (Claude `-p --resume <id>`, Codex `exec resume <id> -`)
- [ ] Delta = today's eligibility rule after the cursor; commit cursor and
      session id only with a successful result; failures invalidate
- [ ] Invalidation triggers (harness/model/workspace change, member removed,
      archive, 40 turns, "Start fresh"); resume-rejected → one fresh retry +
      `session.resume_failed` diagnostic (add to `describeIssue`)
- [ ] "Start fresh" in the bot menu and the thread header
- [ ] Spikes: Gemini (`--resume` index vs `--session-file`), Cursor
      (`--resume <chatId>`); write findings into the plan's matrix
- [ ] Tests: fake CLIs per harness recording argv/stdin; all cases listed
      under M2 in the plan
- [ ] Live smoke scripts for Claude and Codex (pending on Tony's PC); record
      the live gate numbers in the PR
- [ ] Docs: `docs/architecture/sessions.md`, ADR-0003, `design.md` §6–7
- [ ] Code checkpoint (focus: fallback paths)
- [ ] PR(s), CI green, ask Tony, merge

## M3: Incremental sync (0.3.24; three PRs in the plan's order)

- [ ] Design checkpoint on §3.3
- [ ] Step 1: `read_cursors` table + unread from the server; thread summaries
      and `threads.get`; run `assignmentPreview`/`outputTail`; mobile gateway on
      `messages.page` / `runs.list`; renderer moved onto these while the full
      snapshot still exists
- [ ] Step 2: worker epoch + seq on snapshot/delta/reply; delta emission for
      every mutation; main ring buffer (cleared on restart); `sync.since`;
      renderer store (`src/lib/store.js`) and `act()` waiting for its seq
- [ ] Step 3: windowed snapshot; `messages.page`; streaming appends chunked at
      2 KB every 250 ms; output checkpoint every 5 s; `runs.output` not
      duplicated for finished runs
- [ ] Tests: reducer, table-driven delta coverage, budgets, 8-bot streaming
      e2e, and the review-derived cases listed under M3
- [ ] Docs: `docs/architecture/state-sync.md`, ADR-0004, `design.md` §15
- [ ] Code checkpoint per PR (focus: reply/delta races, restarts)
- [ ] PRs, CI green, ask Tony, merge

## M4: Any Bot MCP server (0.4.0)

- [ ] Security-focused design checkpoint on §3.4 (tokens, confused deputy,
      tool output as injection)
- [ ] `runtime/anybot-mcp.mjs` (built-ins only, unpacked from asar; pinned MCP
      revision) generalizing `approval-mcp.mjs`; loopback routes in the
      coordinator with per-run scoped tokens and a write rate limit
- [ ] Tools per §3.4 with JSON Schema inputs, reusing existing validators
- [ ] Handshake callback on `initialize`/`tools/list`; lean prompt only after
      a confirmed handshake per harness version; rerun with full context when
      missing; Codex pre-turn error naming `anybot` is fatal in lean mode
- [ ] Wiring: Claude `--mcp-config`; Codex `-c mcp_servers.anybot…`; Gemini and
      Cursor only with a per-run config outside the workspace (spike)
- [ ] Layer 4/6 shrink when tools are confirmed; delegate block deprecated per
      harness once `handoff` works there
- [ ] Tests: SDK-client conformance (dev dependency), per-tool allow/refuse,
      token scope and expiry, rate limit, wiring, the review-derived cases
      listed under M4
- [ ] Live smoke: Claude creates and moves a task mid-run (Tony's PC)
- [ ] Docs: `docs/architecture/mcp.md` (generated tool reference), ADR-0005,
      `design.md` §9–10
- [ ] Code checkpoint, plus a second independent Codex review of the
      permission checks
- [ ] PR, CI green, ask Tony, merge

## M5: A2A at the edge

- [ ] Not started. Only on Tony's request: ADR + threat model + design
      checkpoint before any code.
