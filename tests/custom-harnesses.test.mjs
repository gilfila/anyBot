import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCustomHarnesses } from "../runtime/custom-harnesses.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-custom-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const adapter = {
    id: "local-test",
    name: "Local test CLI",
    executable: process.execPath,
    args: [
      "-e",
      "process.stdin.resume(); process.stdin.on('end',()=>console.log('Custom CLI completed'))",
    ],
    output: "text",
    trusted: true,
  };
  const save = (adapters) =>
    writeFile(
      join(directory, "harnesses.json"),
      JSON.stringify({ version: 1, adapters }),
    );
  return { directory, adapter, save };
}

test("custom owner CLI runs through the real coordinator and subprocess adapter", async (t) => {
  const { directory, adapter, save } = await setup(t);
  await save([adapter]);
  const c = new Coordinator({ directory, probe: async () => [] });
  try {
    await c.initialize();
    assert.equal(c.snapshot().harnesses[0].id, "local-test");
    await c.command("employees.create", {
      name: "Custom",
      role: "Tester",
      harness: "local-test",
      trusted: true,
    });
    const employee = c.snapshot().employees[0];
    await c.command("conversations.create", {
      title: "Custom integration",
      members: [employee.id],
      delegation: false,
    });
    await c.command("messages.send", {
      conversation: c.snapshot().conversations[0].id,
      recipients: [employee.id],
      body: "Test custom CLI",
      requestId: crypto.randomUUID(),
    });
    const deadline = Date.now() + 30000;
    while (
      c.snapshot().runs.some((r) => ["running", "queued"].includes(r.status)) &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(c.snapshot().runs[0].status, "succeeded");
    assert.equal(c.snapshot().messages.at(-1).body, "Custom CLI completed");
  } finally {
    await c.close();
  }
});

test("invalid custom configuration fails closed without replacing built-ins", async (t) => {
  const { directory, adapter, save } = await setup(t);
  for (const change of [
    { id: "codex" },
    { trusted: false },
    { executable: "relative.exe" },
    { args: "shell command" },
    { output: "unknown" },
    { modelFlag: "--model; execute" },
  ]) {
    await save([{ ...adapter, ...change }]);
    const result = loadCustomHarnesses(directory);
    assert.equal(result.adapters.length, 0);
    assert.ok(result.error);
  }
  const c = new Coordinator({ directory, probe: async () => [] });
  try {
    await c.initialize();
    assert.ok(c.snapshot().runtime.customHarnessError);
    await c.command("employees.create", {
      name: "Built in",
      role: "Tester",
      harness: "codex",
      trusted: true,
    });
    await assert.rejects(
      c.command("employees.create", {
        name: "Bad",
        role: "Tester",
        harness: "local-test",
        trusted: true,
      }),
    );
  } finally {
    await c.close();
  }
});
