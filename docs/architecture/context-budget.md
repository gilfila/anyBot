# Context budget

What Any Bot puts in a bot's prompt, in which order, and how big each part may
get. Added in 0.3.22 (lean-runtime M1, `docs/plans/lean-runtime.md` §3.1,
ADR-0002). The builder is `runtime/context.mjs` (`buildContext`), a pure
function; `Coordinator.promptParts()` gathers the rows and calls it.

Every run is still a fresh CLI session (harness session resume is M2), so all
layers are sent on every run.

## Layers, in order

Stable layers first so providers can cache the prompt prefix; the assignment
last. Section names are what `run_inputs.sections` records (sizes only).

| # | Section | Contents | Sent when | Budget |
|---|---|---|---|---|
| 1 | `instructions` | The bot's own instructions | always | owner-controlled |
| 2 | `platform` | Name, workspace, allowed folders, credentials, approvals, untrusted-data notice | always | ≤ 900 chars of fixed text; paths appended whole |
| 3 | `team` | Teammates by name and the @mention rule | project runs in a thread | ≤ 400 chars of fixed text |
|   | `delegation` | The `anybot` delegate block, with direct reports or peers | the bot has direct reports, or a project run outside a thread (task runs) | — |
|   | `artifacts` | The `anybot-artifacts` contract and supplied files | always | — |
| 4 | `actionGuide` | The `anybot-actions` guide | always, until M4's MCP tools are confirmed per harness | ≤ 2,000 |
| 5 | `background` | "Conversation:" header and, for thread runs, recent channel messages each with its latest reply | when there is any history | ≤ 3,000 (part of the 12,000) |
|   | `root` | "The thread you are replying in:" and the thread's first message | thread runs | mandatory |
|   | `history` | Older messages, newest first, with hygiene; "[N earlier messages not shown]" | when there are older messages | ≤ 12,000 with `background` |
|   | `thread` | Everything after the bot's last turn | when there is any | mandatory, never cut |
| 6 | `board` | Task card, canvas excerpt (≤ 3,000), open tasks | when the conversation has them | per-item caps |
|   | `org` | Chain of command, unread reports, recalled memories | always (chain line) | reports ≤ 4,000 |
|   | `knowledge` | Knowledge-graph facts | when any match | recall's own budget |
| 7 | `assignment` | Who mentioned the bot, the assignment, the closing instruction | always | as written |

Budgets are numbers in `runtime/context.mjs` (`BUDGETS`), mirrored in
`tests/budgets.json`; `tests/context.test.mjs` fails if they disagree, so a
budget change is a reviewed diff of both.

## History rules

**Mandatory, never cut:** the thread root, the assignment, the message that
mentioned the bot, and every message after the bot's last turn in this thread
(or direct chat). A bot new to a thread has no "last turn", so only the root,
assignment, and mention are mandatory for it.

**Optional (older) messages**, newest first until the budget is used:

- The owner's messages are never shortened.
- The bot's own earlier messages are never shortened.
- Another bot's message over 2,000 chars keeps its first and last 800 chars
  and a note: `[… N chars omitted from this older message; ask Name if you
  need them]`. **Exception:** when the assignment names that bot (`@Sam` or
  "Sam's analysis"), its messages stay whole and are picked first, in their
  own allowance of 24,000 chars on top of the budget (the newest one always
  fits), so newer long messages can't push them out.
- Code fences over 40 lines keep their first 10.
- `anybot`, `anybot-actions`, and `anybot-artifacts` blocks are removed from
  bot replies (the coordinator already applied them). The owner's messages keep
  them, so a bot can be asked about an example.
- Coordinator notices collapse to their first line.

**The assignment appears once**: in layer 7, in full. In the transcript it is
a one-line marker only when later messages need its position, and omitted
when it is the newest message.

## Reports

Unread team reports are included whole while they fit in 4,000 chars; the rest
get a pointer ("2 more unread reports; they will come in your next run"). The
ones included are marked read in the run's success transaction, so a failed or
cancelled run leaves them unread for the next one.

## Measured (M0 corpus, `node scripts/bench-context.mjs`)

| Workspace | Baseline median (0.3.21) | M1 median | Change |
|---|---|---|---|
| direct | 20,120 | 14,272 | −29% |
| project2 | 46,264 | 14,896 | **−68%** (gate: ≥ 60%) |
| project5k | 24,075 | 13,406 | −44% |

The project2 gate is asserted in CI against `docs/architecture/baseline.json`
(`tests/context.test.mjs`). The action guide (1,942 chars) is now the largest
fixed layer; it goes away per harness in M4.

## Known limits (until M2 and M4)

- An older long message from a teammate the assignment doesn't name keeps
  only its head and tail. M2 (the harness session keeps the full thread) and
  M4 (`thread_read`) remove this.
- The action guide is sent to every run, board or not, because every action
  type is accepted in every conversation.
