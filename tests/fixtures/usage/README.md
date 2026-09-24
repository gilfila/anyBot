# Harness result events (usage parsing fixtures)

One stream per harness, as its CLI prints it, trimmed to the events
`runtime/usage.mjs` reads. Ids are replaced with placeholders and the reply
text with "ok"; nothing here is user content.

| File | Source |
|---|---|
| `claude.jsonl` | Captured from Claude Code 2.1.281 (`claude -p --output-format stream-json --verbose`), 2026-09-24; token numbers unchanged. |
| `codex.jsonl` | Codex CLI `exec --json` event shapes; token numbers from the 2026-09-24 baseline turn (Altman, 8 tool calls). Replace with a capture from Tony's PC when convenient. |
| `gemini.jsonl` | Gemini CLI `--output-format stream-json` shapes (`stats.input_tokens` includes `stats.cached`). Not captured here: no Gemini CLI in this environment. |
| `cursor.jsonl` | Cursor Agent `--output-format stream-json` shapes. Its result event carries no token counts, so only duration is recorded. |
