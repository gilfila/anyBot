# Current model choices

Provider model IDs change with CLI releases, account tier, and organization policy. anyBot keeps the built-in catalog conservative: Claude aliases are discovered from the installed CLI, while Codex, Gemini, Hermes, and Cursor Agent CLI read a configured model from the installed harness's own local config when one is present. The Custom model field remains available for provider identifiers that are not written in local config.

Create `models.json` in the application data directory shown under **Runtime & privacy**, then fully restart anyBot:

```json
{
  "version": 1,
  "models": {
    "codex": [
      { "value": "your-current-codex-model", "label": "Team Codex model" }
    ],
    "gemini": ["your-current-gemini-model"],
    "hermes": [
      { "value": "your-current-hermes-model", "label": "Team Hermes" }
    ]
  }
}
```

The employee form reads these entries into the Model dropdown. The file is owner-controlled data only; it cannot add commands, executable paths, or environment variables. IDs must be 1–120 characters using letters, numbers, `.`, `_`, `:`, `/`, `+`, or `-`; each provider accepts at most 64 entries. Invalid files are ignored with a visible runtime diagnostic, and the Custom model choice remains available.

Without `models.json`, discovery is read-only and provider-specific: Codex reads `CODEX_HOME/config.toml` (or `.codex/config.toml`), Gemini reads `.gemini/settings.json`, Hermes checks its local JSON/YAML configuration for a model field, and Cursor checks its local CLI configuration when present. Missing or malformed files produce no guessed choices. Discovery never sends a provider request or copies credentials.

Keep this file local to the workspace owner. A model name is not a credential and does not prove that the provider account can use it; the first real run still performs provider compatibility and authentication checks.
