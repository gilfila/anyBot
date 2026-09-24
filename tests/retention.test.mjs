import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../runtime/store.mjs";
import { EVENT_DAYS, KEEP_PROMPTS, pruneEvents, prunePrompts } from "../runtime/retention.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

async function store(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-retention-"));
  const s = new Store(directory);
  t.after(async () => {
    s.close();
    await rm(directory, { recursive: true, force: true });
  });
  s.run("INSERT INTO employees(id,name,role,harness,instructions,workspace,trusted,created) VALUES ('e','B','R','codex','','w',1,'t')");
  s.run("INSERT INTO conversations(id,title,members,created) VALUES ('c','T','[\"e\"]','t')");
  s.run("INSERT INTO messages(id,conversation,author,kind,body,created) VALUES ('m','c','human','user','x','t')");
  return s;
}
const addInput = (s, n) => {
  s.run("INSERT INTO runs(id,conversation,employee,message,root,status,created) VALUES (?,?,?,?,?,?,?)", `r${n}`, "c", "e", "m", `r${n}`, "succeeded", "t");
  s.run("INSERT INTO run_inputs(run,prompt,created,chars,hash) VALUES (?,?,?,?,?)", `r${n}`, `prompt ${n}`, "t", 8, `h${n}`);
};

test("defaults: 50 prompts, 90 days of events", () => {
  assert.equal(KEEP_PROMPTS, 50);
  assert.equal(EVENT_DAYS, 90);
});

test("prunePrompts keeps full text for the newest runs only, and every size and hash", async (t) => {
  const s = await store(t);
  for (let n = 1; n <= 55; n++) addInput(s, n);
  assert.equal(prunePrompts(s, 50), 5);
  const rows = s.all("SELECT run,prompt,chars,hash FROM run_inputs ORDER BY rowid");
  assert.deepEqual(rows.slice(0, 5).map((r) => r.prompt), ["", "", "", "", ""]);
  assert.equal(rows[5].prompt, "prompt 6");
  assert.ok(rows.every((r) => r.chars === 8 && r.hash));
  assert.equal(prunePrompts(s, 50), 0, "pruning again changes nothing");
  assert.equal(prunePrompts(s, 0), 50);
});

test("pruneEvents drops audit events older than the cutoff", async (t) => {
  const s = await store(t);
  const day = 86_400_000;
  const clock = () => Date.parse("2026-09-24T00:00:00.000Z");
  for (const [type, age] of [["old", 91], ["edge", 89], ["new", 0]])
    s.run("INSERT INTO events(type,payload,created) VALUES (?,?,?)", type, "{}", new Date(clock() - age * day).toISOString());
  assert.equal(pruneEvents(s, 90, clock), 1);
  assert.deepEqual(s.all("SELECT type FROM events ORDER BY seq").map((e) => e.type), ["edge", "new"]);
});

test("the coordinator prunes prompts as runs are added", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-retention-coord-"));
  const c = new Coordinator({ directory, runner: async () => "Done", probe: async () => [], keepPrompts: 2 });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Builder", role: "Engineer", harness: "codex", trusted: true });
  const employee = c.snapshot().employees[0];
  await c.command("conversations.create", { title: "Direct", members: [employee.id] });
  const conversation = c.snapshot().conversations[0];
  for (let n = 0; n < 4; n++) {
    await c.command("messages.send", { conversation: conversation.id, body: `Task ${n}`, requestId: crypto.randomUUID() });
    for (let i = 0; i < 200 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
      await new Promise((r) => setTimeout(r, 10));
  }
  const rows = c.store.all("SELECT prompt,chars FROM run_inputs ORDER BY rowid");
  assert.equal(rows.length, 4);
  // The newest two (including the run that was just inserted) keep text.
  assert.deepEqual(rows.map((r) => r.prompt !== ""), [false, false, true, true]);
  assert.ok(rows.every((r) => r.chars > 0));
});
