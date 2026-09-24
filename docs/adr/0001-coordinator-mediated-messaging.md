# ADR-0001: Bots talk through the coordinator, not A2A

Status: accepted · 2026-09-24

## Context

The owner asked whether Any Bot uses A2A (the Agent2Agent protocol) for bots to
communicate. Today bots talk through project threads: a bot's reply can
@mention a teammate, and the coordinator starts that teammate's turn in the same
thread with the thread as context. Handoffs (`anybot` blocks) and board, canvas,
memory, and knowledge actions also go through the coordinator.

Each bot is a harness CLI (Claude Code, Codex, Gemini, Hermes, Cursor, or a
custom one) that runs once per turn in its own workspace and exits. None of
them is a long-running service.

## Decision

Inside a workspace, bots communicate only through coordinator-mediated threads.
The coordinator owns ordering, permissions (membership, chain of command),
loop limits (6 bot-to-bot hops per thread), concurrency (8 bots at once, one
turn per bot), and the audit trail.

A2A is reserved for the edge: exposing the team to outside agents, or hiring an
outside agent as a bot (plan milestone M5, only on request).

## Why

- An A2A server per bot would wrap the same one-shot CLI run, adding a network
  service, auth, and a second task model for no new capability.
- The coordinator already sees every message, which is what makes the
  owner-facing guarantees above possible. Direct agent-to-agent traffic would
  bypass them.
- The standard that matters between an agent and the platform is MCP (plan
  milestone M4). Any Bot already uses it for approvals.

## Consequences

- Bots can't reach each other outside a shared project, except managers
  delegating down the chain of command.
- Interop with outside agent systems waits for M5.
