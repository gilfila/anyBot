import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, Store } from "../runtime/store.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

// A workspace written by 0.3.19 (schema 14), from tests/fixtures/schema-v14.sql.
// The caller closes the workspace before removing it (Windows can't delete an
// open database), so cleanup is one hook: close, then remove.
async function v14(t, close) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-v14-"));
  t.after(async () => {
    await close.current?.();
    await rm(directory, { recursive: true, force: true });
  });
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  db.exec(await readFile(new URL("./fixtures/schema-v14.sql", import.meta.url), "utf8"));
  db.close();
  return directory;
}

test("schema 14 workspaces upgrade with usage and prompt metrics", async (t) => {
  const close = {};
  const directory = await v14(t, close);
  const store = new Store(directory);
  close.current = () => store.close();
  assert.equal(SCHEMA_VERSION, 18);
  assert.equal(store.one("SELECT value FROM metadata WHERE key='schema'").value, "18");
  // Schema 17: every existing message gets an empty attachment list.
  assert.deepEqual(
    [...new Set(store.all("SELECT attachments FROM messages").map((m) => m.attachments))],
    ["[]"],
  );
  const runs = store.all("SELECT id,status,output,usage FROM runs ORDER BY id");
  assert.deepEqual(
    runs.map((r) => ({ ...r })),
    [
      { id: "r1", status: "succeeded", output: "Done", usage: null },
      { id: "r2", status: "succeeded", output: "Done", usage: null },
    ],
  );
  const input = store.one("SELECT * FROM run_inputs WHERE run='r2'");
  assert.equal(input.prompt, "Synthetic prompt number two");
  assert.equal(input.chars, input.prompt.length);
  assert.equal(input.hash, createHash("sha256").update(input.prompt).digest("hex"));
  assert.equal(input.sections, "{}");
  assert.ok(store.all("PRAGMA index_list(events)").some((i) => i.name === "events_created"));
  // Existing data is untouched.
  assert.equal(store.one("SELECT name FROM employees WHERE id='e1'").name, "Builder");
  assert.equal(store.one("SELECT body FROM messages WHERE id='m1'").body, "Synthetic assignment");
});

test("Gemini CLI bots move to Antigravity, on the CLI's default model", async (t) => {
  const close = {};
  const directory = await v14(t, close);
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  db.exec(
    "INSERT INTO employees(id,name,role,harness,instructions,workspace,trusted,created,archived,revision,model,timeoutMinutes,permissionMode,avatar,manager) " +
      "VALUES ('e2','Sage','Researcher','gemini','Look things up','/tmp/ws',1,'2026-09-20T10:00:00.000Z',0,3,'gemini-2.5-pro',10,'auto','','')",
  );
  db.close();
  const store = new Store(directory);
  close.current = () => store.close();
  const rows = store.all("SELECT id,harness,model,revision FROM employees ORDER BY id").map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: "e1", harness: "codex", model: "", revision: 1 },
    { id: "e2", harness: "antigravity", model: "", revision: 4 },
  ]);
});

test("an upgraded workspace opens in the coordinator and prunes by the retention rules", async (t) => {
  const close = {};
  const directory = await v14(t, close);
  const c = new Coordinator({
    directory,
    runner: async () => "Done",
    probe: async () => [],
    keepPrompts: 1,
    clock: () => Date.parse("2026-09-24T00:00:00.000Z"),
  });
  close.current = () => c.close();
  // The newest prompt stays; the older one keeps only its size and hash.
  assert.equal(c.store.one("SELECT prompt FROM run_inputs WHERE run='r2'").prompt, "Synthetic prompt number two");
  const older = c.store.one("SELECT * FROM run_inputs WHERE run='r1'");
  assert.equal(older.prompt, "");
  assert.equal(older.chars, "Synthetic prompt one".length);
  assert.notEqual(older.hash, "");
  // The January event is past 90 days; the September one stays.
  assert.deepEqual(
    c.store.all("SELECT type FROM events ORDER BY seq").map((e) => e.type),
    ["run.completed"],
  );
  assert.equal(c.snapshot().runs.length, 2);
  assert.equal(c.snapshot().runs[0].usage, null);
});

// A workspace written by 0.3.36 (schema 18), shaped like a 45-bot life org,
// from tests/fixtures/schema-v18.sql (synthetic; scripts/make-schema-fixture.mjs).
// {root} and {userData} stand for the team's folder and the data folder.
async function v18(t, close) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-v18-"));
  t.after(async () => {
    await close.current?.();
    await rm(directory, { recursive: true, force: true });
  });
  const sql = (await readFile(new URL("./fixtures/schema-v18.sql", import.meta.url), "utf8"))
    .replaceAll("{root}", join(directory, "team").replaceAll("\\", "/"))
    .replaceAll("{userData}", directory.replaceAll("\\", "/"));
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  db.exec(sql);
  db.close();
  return directory;
}

test("a schema 18 workspace shaped like the Life Org opens as it is, gaining only indexes", async (t) => {
  const close = {};
  const directory = await v18(t, close);
  const store = new Store(directory);
  close.current = () => store.close();
  assert.equal(store.one("SELECT value FROM metadata WHERE key='schema'").value, "18");
  assert.deepEqual((await readdir(directory)).filter((f) => f.startsWith("anybot.backup")), [], "no upgrade, so no backup");
  const count = (sql) => store.one(sql).n;
  assert.equal(count("SELECT count(*) AS n FROM employees WHERE archived=0"), 45);
  assert.equal(count("SELECT count(*) AS n FROM employees WHERE archived=0 AND harness='codex'"), 9);
  assert.equal(count("SELECT count(DISTINCT workspace) AS n FROM employees WHERE archived=0"), 21);
  assert.deepEqual(
    store.all("SELECT name FROM employees WHERE archived=1 ORDER BY name").map((e) => e.name),
    ["Alex", "Altman", "Dario"],
  );
  // The old team's leftovers: two bots reporting to archived Alex, and a room
  // with no active members holding an open task and a pending review.
  const alex = store.one("SELECT id FROM employees WHERE name='Alex'").id;
  assert.equal(count(`SELECT count(*) AS n FROM employees WHERE manager='${alex}'`), 2);
  const snake = store.one("SELECT * FROM conversations WHERE title='Snake game test'");
  assert.equal(snake.archived, 0);
  assert.deepEqual(
    store.all("SELECT status FROM tasks WHERE conversation=? ORDER BY status", snake.id).map((task) => task.status),
    ["in_progress", "review"],
  );
  for (const index of ["runs_employee_created", "runs_created", "task_activity_kind_created", "messages_author_created"])
    assert.ok(store.one("SELECT name FROM sqlite_master WHERE type='index' AND name=?", index), index);
});

test("the Life Org workspace opens in the coordinator without starting anything", async (t) => {
  const close = {};
  const directory = await v18(t, close);
  const calls = [];
  const c = new Coordinator({ directory, runner: async () => calls.push(1) && "Done", probe: async () => [] });
  close.current = () => c.close();
  await c.initialize();
  const snapshot = c.snapshot();
  assert.equal(snapshot.employees.length, 48);
  assert.equal(snapshot.conversations.filter((x) => x.members.length > 1).length, 10);
  assert.equal(snapshot.routines.length, 18);
  assert.equal(snapshot.routines.filter((r) => r.enabled).length, 0);
  assert.equal(snapshot.tasks.length, 24);
  assert.ok(!snapshot.runs.some((r) => ["queued", "running"].includes(r.status)));
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(calls.length, 0);
});
