# ADR-0002: Prompt layout and budgets

Status: accepted · 2026-09-24 · Milestone M1 (0.3.22)

## Context

Up to 0.3.21 `Coordinator.prompt()` concatenated its parts in the order they
were added: platform text, board, action guide, memories, then up to 48,000
chars of transcript cut from the front (often mid-message), then the
assignment. On the M0 corpus the 2-bot project's median prompt was 46,264
chars, 78% of it re-sent history, and a bot's own assignment appeared twice
(in the transcript and at the end). Unread team reports were marked read while
the prompt was being built, so a run that then failed lost them.

The Codex design checkpoint on §3.1 (`docs/reviews/2026-09-24-M1-design.md`)
found one critical and four high problems in the first draft: reports marked
read before success, delta prompts without a resumable session, an action
guide gated on "has a board" although every action is accepted everywhere, a
clipping rule that could shorten the very report a bot is asked about, and
@mentions that were ambiguous between same-named bots.

## Decision

- A pure builder, `runtime/context.mjs`, owns the layout. Layers go stable
  first (instructions, platform rules, team, delegation, artifacts, action
  guide), then history, then per-turn context (board, org, knowledge), then
  the assignment. Every layer is a named section with a recorded size.
- History is split into **mandatory** (root, assignment, mention, everything
  after the bot's last turn; never cut) and **optional** (older; ≤ 12,000
  chars including channel background, newest first, with hygiene rules).
- Budgets are numbers in `BUDGETS`, mirrored in `tests/budgets.json`.
- Building a prompt has no side effects. Reports it carries whole are marked
  read when the run succeeds.
- Bot names are unique among active bots, and mentions inside code or quotes
  don't count, so an @mention addresses exactly one bot.
- M1 stays in fresh mode (every layer every run). Deltas wait for M2's session
  resume; the action guide stays until M4's MCP tools.

Details: `docs/architecture/context-budget.md`.

## Consequences

- The 2-bot corpus's median prompt drops 68% (46,264 → 14,896 chars); CI
  asserts the ≥ 60% gate against `baseline.json`.
- Older long teammate messages the assignment doesn't name lose their middle
  until M2/M4. The clip note says how to get it.
- Creating or renaming a bot to an existing bot's name is refused.
- Project runs in a thread no longer get the peer list with ids; they hand off
  by @mention. The `anybot` delegate block stays for direct reports (from any
  conversation) and for project runs outside a thread.
