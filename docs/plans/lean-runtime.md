# Lean runtime: efficient context, incremental sync, standard protocols

Status: M0 in review (0.3.21) · Written 2026-09-24 against 0.3.19 (`9d394af`) · Owner: Tony

This plan turns the 2026-09-24 architecture review into a design and a
sequence of milestones. It replaces "Phase 5: live MCP tools" in the
boards/org roadmap (`~/.claude/plans/i-want-two-large-generic-liskov.md`),
which becomes milestone M4 here. `design.md` stays the architecture of
record; each milestone updates the sections named in its documentation list.

Principles, in the owner's words: the platform should be **performant**,
**compliant with well-known standards**, and **not wasteful** by adding
context to every agent just to support the platform.

---

## 1. Baseline (measured 2026-09-24 on the owner's workspace)

| Measure | Value | Source |
|---|---|---|
| Average prompt Any Bot sends per run | 22,463 chars | `run_inputs`, 17 runs |
| Share of that prompt that is re-sent chat history | 93% (20,818 chars) | same |
| Recent project runs | at the 48,000-char history cap every turn (~12k tokens) | same |
| Platform text per run (rules, action guide, delegation, peers) | ~1.1k chars before files, +1.9k action guide | `prompt()`, `ACTION_GUIDE` |
| Harness's own system prompt, trivial Codex turn | 23,319 input tokens (12,800 cached) | `codex exec --json` |
| One real Codex turn with 8 tool calls | 148,409 input / 1,515 output tokens | Altman's terminal log |
| Full snapshot, 29 messages + 24 runs | ~290 KB | table sizes |
| Snapshot pushes while any bot streams | up to 10/s (100 ms throttle), each a full re-read and full re-render | `worker.mjs`, `App.jsx` |
| Run output written to SQLite while streaming | whole output every 150 ms per run | `execute()` `onText` |
| Stored prompts (`run_inputs`) | kept forever, ~22 KB each | table sizes |

Three findings drive the plan:

1. **History is re-sent every turn.** Every run starts a fresh CLI session, so
   Any Bot pastes up to 48k chars of transcript into each prompt, including
   other bots' long reports and machine blocks. The harness then re-reads it on
   every tool call inside the turn.
2. **The UI syncs by copying the whole workspace.** Cost grows with history,
   and the same reply is stored and sent twice (`runs.output` and the message).
3. **Agents write through a private protocol.** Fenced JSON blocks in prose,
   parsed after the run, plus about 2k chars of instructions in every prompt.
   MCP is the standard for exactly this, and Any Bot already speaks it for
   approvals.

## 2. Design rules (apply to every milestone)

1. **Measure first.** No optimization merges without a before/after number
   from the usage metrics (M0) or a budget test.
2. **Send each fact once.** A bot receives a message, rule, or document at most
   once per session. Everything else is a delta or fetched on demand.
3. **Stable first, volatile last.** Prompt order: instructions and platform
   rules, then history (append-only), then per-turn context, then the
   assignment. This keeps the prefix cacheable by providers.
4. **Only what applies.** No board text without a board, no delegation text in
   a direct chat, no action guide when the harness has the MCP tools.
5. **Standards at the seams.** MCP between agents and the platform; JSON Schema
   for tool inputs; OpenTelemetry GenAI names for usage fields; A2A only where
   Any Bot meets agents outside the workspace. Inside, the coordinator-mediated
   thread stays the bus (ADR-0001).
6. **Deltas, not copies.** State flows as small versioned changes; a full
   snapshot is for startup and resync only.
7. **Everything has a budget test.** Prompt size, snapshot size, and per-tick
   sync size are asserted in CI against fixed fixtures.

## 3. Target architecture

### 3.1 Context pipeline (`runtime/context.mjs`, new)

`Coordinator.prompt()` is ~75 lines of string assembly with implicit caps. It
moves into a pure module: `buildContext({ run, employee, conversation,
history, board, org, knowledge, session, capabilities }) → { text, sections }`.
Each section records its size, so `run_inputs` can store section sizes
(not content) for metrics and tests can assert budgets.

Layers, in order:

| # | Layer | Sent | Budget |
|---|---|---|---|
| 1 | Bot instructions | first turn of a session, or when their hash changes | owner-controlled |
| 2 | Platform rules (workspace, approvals, untrusted-data notice, artifacts) | first turn / hash change | ≤ 900 chars |
| 3 | Team and handoffs (@mentions, peers by name) | projects only; first turn / membership change | ≤ 400 chars |
| 4 | Action guide (fenced blocks) | only when the harness lacks the Any Bot MCP tools **and** the conversation has a board | ≤ 1,200 chars |
| 5 | History | new messages since this bot's last turn in this thread (resumed session), or a trimmed window (fresh session) | ≤ 12,000 chars fresh; delta uncapped but per-message capped |
| 6 | Per-turn context (task card, unread reports, recalled memories, KG facts) | only non-empty parts; pointers instead of bodies when MCP is available | ≤ 3,000 chars |
| 7 | Assignment | always | as written |

History hygiene (both modes):

- **Never clipped:** the assignment, the message that mentioned the bot, and
  every message since the bot's last turn in this thread. Nothing a bot is
  being asked about is shortened. (Review finding 1.)
- **Clipped only when older than that:** other bots' messages over 2,000 chars
  keep their first and last 800 chars with `[… N chars omitted]`. Until the
  `thread_read` tool exists (M4), the marker says to ask the teammate; after
  M4 it names the tool and the message id.
- Machine blocks (`anybot`, `anybot-actions`, `anybot-artifacts`) are stripped
  from history (the coordinator already applied them); code fences over 40
  lines in older messages keep their first 10 lines.
- Coordinator notices collapse to one line each.
- The bot's own earlier messages are never resent in a resumed session.

Handoffs: in projects, the peer list and delegate-block instructions give way
to @mentions (names only, no ids). **The `anybot` delegate block stays**
wherever it is the only path: a manager handing work to direct reports
outside the conversation, including from a direct chat. Its instructions are
sent only to bots that have direct reports. It is deprecated per harness only
once that harness has the `handoff` MCP tool (M4). (Review finding 2.)

Unread team reports are marked read only when their content is actually
delivered: in the prompt, or through a successful `report`/`org` tool read.
A pointer ("2 unread reports") never marks anything read. (Review finding 5.)

**Amended by the M1 design checkpoint** (`docs/reviews/2026-09-24-M1-design.md`):

- **M1 is fresh mode only.** Every run is a new CLI session, so layers 1–4 go
  into every prompt and layer 5 is always the trimmed window. The delta form
  of layer 5 ships with M2's verified resume.
- **Mandatory vs optional history.** Mandatory (never cut, own section
  `thread`): the thread root, the assignment, the message that mentioned the
  bot, and everything after the bot's last turn in this thread. A bot new to
  the thread has no "since", so only the root, assignment, and mention are
  mandatory and the rest is optional. Optional (`history` section, ≤ 12,000
  chars including channel background): older messages newest first, with the
  hygiene rules above; what doesn't fit is dropped with a count.
- **Named authors stay whole.** An older message whose author the assignment
  names (`@Name` or the plain name) is never clipped.
- **The action guide stays everywhere** until M4: every action type is
  accepted in every conversation. Layer 4's condition becomes "the harness
  lacks confirmed Any Bot MCP tools".
- **Delegation has its own condition**: the bot has direct reports (any
  conversation, block with its reports), or it is in a project run that can't
  use @mentions (no thread, e.g. task runs; block with peers, as today).
- **Platform budget** covers the fixed rule text; workspace paths, allowed
  folders, and the file list are appended whole and never cut.
- **Reports** included in full are marked read in the run's success
  transaction; failed or cancelled runs leave them unread.
- **Mentions** need a unique bot name (checked on create and rename) and
  don't count inside code or quoted lines.

### 3.2 Harness sessions (`runtime/sessions.mjs`, new; schema v15)

A bot keeps one CLI session per (bot, conversation, thread). Turn 2 onward
resumes it and sends only layer 5's delta plus layers 6–7.

```
harness_sessions(
  employee, conversation, thread,   -- thread NULL for direct chats
  harness, model, workspace,        -- invalidate when any changes
  session_id, preamble_hash,        -- layers 1–4 hash
  last_message_rowid,               -- newest message the bot has seen
  turns, input_tokens, created, updated, invalid_reason,
  PRIMARY KEY (employee, conversation, thread)
)
```

Capability matrix (flags verified locally 2026-09-24 unless marked):

| Harness | Resume | Session id comes from | Plan |
|---|---|---|---|
| Claude Code | `-p --resume <id>` | chosen up front with `--session-id <uuid>` (fresh turn); `system/init` `session_id` confirms | M2 |
| Codex CLI | `exec resume <id> -` (prompt on stdin) | `thread.started` `thread_id` | M2 |

Live spikes on Tony's PC (2026-09-24, Claude Code 2.1.282, Codex 0.155.0-alpha.16):

- **Claude:** `claude -p --session-id <uuid>` then `claude -p --resume <uuid>` in
  the same cwd keeps the same session id and remembers the first turn (asked
  for a code word from turn 1: correct). An unknown id exits 1 with a `result`
  event `is_error: true`, `errors: ["No conversation found with session ID:
  …"]`, which is the resume-rejected signal.
- **Codex:** `codex exec resume <id> -` keeps the same `thread_id` and
  remembers turn 1. **`exec resume` has no `--sandbox` flag**; the sandbox is
  passed as `-c sandbox_mode="workspace-write"` (verified: the resumed turn
  wrote a file in its workspace). `--json` and `--skip-git-repo-check` work
  on resume. Uncached input on the resumed turn: 11,628 of 71,788 (the rest
  cached).
| Gemini CLI | `--resume latest\|<index>`, `--session-file <json>` | spike: index is per workspace, not per thread | M2 spike; fresh-mode fallback |
| Cursor Agent | `--resume <chatId>` (vendor docs, not installed here) | spike | fallback until verified |
| Hermes, custom CLIs | none | — | fresh mode with trimmed window |

Flow per run:

1. Look up the session. Missing, invalid, or `turns ≥ 40` → fresh session:
   layers 1–7 with the trimmed window.
2. Otherwise resume: layers 5, 6, and 7. Layer 5 is the messages with
   `rowid > last_message_rowid` **that today's eligibility rule admits**:
   up to this run's assignment, plus replies to earlier assignments, never a
   later human assignment that arrived while this run waited, and never the
   bot's own messages. (Review finding 3; `prompt()`'s current query is the
   rule, moved into `context.mjs` and shared by both modes.) If the preamble
   hash changed, prepend "Updated instructions:" with the new layers 1–4.
3. **Commit only on success.** The session id the run reports (harnesses may
   issue a new id on resume) and the newest included rowid are written in the
   same transaction that saves the successful result. A failed, cancelled,
   interrupted, or timed-out turn leaves the row untouched and marks it
   invalid, so the next run starts fresh with full context: the harness may
   have half-absorbed the turn, and replaying a delta into it could duplicate
   or skip messages. (Review finding 4.)
4. If the harness rejects the resume itself (unknown id, corrupt file), mark
   the session invalid, rerun once in fresh mode, and log
   `session.resume_failed` to diagnostics.

Invalidation: harness, model, or workspace change; member removed; bot
archived; project archived; owner action "Start fresh" on the bot (new UI
control); 40 turns (rotation keeps harness-side compaction from ballooning).

A queued turn builds its context when it starts, so it sees everything posted
while it waited (today's behavior, kept).

**Amended by the M2 design checkpoint** (`docs/reviews/2026-09-24-M2-design.md`),
superseding the table and steps above where they differ:

```
harness_sessions(                       -- schema v16
  employee TEXT NOT NULL, conversation TEXT NOT NULL,
  thread TEXT NOT NULL,                 -- '' for direct chats
  harness, session_id, policy_hash,     -- rotate when the policy hash changes
  turns, created, updated,
  PRIMARY KEY (employee, conversation, thread))
harness_session_messages(employee, conversation, thread, message,
  PRIMARY KEY (employee, conversation, thread, message))
```

- **Delivered-message tracking, not a rowid cursor.** A resumed turn's history
  is today's eligible set (thread or conversation, plus channel background,
  all bounded by the assignment) minus the messages this session already got
  and minus the bot's own. What was sent is recorded in the success
  transaction; a failed turn deletes the session instead.
- **Policy hash:** harness, model, workspace, permission mode, instructions,
  name, allowed folders, and members. Any change starts a fresh session (no
  "Updated instructions" in a live session: the old ones would stay in its
  native history). Archive and "Start fresh" delete sessions.
- **Fresh retry only on a verified pre-turn rejection** (`ResumeRejected`):
  Claude's `result` with `is_error`, `num_turns: 0`, "No conversation found
  with session ID"; Codex exit ≠ 0 with no JSON event and "no rollout found"
  on stderr. Any other failure fails the run and drops the session.
- **Resume argv carries every run control:** Claude adds `--resume <id>`
  (fresh turns pass `--session-id <uuid>`) to its usual flags; Codex runs
  `exec resume --json --skip-git-repo-check -c sandbox_mode="workspace-write"
  [-m model] <id> -`.
- **Stable layers stay stable:** the per-run file list moves to a per-turn
  `files` section.
- **Live gate** uses stored normalized usage for both harnesses: uncached =
  `input_tokens − cached_input_tokens`.

### 3.3 Incremental state sync (`runtime/sync.mjs`, new)

Every mutation already goes through the coordinator. It gains a sequence
number and emits typed changes:

```
{ seq, changes: [
  { type: "message.added", message },
  { type: "run.updated", run: { id, status, error, started, ended } },
  { type: "run.output", id, append: "…" },          -- streaming, append-only
  { type: "task.updated", task }, { type: "conversation.updated", conversation },
  { type: "employee.updated", employee }, { type: "approval.updated", approval }, …
]}
```

- Transport: worker → main → renderer as `anybot:delta` pushes (no request
  round trip). Every snapshot, delta, and command reply carries
  `{ epoch, seq }`, where `epoch` is a random id chosen when the worker starts.
  Main keeps the last 500 changes of the current epoch and clears them when the
  worker restarts. The renderer drops anything from an older epoch, and on a
  new epoch or a seq gap it asks for `sync.since {epoch, seq}` or, past the
  ring, a full `snapshot`. (Review finding 8.)
- Commands return `{ epoch, seq }` instead of a snapshot. `act()` resolves only
  after the renderer's store has applied that seq (or resynced), so code after
  `await act(...)` sees its own change.
- **Before** the snapshot shrinks, every consumer of the full lists moves to
  server-side data (review findings 6 and 9):
  - read cursors per conversation live in SQLite (`read_cursors`), replacing
    the renderer's `lastSeenMessages`, so unread state doesn't depend on which
    messages are loaded;
  - thread summaries (root message, reply count, participants, last reply)
    come from the coordinator, so a thread whose root is outside the window
    still opens (`threads.get {root}` loads it);
  - runs carry `assignmentPreview` (first 200 chars of their message) and
    `outputTail` (last 2 KB, active runs only) for Activity and live bubbles;
  - the mobile gateway pages with scoped queries (`messages.page`,
    `runs.list {conversations}`) instead of filtering a full snapshot, keeping
    its response shapes and `before` cursors.
- Then the snapshot becomes a **window**: conversations with those
  summaries, the open conversation's newest 100 messages, other conversations'
  newest 20, and runs from the last 7 days without `output`. Older messages
  load through `messages.page {conversation, before, limit}`.
- Streaming output goes out as `run.output` appends every 250 ms. It is
  checkpointed to SQLite every 5 s (not every 150 ms) and at the end, and the
  terminal log already appends every chunk durably, so a worker crash still
  leaves the partial output on the interrupted run. (Review finding 7.)
  `runs.output` stops duplicating the reply for finished runs.
- The renderer holds a normalized store (`src/lib/store.js`, pure reducer,
  unit-tested). Components select slices, so a streaming append re-renders the
  live bubble, not the app.

### 3.4 Any Bot MCP server (`runtime/anybot-mcp.mjs`; generalizes `approval-mcp.mjs`)

Same transport as approvals today: a stdio MCP server started per run by the
harness, calling the coordinator over loopback HTTP with a per-run token that
is scoped to that run's bot and conversation. Built-ins only, because it runs
unpacked outside `app.asar`. It pins one MCP protocol revision and is
conformance-tested against the official SDK client (dev dependency, tests
only).

Tools (JSON Schema inputs; every write goes through the existing validators in
`board.mjs`, `docs.mjs`, `memory.mjs`, `knowledge.mjs`, `org.mjs`):

| Group | Tools |
|---|---|
| Thread | `thread_read {before?, limit}` for older messages the prompt didn't carry |
| Board | `board_list`, `task_get`, `task_create`, `task_update`, `task_claim` |
| Canvas | `canvas_read {section?}`, `canvas_append`, `canvas_section` |
| Memory | `memory_search`, `memory_save`, `memory_forget` |
| Knowledge | `graph_query`, `graph_fact` |
| Org | `report`, `handoff {to, objective}` (chain-of-command rules unchanged) |
| Approvals | `approve` (unchanged; Claude's permission-prompt tool) |

Wiring: Claude via `--mcp-config` (in place today); Codex via
`-c mcp_servers.anybot.command=…` overrides per run; Gemini and Cursor only if
their CLIs accept a per-run config file or flag **outside the workspace**
(spike in M4). Nothing that carries a token is ever written into a workspace:
a file there can be read by other bots, committed, or left behind after a
crash, and concurrent runs would overwrite each other's. A harness that can't
take a per-run config stays in fenced-block mode. (Review finding 10.)

Knowing a CLI supports MCP isn't the same as the tools being there for this
run (review finding 11):

- The Any Bot MCP server calls back to the coordinator on `initialize` and
  `tools/list`, so each run has a confirmed handshake or not.
- The prompt variant is chosen from the handshake record for that harness and
  version: the lean, pointer-only variant is used only after a previous run
  confirmed the tools; the first run on a new harness version uses full
  context and blocks.
- If a lean run has no handshake within 20 s of starting, or the harness
  reports the `anybot` server failed (for Codex, a pre-turn error item naming
  it counts as fatal in lean mode), the coordinator cancels it and reruns once
  with full context and blocks, and records the harness version as not
  MCP-capable until the app updates.

With the tools confirmed, layer 6 shrinks to pointers ("3 open tasks, canvas
has 4 sections, 2 unread reports: use the anybot tools"), and actions happen
mid-run with immediate validation instead of after the run.

Security: token per run, revoked at run end; tools scoped to the run's
conversation plus the bot's reports; rate limit per run (e.g. 60 writes);
every write recorded in `events` with the run id; tool output is framed as
workspace data, never instructions.

### 3.5 Usage, retention, observability (schema v15 with 3.2)

- `runs` gains `usage` JSON using OpenTelemetry GenAI names:
  `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
  `gen_ai.usage.cached_input_tokens`, `cost_usd`, `turns`, `duration_ms`,
  `gen_ai.request.model`, `gen_ai.system`. Parsed from the result events that
  `formatEvent` already reads.
- `run_inputs` stores section sizes and a hash, and keeps full prompts only for
  the newest 50 runs (debugging), configurable.
- `events` older than 90 days are pruned at startup. Terminal logs keep their
  newest-300 rule.
- Activity shows tokens per run and per-bot daily totals. An optional OTLP
  export is out of scope until someone needs it.

### 3.6 A2A at the edge (optional, M5)

Only if Any Bot needs to work with agents outside the workspace:

- **Server:** publish an Agent Card for the team through the existing gateway
  (TLS, pairing tokens), accept A2A `message/send` and `message/stream`,
  and map an A2A task to a project thread.
- **Client:** a "Remote A2A agent" harness type, so an external agent can be
  hired as a bot.

Internally, bots keep talking through threads (ADR-0001): each bot is a one-shot
CLI process, not a service, and an A2A server per bot would only wrap the same
CLI run.

## 4. Milestones

Every milestone is one or more PRs. Each PR bumps the version and adds a
user-facing CHANGELOG entry, and ships through the normal CI release. A
milestone is done when its exit gate numbers are met on the benchmark corpus
and the adversarial checkpoints are closed (section 7).

### M0 — Measure (0.3.21)

Scope: usage metrics (3.5 fields), prompt section sizes in `run_inputs`,
retention for `run_inputs` and `events`, the benchmark corpus, and the
adversarial review tooling. This PR also carries this plan and ADR-0001.

- Benchmark corpus `tests/fixtures/corpus/`: three synthetic workspaces
  (direct chat, 2-bot project with a 40-message thread and long reports,
  5k-message project), generated by `scripts/make-corpus.mjs` with a fixed
  seed and a fixed message-size distribution (median 400 chars, p95 4 KB,
  max 24 KB, matching the send limit), so every later gate is measured on the
  same data. No real user content.
- `scripts/bench-context.mjs`: prompt sizes per section for every run in the
  corpus. `scripts/bench-sync.mjs`: snapshot bytes and per-tick bytes.
- `scripts/adversarial-review.mjs` (section 7).
- Tests: usage parsing per harness (fixtures from real `result`/`turn.completed`
  events), retention pruning, section-size recording, schema v15 migration from
  a v14 fixture DB.
- Docs: `docs/architecture/metrics.md`; Activity shows tokens per run.
- Exit gate: baseline numbers for all three corpus workspaces committed to
  `docs/architecture/baseline.json`; the review script works for both modes.
- Checkpoints: design review of this plan (done, see section 9); code review of
  the M0 PR, focused on privacy (no message content in metrics or logs).

### M1 — Lean prompts (0.3.22)

Scope: `runtime/context.mjs` (3.1), layer order, conditional sections, history
hygiene, handoff consolidation on @mentions (delegate block deprecated).

- Tests: golden prompt tests per corpus scenario (section presence and order,
  not exact text); budget tests (layer budgets from 3.1 enforced); regression
  tests for everything prompts carry today (untrusted-data framing, approvals
  notice, artifacts contract, mentioned-by line, thread background); existing
  threads/org/board suites unchanged. From the design review:
  - a 6,000-char teammate report that the assignment refers to reaches the bot
    whole;
  - a manager in a direct chat still delegates to a direct report outside the
    conversation with the block;
  - an unread report shown only as a pointer stays unread.
- Docs: `docs/architecture/context-budget.md`; `design.md` §9 (Context) and §8
  (Collaboration) updated; ADR-0002 (prompt layout and budgets).
- Exit gate: median first-turn prompt on the 2-bot corpus down ≥ 60% from the
  baseline (target ≤ 16k chars from ~49k); zero budget-test failures; e2e
  thread collaboration (Electron, fake harness) passes.
- Checkpoints: design review of 3.1 before coding; code review focused on lost
  context (anything a bot needs that no longer reaches it) and prompt-injection
  framing.

### M2 — Session resume (0.3.23, may split into Claude/Codex then spikes)

Scope: `harness_sessions`, resume flow, invalidation, fallback, rotation,
"Start fresh" control; Claude and Codex first; Gemini and Cursor spikes decide
support or fallback.

- Tests: fake-CLI processes per harness that record argv and stdin, asserting
  turn 1 = fresh with layers 1–7, turn 2 = `--resume`/`exec resume` with the
  delta only; resume rejection → one fresh retry + diagnostic; every
  invalidation trigger; queued turn sees messages posted while it waited; two
  threads for one bot keep separate sessions; archived bot or project
  invalidates. From the design review: a later human message that arrives
  while a run waits is not in that run's delta; a failed, cancelled, or
  timed-out turn leaves the cursor unchanged and the next turn runs fresh.
  Live smoke scripts (`tests/live-*-smoke.mjs`, run by hand) for Claude and
  Codex with a two-turn thread.
- Docs: `docs/architecture/sessions.md`; `design.md` §6 (Harness adapter
  contract) and §7 (Execution); ADR-0003 (sessions per bot and thread).
- Exit gate, deterministic (CI, fake CLIs, corpus thread): chars Any Bot sends
  for turns 2–5 are ≤ 15% of fresh mode.
- Exit gate, live (by hand, recorded in the PR): a controlled 5-turn task,
  3 runs each for Claude and Codex, same prompts. Uncached input tokens are
  counted separately from cached ones, from the stored normalized usage for
  both harnesses: `gen_ai.usage.input_tokens − gen_ai.usage.cached_input_tokens`. The median uncached input for turns
  2–5 is ≥ 50% below fresh mode, and the bot answers questions about earlier
  turns correctly. Tool calls inside a turn aren't controlled, which is why
  this gate is a median over a fixed task and not a CI assertion.
- Checkpoints: design review of 3.2 (session hijack, stale history,
  divergence when another bot edits the same files); code review focused on
  the fallback paths.

### M3 — Incremental sync (0.3.24)

Scope: 3.3 end to end, in this order so nothing breaks midway:
(1) server-side read cursors, thread summaries, run previews, and the mobile
gateway on scoped queries, with the renderer moved onto them while the full
snapshot still exists; (2) epochs, sequence numbers, and deltas; (3) the
windowed snapshot, paged messages, 5 s output checkpoints, and the renderer
store.

- Tests: reducer unit tests (every change type, gap → resync, old epoch
  dropped); coordinator emits a delta for every mutation (table-driven over
  all commands); budget tests on the 5k-message corpus; Electron e2e with 8
  bots streaming at once (no dropped output, final text equals the run's
  reply); mobile gateway tests unchanged in shape. From the design review:
  - a worker restart mid-stream → the renderer resyncs, and no delta from the
    old worker is applied;
  - a worker crash mid-run → the interrupted run keeps its partial output;
  - a thread whose root is outside the window opens, and unread state is
    right after a restart;
  - mobile `before` cursors page past the desktop window;
  - code after `await act()` sees its own change.
- Docs: `docs/architecture/state-sync.md`; `design.md` §15 (API and event
  contracts); ADR-0004 (deltas over snapshots).
- Exit gate (all on the M0 corpus): windowed snapshot ≤ 64 KB on the
  5k-message workspace; streaming appends are chunked at 2 KB, so every tick
  is ≤ 2 KB plus a fixed header, and a 24 KB reply arrives as several ticks;
  the renderer does not re-render the sidebar or channel list per tick (React
  Profiler assertion in e2e); SQLite writes during streaming are at most one
  output checkpoint per run every 5 s.
- Checkpoints: design review (ordering, lost deltas, reconnect, mobile);
  code review focused on races between command replies and deltas.

### M4 — Any Bot MCP server (0.4.0)

Scope: 3.4: server, tools, per-harness wiring, layer 4/6 shrink when tools are
present, fenced blocks kept for harnesses without MCP.

- Tests: protocol conformance with the official SDK client (initialize,
  tools/list, tools/call, errors); one test per tool for allowed and refused
  calls (same permission matrix as `actions.test.mjs`); token scope (a token
  can't touch another conversation; expired token refused); rate limit; Claude
  and Codex fake-CLI wiring tests; live smoke with Claude Code creating and
  moving a task mid-run. From the design review:
  - a lean run with no handshake is cancelled and rerun once with full
    context;
  - a Codex pre-turn error naming the `anybot` server is fatal in lean mode;
  - after every run, the workspace contains no file with a token.
- Docs: `docs/architecture/mcp.md` (tool reference generated from the
  schemas); `design.md` §10 (Security) and §9; ADR-0005 (MCP as the agent
  interface, blocks as fallback).
- Exit gate: board/canvas/memory/graph/report actions work mid-run in Claude and
  Codex; per-turn context (layer 6) ≤ 400 chars when tools are present; no
  action-guide text sent to MCP-capable harnesses.
- Checkpoints: security-focused design review (token handling, confused
  deputy, tool output as injection vector); code review; a second, independent
  Codex review of the permission checks alone.

### M5 — A2A at the edge (0.5.x, only on request)

Scope: 3.6 after a spike. Starts with an ADR and a threat model; no code
before the design checkpoint passes.

## 5. Test strategy

| Layer | What | Where |
|---|---|---|
| Unit | context builder, reducer, usage parsers, session lookup, tool validators | `tests/*.test.mjs` (node:test) |
| Process | fake CLIs per harness recording argv/stdin/events | `tests/fixtures/fake-cli/` |
| Integration | coordinator with injected runner over corpus workspaces | existing pattern |
| Budget | prompt sections, snapshot bytes, tick bytes against the corpus | `tests/budgets.test.mjs` |
| Migration | open a v14 fixture DB, upgrade, verify data | `tests/migrations.test.mjs` |
| Protocol | MCP conformance with the SDK client | `tests/mcp.test.mjs` |
| E2E | real Electron, isolated profile, fake harnesses | `scripts/e2e/*.cjs` → promote to `npm run test:e2e` |
| Live smoke | real Claude/Codex, by hand before merge of M2/M4 | `tests/live-*-smoke.mjs` |

CI runs everything except live smoke. Budgets are numbers in one file
(`tests/budgets.json`) so a change to a budget is a reviewed diff.

## 6. Documentation plan

| Doc | Created/updated in |
|---|---|
| `docs/plans/lean-runtime.md` (this plan; status per milestone) | M0, then each milestone |
| `docs/adr/0001-coordinator-mediated-messaging.md` (why not A2A inside) | M0 |
| `docs/adr/0002-prompt-layout.md`, `0003-harness-sessions.md`, `0004-state-deltas.md`, `0005-mcp-agent-interface.md` | M1–M4 |
| `docs/architecture/metrics.md`, `baseline.json` | M0 |
| `docs/architecture/context-budget.md` | M1 |
| `docs/architecture/sessions.md` | M2 |
| `docs/architecture/state-sync.md` | M3 |
| `docs/architecture/mcp.md` (generated tool reference) | M4 |
| `design.md` §6, §7, §8, §9, §10, §15 | as listed per milestone |
| `CLAUDE.md` "Last turn / Pending" | every PR |
| `CHANGELOG.md` (user-facing; becomes the update notes) | every PR |
| `docs/reviews/` (checkpoint reports and triage) | every checkpoint |

## 7. Adversarial review protocol (Codex CLI)

The implementer (Claude) does not approve its own work. Each milestone has
two checkpoints run with Codex CLI, a different model family, in a read-only
sandbox:

**Design checkpoint** (before code):

```
node scripts/adversarial-review.mjs design --milestone M2 --section "3.2"
# runs: codex exec --sandbox read-only --skip-git-repo-check -
#   stdin: docs/reviews/prompts/design.md + the plan section + named source files
```

**Code checkpoint** (before merge, after CI is green):

```
node scripts/adversarial-review.mjs code --milestone M2
# runs: codex exec --sandbox read-only --skip-git-repo-check -
#   stdin: docs/reviews/prompts/code.md + "review git diff <base>...HEAD"
#   + the milestone's risk list
#   (`codex review --base` refuses a custom prompt: "the argument '--base
#   <BRANCH>' cannot be used with '[PROMPT]'", found when M0's exit gate ran
#   it for real. Pass `--base origin/main` when local main is behind.)
```

The script writes `docs/reviews/<date>-<milestone>-<design|code>.md` with the
commit, Codex version, prompt, and raw findings, followed by a triage table:

| # | Finding | Severity | Verdict | Evidence |
|---|---|---|---|---|
| 1 | … | high | fixed in `abc123` / rejected (reason) / deferred (task) | test or reasoning |

Rules:

- Prompts ask for concrete failure scenarios with inputs and expected wrong
  behavior, not style notes.
- Every finding gets a verdict. **High or critical findings must be fixed, or
  rejected with evidence** (a test that disproves it, or a quoted spec) before
  merge.
- A rejected high finding goes back to Codex once with the evidence; if Codex
  still holds it, the owner decides.
- The PR body links the report and lists open findings.
- CI doesn't run Codex (it needs the owner's login); the PR checklist does.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Harness session semantics change between CLI versions | Capability probe at startup (flag present in `--help`); fake-CLI tests pin the contract; automatic fresh-mode fallback |
| Resumed sessions drift from the thread (a bot misses or double-reads a message) | Delta by rowid with today's eligibility rule; cursor committed only with a successful result; any failed turn resets to fresh; "Start fresh" control |
| A resumed session carries stale instructions | Preamble hash; changed layers resent as "Updated instructions" |
| Deltas lost, reordered, or from a dead worker | Epoch + sequence numbers, gap or new epoch → resync, ring cleared on restart |
| MCP token misuse | Per-run scope and expiry, loopback only, never written into a workspace, rate limit, audit events |
| A harness says it supports MCP but the tools aren't there | Per-run handshake; lean prompt only after a confirmed handshake; rerun with full context otherwise |
| Clipping history hides something a bot needs | Never clip what the bot is asked about or anything new to it; head+tail for older long messages; `thread_read` (M4); golden tests |
| Gemini/Cursor can't resume per thread | Fresh mode stays correct, just less lean |
| Budgets too tight for real work | Budgets live in one reviewed file; M0 baseline sets them from data |

Open questions for the owner:

1. Keep full prompts for the newest 50 runs (debugging) or store sizes only?
2. Should "Start fresh" be per bot, per thread, or both?
3. Is A2A (M5) wanted at all, and for which outside agents?

## 9. Review log

| Checkpoint | Result | Report |
|---|---|---|
| M0 code review (2026-09-24) | 4 findings (2 high, 2 medium): retention failure stopped runs, code-mode command rejected by Codex, events pruned only at startup, fixtures not captured. All fixed; Gemini and Cursor captures deferred (both CLIs unusable on the owner's PC). | `docs/reviews/2026-09-24-M0-code.md` |
| M1 design review of §3.1 (2026-09-24) | 8 findings (1 critical, 4 high, 3 medium), all accepted; see the amendment at the end of §3.1. | `docs/reviews/2026-09-24-M1-design.md` |
| 0: design review of this plan (Codex CLI, read-only, 2026-09-24) | 13 findings (11 high, 2 medium). 12 accepted and folded in above: clipping, delegation, delta eligibility, cursor commits, report read-marking, snapshot consumers, durable partial output, epochs, mobile paging, token files, MCP handshake, measurable gates. 1 rejected with evidence (the `codex review -` stdin form is documented in `--help`); **that rejection was wrong**: run for real in M0, `codex review --base` refuses a custom prompt, so the script now uses `codex exec` with the diff range. | `docs/reviews/2026-09-24-plan-design.md` |
