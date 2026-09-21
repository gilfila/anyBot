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
