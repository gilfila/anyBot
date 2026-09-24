# Harness sessions

**Status: built and tested, off by default** (the live gate found no token
saving; see Measured). With it on, a bot keeps one native CLI session per
(bot, conversation, thread) and resumes it on later turns, so the harness already holds the instructions and the
conversation, and Any Bot sends only what's new. Added in 0.3.23 (lean-runtime
M2, `docs/plans/lean-runtime.md` §3.2 as amended by its design checkpoint,
ADR-0003). Code: `runtime/sessions.mjs`, `Coordinator.execute()`,
`invocation()`/`runHarness()` in `runtime/adapters.mjs`, and the resumed mode
of `runtime/context.mjs`.

## Which harnesses resume

| Harness | Resume | On by default | Why |
|---|---|---|---|
| Claude Code | fresh: `--session-id <uuid>`; later: `--resume <uuid>` | no | Resumes correctly, but every Claude Code process writes ~31k tokens of its own context to the provider cache either way: resumed and fresh turns both cost ~47.6k uncached (3 runs) |
| Codex CLI | `exec resume --json --skip-git-repo-check -c sandbox_mode=workspace-write <thread id> -` | no | Resumes correctly, but a resumed turn sent ~17,800 uncached tokens against ~2,400 fresh: fresh Codex runs share a prefix the provider caches, resumed ones mostly don't |
| Gemini, Cursor, Hermes, custom | — | no | Not verified (Gemini and Cursor CLIs don't run on the owner's PC); fresh mode |

`RESUMABLE` in `runtime/sessions.mjs` is the default set (empty); the
`Coordinator` option `resumable` turns harnesses on (tests and the live smoke
use it). `probeSessionSupport()` also checks the installed CLI's help for the
flags, so an older CLI stays fresh instead of failing on an unknown flag.

## A turn

1. **Lookup.** `Sessions.lookup(key, {harness, policy})` returns the session,
   or drops it and returns nothing when the harness or the **policy hash**
   changed, or after 40 turns.
2. **Prompt.** Fresh: every layer (`docs/architecture/context-budget.md`).
   Resumed: no stable layers; history is only what's new: today's eligible
   messages and channel background, minus what the session was already sent,
   minus the bot's own replies, whole and in order. Per-turn layers (files,
   board, org, knowledge) and the assignment are always sent.
3. **Run.** Claude gets the id Any Bot chose (fresh) or the saved one
   (resumed); Codex reports its own thread id. `onSession` records the id the
   harness actually reported.
4. **Success** (in the run's completion transaction): save the session with
   that id and the policy captured before the run, and record every message
   id the turn could see as delivered (older ones a fresh turn left out
   count too: they are not "new" later).
5. **Failure** of any kind (error, cancel, timeout): drop the session. The
   harness may have half-absorbed the turn, so the next turn starts fresh.
6. **Refused resume** (`ResumeRejected`, recognized only before the turn
   starts): drop the session, log `session.resume_failed`, and rerun once,
   fresh, in the same run.
   - Claude: `result` with `is_error`, `num_turns: 0`, "No conversation found
     with session ID", before any assistant text.
   - Codex: exit ≠ 0, no JSON event at all, "no rollout found" or
     "thread/resume failed" on stderr.

## Policy hash

SHA-256 of: harness, model, workspace, permission mode, instructions, name,
allowed folders, members, and direct reports. Any change starts a fresh
session. Nothing is patched into a live session ("Updated instructions")
because the old instructions would stay in its native history. It is saved as
captured **before** the run, so an edit made during a run still takes effect.

## Ending sessions

- Archiving a bot or a project drops its sessions.
- `sessions.startFresh` (`{employee}` or `{conversation, thread}`), in the IPC
  allowlist. The "Start fresh" controls (bot "…" menu, thread header) are built
  on this branch's history but left out while resume is off.
- 40 turns, then a fresh session (keeps harness-side compaction in check).

## Storage (schema 16)

```
harness_sessions(employee, conversation, thread NOT NULL ('' = direct chat),
  harness, session_id, policy_hash, turns, created, updated)
harness_session_messages(employee, conversation, thread, message)
```

The CLI's own session files live where the CLI keeps them (per workspace for
Claude); Any Bot stores only ids.

## Measured

- Deterministic gate (CI, `tests/sessions.test.mjs`): chars sent for turns 2–5
  ≤ 15% of fresh mode on a 24-message conversation.
- Live gate (by hand, `node tests/live-sessions-smoke.mjs claude|codex
  [--runs 3]`): a controlled 5-turn recall task, resumed vs fresh; the bot must
  answer questions about earlier turns correctly, and the median uncached
  input for turns 2–5 must be ≥ 50% lower. Both harnesses remember every
  earlier turn correctly when resumed; neither meets the token gate.
  - Claude Code 2.1.282, 3 runs: resumed 47,750 vs fresh 47,622 (0%). One
    earlier single run showed ~105 vs ~47,400, a warm provider cache that
    didn't repeat. A raw fresh run: 2 input, 30,079 cache read, ~31–32k cache
    write per process.
  - Codex 0.155.0-alpha.16: resumed 17,788 vs fresh 2,365 (worse).
  - What would change this: a harness whose per-process context is cached
    across runs, or real work with long histories (not yet measured).
