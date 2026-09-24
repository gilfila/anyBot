# Metrics: usage, prompt sizes, retention

Added in 0.3.20 (lean-runtime M0, `docs/plans/lean-runtime.md` §3.5). These
numbers are how every later milestone proves it made Any Bot leaner.

**Privacy rule:** metrics hold numbers, hashes, and model ids. They never
hold message text, prompt text, or reply text. The one place prompt text is
kept is `run_inputs.prompt`, for debugging the newest runs, and it is pruned
(below).

## Token usage per run (`runs.usage`)

`runtime/usage.mjs` reads the harness's own result events while the run
streams (`runHarness` → `onUsage`) and the coordinator stores them as JSON in
`runs.usage` when the run ends, whether it succeeded, failed, or was
cancelled. Keys follow the OpenTelemetry GenAI semantic conventions:

| Key | Meaning |
|---|---|
| `gen_ai.usage.input_tokens` | All input tokens, **including cached ones** |
| `gen_ai.usage.cached_input_tokens` | Input tokens served from the provider's prompt cache |
| `gen_ai.usage.output_tokens` | Output tokens |
| `gen_ai.request.model` | The bot's configured model, else the model the harness reported |
| `gen_ai.system` | `anthropic`, `openai`, `gcp.gemini`, `cursor`, or `custom` |
| `cost_usd` | Only when the harness reports it (Claude Code) |
| `turns` | Model turns in the run (Claude `num_turns`; one per Codex/Gemini turn) |
| `duration_ms` | Harness-reported duration, else wall time of the process |

Uncached input is always `input_tokens − cached_input_tokens`.

| Harness | Event read | Mapping |
|---|---|---|
| Claude Code | `result` | input = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; cached = `cache_read_input_tokens` |
| Codex CLI | `turn.completed` | input = `input_tokens` (already includes cached); cached = `cached_input_tokens` |
| Gemini CLI | `result.stats` | input = `input_tokens`; cached = `cached` |
| Cursor Agent | `result` | token counts when present (`usage.inputTokens`…); otherwise duration only |
| Hermes, custom CLIs | none | `usage` stays null |

Fixtures: `tests/fixtures/usage/` (the Claude one is a real capture; see its
README). Tests: `tests/usage.test.mjs`.

Activity shows each run's tokens ("148k in · 12.8k cached · 1.5k out · $0.04")
and a **Tokens today** panel with per-bot totals for runs that ended today
(`src/lib/usage.js`, `src/components/UsageToday.jsx`).

## Prompt section sizes (`run_inputs`)

Schema 15 adds `run_inputs.sections` (JSON, section → chars), `hash`
(SHA-256 of the prompt), and `chars`. `Coordinator.promptParts()` builds the
prompt as named sections in order; `prompt()` is their concatenation, so the
sizes always add up to `chars`.

| Section | What it is today (0.3.20) |
|---|---|
| `instructions` | The bot's own instructions |
| `platform` | Workspace, credentials, approvals, untrusted-data notice |
| `delegation` | Peers and the `anybot` delegate block, or the direct-chat line |
| `artifacts` | The `anybot-artifacts` contract and supplied files |
| `board` | Current task card, canvas excerpt, open board tasks |
| `actionGuide` | The `anybot-actions` guide (sent to every run today) |
| `org` | Chain of command, unread team reports, recalled memories |
| `knowledge` | Knowledge-graph facts |
| `team` | Thread collaboration and @mention guidance (projects) |
| `background` | "Conversation:" header plus channel background for thread runs |
| `history` | The re-sent transcript (thread or conversation) |
| `assignment` | The assignment and the closing instruction |

M1 replaces these with the layers of §3.1; the section names will follow.

## Retention (`runtime/retention.mjs`)

| Data | Kept | When pruned |
|---|---|---|
| `run_inputs.prompt` (full text) | newest 50 runs (`KEEP_PROMPTS`) | at startup and after each run starts |
| `run_inputs.sections`, `hash`, `chars` | forever | never |
| `events` (audit log) | 90 days (`EVENT_DAYS`) | at startup |
| Terminal logs | newest 300 runs | at startup (unchanged, `runtime/terminal.mjs`) |

Both limits are `Coordinator` options (`keepPrompts`, `eventDays`).

## Benchmark corpus and baseline

`scripts/corpus.mjs` generates three synthetic workspaces from a fixed seed
(messages log-normal: median 400 chars, p95 4 KB, max 24,000):

- `direct`: one bot, 60 messages.
- `project2`: two bots, 12 channel messages, then a 40-message thread with
  @mention hand-offs and long (6–12 KB) reports.
- `project5k`: three bots, 250 threads, 5,000 messages.

`node scripts/make-corpus.mjs` writes them to `tests/fixtures/corpus/`
(gitignored) plus `manifest.json` (committed digests; `--check` and
`tests/corpus.test.mjs` fail if the generator changes silently).

- `node scripts/bench-context.mjs`: prompt chars per section for every run.
- `node scripts/bench-sync.mjs`: snapshot bytes and bytes per streaming push.
- `node scripts/record-baseline.mjs`: both, into `baseline.json`.

Baseline at 0.3.20 (`baseline.json`):

| Workspace | Prompt median | Prompt p95 | History median | Snapshot | Per streaming push |
|---|---|---|---|---|---|
| direct | 20,120 chars | 24,313 | 16,224 | 80 KB | 103 KB |
| project2 | 46,264 chars | 53,350 | 36,032 | 241 KB | 254 KB |
| project5k | 24,075 chars | 45,805 | 9,562 | 11.8 MB | 11.8 MB |

Every run also carries the 1,942-char action guide, board or not. Reply text
is stored twice (the message and `runs.output`): 4.1 MB of the 5k snapshot.
Pushes go out up to every 100 ms while a bot streams, and the streaming run's
whole output is written to SQLite every 150 ms.
