# Release readiness

## Local Phase 1

| Requirement | Evidence | Status |
| --- | --- | --- |
| Team UI for named AI employees | React desktop UI, conversations, employee lifecycle, delegation | Ready for local validation |
| Claude Code, Codex CLI, Gemini CLI, Hermes Agent, Cursor Agent CLI | Five adapters, executable probing, model discovery, subprocess contract tests | Ready for authenticated provider checks |
| Long-running local runtime | Electron utility coordinator, tray behavior, pause/cancel, launch-at-login | Ready for local validation |
| Installable Windows app | NSIS installer, unpacked/ZIP fallback, checksum manifest | Verified on this Windows host; unsigned portable self-extractor may be quarantined by Windows |
| Two-agent Snake proof | Mira/Sol delegation test and playable artifact with scores | Verified |
| Mobile companion | Capacitor Android/iOS projects, scoped HTTPS gateway, conversation ACLs | Web/sync, native Android build, and emulator launch verified; physical device and iOS acceptance pending |

## Hosted Phase 2 gates

| Gate | Current evidence | Required before release |
| --- | --- | --- |
| Multiple human identities | Durable members, invitation ACLs, RS256 token mapping, audit records, browser OIDC discovery with PKCE | Provider app registration, token revocation integration, and hosted multi-organization policy |
| Worker isolation | Unprivileged image and service examples | Isolated worker per trust boundary; current harnesses share the host account |
| Durable hosted tenancy | Single-organization `members.json` and SQLite | PostgreSQL-backed organization and membership service |
| Update integrity | SHA-256 release manifest | Signed update metadata and draining/rollback behavior |
| Mobile distribution | Capacitor projects, Android debug workflow, and CI artifact uploads for Android/iOS simulator builds | Physical Android/iOS tests, signing, secure credential storage, store packaging |

Run `npm test`, `npm run test:runtime`, `npm run mobile:sync`, and `npm run doctor` before local acceptance. Use `node server/preflight.mjs --config <file> --hosted` as the VPS configuration gate.

The Windows workflow in `.github/workflows/desktop-build.yml` repeats the suite and publishes the portable binary plus checksum manifest as a CI artifact. The mobile workflow separately builds the Android debug target and iOS Simulator target.
