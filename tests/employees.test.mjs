import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Coordinator } from "../runtime/coordinator.mjs";
import { Store } from "../runtime/store.mjs";
import { invocation } from "../runtime/adapters.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-employee-"));
  const c = new Coordinator({
    directory,
    probe: async () => [],
    runner: async () => "Done",
  });
  await c.command("runtime.pause");
  await c.command("employees.create", {
    name: "Sam",
    role: "Builder",
    harness: "codex",
    trusted: true,
  });
  const employee = c.snapshot().employees[0];
  await c.command("conversations.create", {
    title: "Testing",
    members: [employee.id],
  });
  const conversation = c.snapshot().conversations[0];
  t.after(async () => {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { c, employee, conversation };
}

test("employee edits preserve identity and reject stale updates", async (t) => {
  const { c, employee } = await fixture(t);
  assert.equal(employee.permissionMode, "ask");
  const payload = {
    ...employee,
    trusted: true,
    name: "Sam the reviewer",
    harness: "claude",
    model: "sonnet",
    permissionMode: "dontAsk",
  };
  await c.command("employees.update", payload);
  const edited = c.snapshot().employees[0];
  assert.equal(edited.id, employee.id);
  assert.equal(edited.revision, 2);
  assert.equal(edited.model, "sonnet");
  assert.equal(edited.timeoutMinutes, 10);
  assert.equal(edited.permissionMode, "dontAsk");
  await assert.rejects(c.command("employees.update", payload), /Reload/);
  assert.deepEqual(invocation("claude", "sonnet").slice(-2), [
    "--model",
    "sonnet",
  ]);
});

test("employee run duration is bounded and persisted", async (t) => {
  const { c, employee } = await fixture(t);
  await assert.rejects(
    c.command("employees.update", {
      ...employee,
      trusted: true,
      timeoutMinutes: 9,
    }),
    /10 to 1440/,
  );
  await c.command("employees.update", {
    ...employee,
    trusted: true,
    timeoutMinutes: 1440,
  });
  assert.equal(c.snapshot().employees[0].timeoutMinutes, 1440);
});

test("archive pauses routines and blocks new work without deleting history", async (t) => {
  const { c, employee, conversation } = await fixture(t);
  await c.command("routines.create", {
    name: "Check",
    prompt: "Check files",
    minutes: 60,
    conversation: conversation.id,
    employee: employee.id,
  });
  await c.command("employees.setArchived", {
    id: employee.id,
    revision: employee.revision,
    archived: true,
  });
  assert.equal(c.snapshot().routines[0].enabled, 0);
  assert.equal(c.snapshot().conversations.length, 1);
  await assert.rejects(
    c.command("messages.send", {
      conversation: conversation.id,
      body: "Task",
      recipients: [employee.id],
      requestId: "test",
    }),
    /archived/,
  );
  await assert.rejects(
    c.command("routines.runNow", { id: c.snapshot().routines[0].id }),
    /archived/,
  );
  await assert.rejects(
    c.command("routines.setEnabled", {
      id: c.snapshot().routines[0].id,
      enabled: true,
    }),
    /archived/,
  );
  await c.command("employees.setArchived", {
    id: employee.id,
    revision: 2,
    archived: false,
  });
  assert.equal(
    c.snapshot().routines[0].enabled,
    0,
    "restoration must not silently resume schedules",
  );
  await c.command("messages.send", {
    conversation: conversation.id,
    body: "Task",
    recipients: [employee.id],
    requestId: "test",
  });
  assert.equal(c.snapshot().runs.length, 1);
});

test("queued or delegated work blocks employee reconfiguration", async (t) => {
  const { c, employee, conversation } = await fixture(t);
  await c.command("messages.send", {
    conversation: conversation.id,
    body: "Queued assignment",
    recipients: [employee.id],
    requestId: "task",
  });
  await assert.rejects(
    c.command("employees.update", {
      ...employee,
      trusted: true,
      name: "Changed",
    }),
    /Stop or finish/,
  );
  await assert.rejects(
    c.command("employees.setArchived", {
      id: employee.id,
      revision: 1,
      archived: true,
    }),
    /Stop or finish/,
  );
  assert.equal(c.snapshot().employees[0].name, "Sam");
});


test("new employees default to ask permission mode and updates persist", async (t) => {
  const { c, employee } = await fixture(t);
  assert.equal(employee.permissionMode, "ask");
  await c.command("employees.update", {
    ...employee,
    trusted: true,
    permissionMode: "dontAsk",
  });
  assert.equal(c.snapshot().employees[0].permissionMode, "dontAsk");
  const revised = c.snapshot().employees[0];
  await c.command("employees.update", {
    ...revised,
    trusted: true,
    permissionMode: "ask",
  });
  assert.equal(c.snapshot().employees[0].permissionMode, "ask");
});

test("schema one employee records migrate without losing fields", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  db.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO metadata VALUES ('schema','1');
    CREATE TABLE employees(id TEXT PRIMARY KEY,name TEXT,role TEXT,harness TEXT,instructions TEXT,workspace TEXT,trusted INTEGER,created TEXT);
    INSERT INTO employees VALUES ('existing','Original employee','Engineer','codex','Keep my instructions','workspace',1,'2026-09-19');`);
  db.close();
  const store = new Store(directory);
  const employee = store.one("SELECT * FROM employees WHERE id='existing'");
  assert.equal(employee.name, "Original employee");
  assert.equal(employee.instructions, "Keep my instructions");
  assert.equal(employee.archived, 0);
  assert.equal(employee.revision, 1);
  assert.equal(employee.model, "");
  assert.equal(employee.timeoutMinutes, 10);
  assert.equal(employee.permissionMode, "dontAsk");
  assert.equal(employee.avatar, "");
  assert.equal(
    store.one("SELECT value FROM metadata WHERE key='schema'").value,
    "6",
  );
  store.close();
});
