// Explicit opt-in provider test. This uses the installed CLI's existing login.
// Run: node tests/live-codex-smoke.mjs <compatible-model>
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";

const model = process.argv[2];
if (!model)
  throw new Error("Pass an explicit compatible Codex model identifier.");
const base = resolve(".anybot/live-tests");
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, "codex-team-"));
const c = new Coordinator({ directory, concurrency: 1 });
try {
  await c.initialize();
  for (const [name, role, instructions] of [
    [
      "Smoke Lead",
      "Coordinator",
      "Do not use tools or read files. When asked to delegate, emit the exact anybot delegation block for Smoke Calculator. After receiving their result, do not delegate again; respond exactly TEAM_OK: 42.",
    ],
    [
      "Smoke Calculator",
      "Calculator",
      "Do not use tools, read files, or delegate. Answer the requested calculation with exactly CALCULATED: 42.",
    ],
  ])
    await c.command("employees.create", {
      name,
      role,
      instructions,
      harness: "codex",
      model,
      trusted: true,
    });
  const employees = c.snapshot().employees;
  await c.command("conversations.create", {
    title: "Live Codex delegation smoke test",
    members: employees.map((e) => e.id),
    delegation: true,
  });
  const conversation = c.snapshot().conversations[0];
  await c.command("messages.send", {
    conversation: conversation.id,
    recipients: [employees[0].id],
    requestId: crypto.randomUUID(),
    body: "Delegate to Smoke Calculator: calculate 19 + 23. After its result arrives, reply exactly TEAM_OK: 42. Do not call tools or read files.",
  });
  const deadline = Date.now() + 180000;
  let state;
  while (Date.now() < deadline) {
    state = c.snapshot();
    if (
      !state.runs.some((r) =>
        ["queued", "running", "cancelling"].includes(r.status),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await writeFile(
    join(directory, "evidence.json"),
    JSON.stringify(state, null, 2),
  );
  assert.equal(
    state.runs.length,
    3,
    "Expected lead, delegated child, and lead continuation",
  );
  assert.ok(
    state.runs.every((r) => r.status === "succeeded"),
    JSON.stringify(
      state.runs.map((r) => ({ status: r.status, error: r.error })),
    ),
  );
  assert.match(state.messages.at(-1).body, /TEAM_OK: 42/);
  console.log(
    JSON.stringify({
      result: "PASS",
      model,
      runs: state.runs.length,
      evidence: join(directory, "evidence.json"),
    }),
  );
} finally {
  await c.close();
}
