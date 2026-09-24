import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, Store } from "../runtime/store.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

// A workspace written by 0.3.19 (schema 14), from tests/fixtures/schema-v14.sql.
async function v14(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-v14-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  db.exec(await readFile(new URL("./fixtures/schema-v14.sql", import.meta.url), "utf8"));
  db.close();
  return directory;
}

test("schema 14 workspaces upgrade to 15 with usage and prompt metrics", async (t) => {
  const directory = await v14(t);
  const store = new Store(directory);
  t.after(() => store.close());
  assert.equal(SCHEMA_VERSION, 15);
  assert.equal(store.one("SELECT value FROM metadata WHERE key='schema'").value, "15");
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

test("an upgraded workspace opens in the coordinator and prunes by the retention rules", async (t) => {
  const directory = await v14(t);
  const c = new Coordinator({
    directory,
    runner: async () => "Done",
    probe: async () => [],
    keepPrompts: 1,
    clock: () => Date.parse("2026-09-24T00:00:00.000Z"),
  });
  t.after(() => c.close());
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
