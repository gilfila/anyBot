# Implementation status

This file describes current code, not the full proposed design. Installation has been explicitly approved and completed through Computer. The 0.2.11 installer is built with software GPU rendering and no silent post-install launch; a clean per-user smoke install starts without the previous GPU fatal. The existing `%LOCALAPPDATA%\\Programs\\anyBot` directory still has restrictive ACLs in this session, so its stale UI is not current-package evidence.

Mobile now has a touch-first React client, Capacitor iOS/Android projects, a native Android debug build verified on an emulator, and an opt-in paired HTTPS gateway sharing the desktop coordinator. The gateway supports configured human member identities, owner-managed durable membership, conversation invitations, per-session conversation filtering, bounded audit records, and optional RS256 external-token mapping in headless server mode. Direct packaged UI creation of Codex employees remains an acceptance gap because the local Computer accessibility bridge is unavailable; isolated remote workers remain a Phase 2 release gate. See docs/mobile.md for setup and remaining acceptance gates.

## Present

React desktop UI; Electron sandboxed renderer and narrow IPC; utility-process coordinator; SQLite history and queue; employee creation/editing/archive/restore, model overrides, and bounded 10-minute-to-24-hour run policies; harness-aware model dropdown with current Claude discovery, configured Codex/Gemini/Hermes/Cursor model discovery from local provider settings, owner-maintained catalogs, and custom-model fallback; single- and multi-employee conversations; explicit structured delegation and bounded parent continuation; per-employee/workspace serialization; cancellation; pause/stop-all; five subprocess adapter implementations; Windows NSIS and portable packaging; interval-based durable routines with skip-missed/skip-overlap behavior; saved per-run prompt inputs; unit/integration tests with simulated harnesses; real headless Electron runtime integration test.

The first end-to-end artifact test is [Orbit Snake](../games/snake/index.html): a playable 24x24 canvas game with procedural custom graphics, keyboard/touch controls, persistent top-five local high scores, a responsive phone layout, and a recorded Mira/Sol build conversation. `tests/snake-agents.test.mjs` proves the two-agent delegation path through the real coordinator; `playwright.snake.config.mjs` covers scoring, collision/high-score persistence, and mobile layout. Configured human members are now returned as safe pairing choices in the desktop runtime settings instead of requiring operators to retype IDs.

The same runtime can now be started headlessly with `node server/index.mjs --config <file>`. `node server/preflight.mjs --config <file>` checks writable storage and identity key material before launch; adding `--hosted` also requires TLS, a non-loopback public URL, external identity, and an owner member. `server/config.example.json`, the unprivileged `server/Dockerfile`, hardened systemd example, and `docs/server.md` define the loopback/VPS deployment boundary. `tests/server.test.mjs` proves coordinator startup, pairing, identity, preflight, and projected member metadata without Electron.

## Next verification

1. Replace or uninstall the ACL-protected legacy per-user directory, then inspect the 0.2.11 UI model selector from the clean installation. The current 0.2.11 installer and clean-package smoke are authoritative until that ACL is repaired.
2. Place current account/provider IDs in `models.json`, inspect those choices in the packaged employee form, and create two Codex-backed employees through the UI.
3. Verify real responses, a delegated child task, parent synthesis, cancellation, and coordinated close persistence through the packaged UI. The opt-in backend test already passes with two real Codex employees using an explicit `gpt-5.5` override.
4. Add isolated remote workers, signed updates, provider token revocation, and production backup/restore before treating hosted multi-human mode as release-ready.

## Known gaps and risks

- Claude Code and Hermes passed no-tools live response checks; Codex passed a two-employee text handoff. Full tool/permission conformance is still incomplete. Gemini 0.57.0 is installed and launches after correcting its bundled entry path, but the configured Code Assist login returns `UNSUPPORTED_CLIENT`; no successful Gemini response has been verified.
- The installed Codex CLI rejects its configured `gpt-6-astra` default as requiring a newer CLI. An explicit employee model override of `gpt-5.5` passed the live backend collaboration test; upgrading the installed CLI remains a separate option.
- Headless server mode can verify short-lived RS256 tokens against a configured issuer/audience and rotating local JWKS, then map subjects to configured members. The mobile client now performs provider discovery and authorization-code + PKCE sign-in; isolated remote workers and provider revocation remain deployment/release work.
- Trusted-local profile only; no app-enforced per-tool approvals or OS-level employee isolation.
- Coordinator restart classifies interrupted work, but crash-proof child ownership and orphan reconciliation need hardening.
- Native session IDs/resume are not yet used; application conversation slices supply continuity.
- Queue and snapshot reads currently have no pagination. Long histories need bounded queries and incremental event delivery.
- Routines currently use fixed-minute intervals (5 minutes to 7 days), not calendar schedules. Scoped long-term memory and credential broker are not implemented yet.
- Deliverables panel, content-addressed file capture, nonexecuting previews, and conversation-scoped inbox staging are implemented. The trusted-host limitation still applies; these checks do not isolate a fully privileged harness from other desktop files.
- Update draining, signed release, and a clean-machine installation matrix remain outstanding. A stop-before-copy backup command now captures durable workspace state, artifacts, membership grants, and audit logs with a manifest. Launch-at-login is now an opt-in desktop setting persisted per user. The packaged runtime now starts in an explicitly marked temporary profile when all persistent profile locations are ACL-blocked; repairing the profile is still required before relying on durable local history.
- An opt-in mobile HTTPS API now supports configured-member conversation ACLs, durable single-organization membership, and headless RS256 identity with local JWKS rotation. Hosted deployment, PostgreSQL-backed multi-organization membership, provider revocation, and isolated remote workers remain unimplemented.
- Queued turns now include relevant earlier responses and save input snapshots. Native harness resume, richer in-flight steering, and audience-version semantics remain future work.

Do not mark the overall goal complete based on the current build or simulated tests.
