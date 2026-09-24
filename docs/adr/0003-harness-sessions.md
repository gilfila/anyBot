# ADR-0003: Native harness sessions per bot and thread

Status: accepted, **resume off by default** (live gate not met) · 2026-09-24 · Milestone M2

## Context

Through 0.3.22 every run started a new CLI process with a new session, so Any
Bot re-sent the bot's instructions, the platform rules, and a window of the
conversation on every turn (≈ 15k chars on the 2-bot corpus after M1). Claude
Code and Codex can both continue a session from the command line
(`--resume`, `exec resume`), verified live on 2026-09-24.

The Codex design checkpoint (`docs/reviews/2026-09-24-M2-design.md`) found
three critical problems in the first draft: a schema number already in use, a
nullable key that would give direct chats several session rows, and the plan to
patch changed instructions into a live session (the old ones would stay in its
history). It also found a rowid cursor could skip messages delivered out of
order, and that a blanket "retry fresh on resume errors" could repeat work.

## Decision

- One native session per (bot, conversation, thread), stored in schema 16 with
  a non-null thread key.
- Resumed turns get no stable layers and only messages the session hasn't
  seen, tracked **by message id**.
- A **policy hash** (instructions, permissions, folders, members, reports,
  harness, model, workspace, name) guards every resume; any change means a
  fresh session.
- Sessions are saved only in a successful run's transaction, with the id the
  harness reported; any failure drops the session. A fresh retry happens only
  on a resume the harness refused before starting its turn.
- **Resume is off for every harness.** The live gate measured the token
  effect: Claude Code writes ~31k tokens of its own per-process context to the
  provider cache whether it resumes or not (resumed and fresh turns ~47.6k
  uncached each over 3 runs), and a resumed Codex turn cost ~7× a fresh one.
  The path stays implemented and tested behind the `resumable` option.

Details: `docs/architecture/sessions.md`.

## Consequences

- Nothing changes for bots by default. Turning resume on is one option once
  a harness's measurements justify it; "Start fresh" controls come with it
  (the `sessions.startFresh` command already exists).
- With resume on, a bot keeps full memory of the thread, including older
  messages fresh mode trims; if the CLI's session files are cleared, the next
  turn is refused, logged, and rerun fresh.
- Schema 16's session tables ship only with this PR, so it waits (the owner's
  call) rather than locking downgrades for a feature that is off.
