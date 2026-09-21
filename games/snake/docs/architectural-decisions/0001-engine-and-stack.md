# ADR-0001: Canvas 2D for the Snake artifact

## Decision

Use a zero-dependency HTML Canvas 2D game with procedural graphics.

## Reason

The artifact is an acceptance test for anyBot, so it must open directly, work offline, render consistently in Playwright, and avoid a package or asset pipeline that could obscure whether the two-agent workflow produced a usable result. Canvas provides precise control over the custom neon graphics and keeps the deliverable portable to desktop and mobile web views.
