# Harness result events (usage parsing fixtures)

One stream per harness, as its CLI prints it, trimmed to the events
`runtime/usage.mjs` reads. Ids are replaced with placeholders and the reply
text with "ok"; nothing here is user content.

| File | Source |
|---|---|
| `claude.jsonl` | Captured from Claude Code 2.1.281 (`claude -p --output-format stream-json --verbose`), 2026-09-24; token numbers unchanged. |
| `codex.jsonl` | Captured from Codex CLI 0.155.0-alpha.16 (`codex exec --json`, the Windows desktop install), 2026-09-24; token numbers unchanged. Includes a real startup warning item before `turn.started`, and `turn.completed` with `cache_write_input_tokens` and `reasoning_output_tokens` (a subset of `output_tokens`). |
| `antigravity.jsonl` | Captured from Antigravity CLI 1.2.10 (`agy --output-format stream-json --dangerously-skip-permissions`, prompt on stdin), 2026-09-25; token numbers unchanged, the tool list trimmed to 4. One `run_command` step, then the reply. |
| `antigravity-denied.jsonl` | The same prompt in the default mode: the command is refused (`permission check failed`), the response is empty, and the result lists `denied_actions`. |
| `cursor.jsonl` | Cursor Agent `--output-format stream-json` shapes. Its result event carries no token counts, so only duration is recorded. Not captured: the owner's Cursor Agent 2026.02.27 install fails to start (`Cannot find module './240.index.js'`). |
