import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-routine-"));
  let current = 1000000;
  const c = new Coordinator({
    directory,
    clock: () => current,
    probe: async () => [],
    runner: async () => "Done",
  });
  clearInterval(c.timer);
  await c.command("runtime.pause");
  await c.command("employees.create", {
    name: "Ops",
    role: "Operations",
    harness: "codex",
    trusted: true,
  });
  const employee = c.snapshot().employees[0].id;
  await c.command("conversations.create", {
    title: "Operations",
    members: [employee],
  });
  const conversation = c.snapshot().conversations[0].id;
  await c.command("routines.create", {
    name: "Check project",
    prompt: "Review progress",
    employee,
    conversation,
    minutes: 5,
  });
  t.after(async () => {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    c,
    employee,
    conversation,
    advance: (ms) => {
      current += ms;
    },
    routine: c.snapshot().routines[0].id,
  };
}

test("scheduler persists due work once and skips overlapping occurrences", async (t) => {
  const { c, advance } = await setup(t);
  c.paused = false;
  advance(300000);
  c.routines.tick();
  c.routines.tick();
  assert.equal(c.snapshot().runs.length, 1);
  advance(300000);
  c.routines.tick();
  assert.equal(c.snapshot().runs.length, 1);
  assert.equal(c.snapshot().routines[0].lastOccurrence, "skipped-overlap");
});

test("runtime pause and missed occurrence recovery do not cause a catch-up burst", async (t) => {
  const { c, advance } = await setup(t);
  advance(3600000);
  c.routines.tick();
  assert.equal(c.snapshot().runs.length, 0);
  c.routines.recover();
  assert.equal(c.snapshot().routines[0].lastOccurrence, "missed");
  assert.equal(c.snapshot().runs.length, 0);
  c.paused = false;
  c.routines.tick();
  assert.equal(c.snapshot().runs.length, 0);
  advance(300000);
  c.routines.tick();
  assert.equal(c.snapshot().runs.length, 1);
});

test("routine target membership and intervals are enforced", async (t) => {
  const { c, conversation, employee } = await setup(t);
  const base = {
    name: "Bad",
    prompt: "Do work",
    conversation,
    employee,
    minutes: 5,
  };
  await assert.rejects(
    c.command("routines.create", { ...base, employee: "outsider" }),
    /belong/,
  );
  await assert.rejects(
    c.command("routines.create", { ...base, minutes: 0 }),
    /Interval/,
  );
  assert.equal(c.snapshot().routines.length, 1);
});

test("manual run stays queued during pause and overlapping manual work is rejected", async (t) => {
  const { c, routine } = await setup(t);
  await c.command("routines.runNow", { id: routine });
  assert.equal(c.snapshot().runs[0].status, "queued");
  await assert.rejects(
    c.command("routines.runNow", { id: routine }),
    /already has/,
  );
  assert.equal(c.snapshot().runs.length, 1);
});

test("a routine can be edited: text in place, a new interval restarts the clock", async (t) => {
  const { c, routine, employee, conversation, advance } = await setup(t);
  const before = c.snapshot().routines[0];
  advance(60000);
  await c.command("routines.update", { id: routine, name: "Daily brief", prompt: "Write the brief", minutes: 5 });
  let after = c.snapshot().routines[0];
  assert.equal(after.name, "Daily brief");
  assert.equal(after.prompt, "Write the brief");
  assert.equal(after.nextRun, before.nextRun, "same interval keeps the schedule");
  await c.command("routines.update", { id: routine, name: "Daily brief", prompt: "Write the brief", minutes: 1440 });
  after = c.snapshot().routines[0];
  assert.equal(after.minutes, 1440);
  assert.equal(after.nextRun, 1000000 + 60000 + 1440 * 60000);
  assert.equal(after.enabled, 1, "editing keeps it running");
  await assert.rejects(c.command("routines.update", { id: routine, name: "x", prompt: "y", minutes: 2 }), /5–10080/);
  await assert.rejects(c.command("routines.update", { id: routine, name: " ", prompt: "y", minutes: 5 }), /Routine name/);
  // Moving it to a bot outside the conversation is refused.
  await c.command("employees.create", { name: "Other", role: "Else", harness: "codex", trusted: true });
  const other = c.snapshot().employees.find((e) => e.name === "Other").id;
  await assert.rejects(
    c.command("routines.update", { id: routine, name: "a", prompt: "b", minutes: 5, employee: other, conversation }),
    /must belong/,
  );
  // Into a project that has the bot, it moves.
  await c.command("conversations.create", { title: "Both", members: [employee, other] });
  const both = c.snapshot().conversations.find((x) => x.title === "Both").id;
  await c.command("routines.update", { id: routine, name: "a", prompt: "b", minutes: 5, employee: other, conversation: both });
  assert.deepEqual([c.snapshot().routines[0].employee, c.snapshot().routines[0].conversation], [other, both]);
});

test("deleting a routine removes it and its history; its finished work stays", async (t) => {
  const { c, routine, advance } = await setup(t);
  c.paused = false;
  advance(300000);
  c.routines.tick();
  assert.equal(c.snapshot().runs.length, 1);
  await c.command("routines.delete", { id: routine });
  assert.equal(c.snapshot().routines.length, 0);
  assert.equal(c.store.one("SELECT count(*) AS n FROM routine_occurrences").n, 0);
  assert.equal(c.snapshot().runs.length, 1, "queued work is not cancelled");
  assert.ok(c.snapshot().messages.some((m) => m.kind === "routine"));
  advance(600000);
  c.routines.tick();
  assert.equal(c.snapshot().runs.length, 1, "nothing is scheduled after delete");
  await assert.rejects(c.command("routines.delete", { id: routine }), /not found/);
});
