# Custom CLI harnesses

The five built-in adapters are supplemented by an owner-controlled configuration file. Create `harnesses.json` in the app data directory displayed under **Runtime & privacy**, then fully quit and restart anyBot. Closing its window performs a coordinated shutdown; use the tray menu when you need to stop active work explicitly.

```json
{
  "version": 1,
  "adapters": [
    {
      "id": "my-agent",
      "name": "My agent",
      "trusted": true,
      "executable": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Tools\\my-agent\\headless.js"],
      "output": "text",
      "modelFlag": "--model"
    }
  ]
}
```

Replace the example paths with your own installed program. The executable must be absolute; Windows requires an `.exe`. For Node/Python agents, choose the actual interpreter executable and pass the script as an argument. Arguments are passed literally, without a shell, command substitution, or placeholder expansion. Prompts are never appended to a command string.

The CLI must read one complete prompt from stdin until EOF, write its assistant response to stdout, write diagnostics to stderr, and exit zero on success. It must operate without terminal interaction. Authenticate separately before using it. Put log output on stderr so it does not become part of the assistant response. A wrapper program can adapt a JSON protocol, HTTP service, or interactive harness to this interface; the app does not claim compatibility with every CLI protocol automatically.

`modelFlag` is optional. If supplied, an employee's nonempty model is appended as two arguments, for example `--model my-model`. Without that field, leave the employee model empty. Custom outputs can use the same `anybot` delegation and `anybot-artifacts` fences as built-ins.

IDs must be unique, at most 30 lowercase letters/digits/hyphens, and start with a letter. Built-in IDs cannot be overridden. At most 32 adapters, 64 arguments per adapter, and 64 KB of configuration are accepted. An invalid document disables all its custom entries, shows an error on **Harnesses**, and leaves built-ins available. Removing a definition does not remove employee history; affected employees cannot execute until the definition is restored or their harness is changed.

This is executable configuration for the trusted local owner. `trusted: true` records that choice; it is not a security sandbox or a signature. Anyone with write access to this file or the selected executable/script can change future execution. Do not place credentials in arguments or this JSON. The child uses the same filtered environment and local harness account access as built-ins. Keep the file outside employee working directories. A privileged local harness could still alter it; stronger OS isolation is future work.

The configuration is loaded once at coordinator startup. Clicking **Check installations** checks the current definitions' executable paths; it does not reload changed definitions during active work. No renderer RPC, chat command, or employee delegation can add a launcher. Existing timeout, output limits, queue serialization, cancellation, and conversation routing apply.

Current verification uses an actual Node subprocess behind a custom employee and real SQLite coordinator. It proves this stdin/stdout contract, not compatibility with an arbitrary third-party agent. Interactive terminal protocols, custom environment-variable mappings, and per-tool approval mediation are not yet supported.
