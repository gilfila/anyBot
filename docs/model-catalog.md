# Current model choices

Provider model IDs change with CLI releases, account tier, and organization policy. anyBot reads each harness's own live list every time the bot editor opens: Claude Code's server-provided list in `~/.claude.json` (models that need a newer CLI show disabled, with the reason), Codex's `models_cache.json` in `CODEX_HOME`, `agy models` for Antigravity (cached for ten minutes), and Hermes's provider catalog (its `openai-codex` provider reuses Codex's list). A model set in a harness's own local config is added too. The Custom model field remains available for any other provider identifier.

Create `models.json` in the application data directory shown under **Runtime & privacy**, then fully restart anyBot:

```json
{
  "version": 1,
  "models": {
    "codex": [
      { "value": "your-current-codex-model", "label": "Team Codex model" }
    ],
    "antigravity": ["your-current-antigravity-model"],
    "hermes": [
      { "value": "your-current-hermes-model", "label": "Team Hermes" }
    ]
  }
}
```

The employee form reads these entries into the Model dropdown. The file is owner-controlled data only; it cannot add commands, executable paths, or environment variables. IDs must be 1–120 characters using letters, numbers, `.`, `_`, `:`, `/`, `+`, or `-`; each provider accepts at most 64 entries. Invalid files are ignored with a visible runtime diagnostic, and the Custom model choice remains available.

Besides the live lists, discovery reads the model a harness's local config names: Codex's `CODEX_HOME/config.toml` (or `.codex/config.toml`), Hermes's local JSON/YAML configuration, and Cursor's local CLI configuration when present. Missing or malformed files produce no guessed choices. Discovery never copies credentials; only `agy models` contacts a provider, because that is how Antigravity lists its models.

Keep this file local to the workspace owner. A model name is not a credential and does not prove that the provider account can use it; the first real run still performs provider compatibility and authentication checks.
