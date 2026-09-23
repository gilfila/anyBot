import test from "node:test";
import assert from "node:assert/strict";
import { awaitReply } from "../src/lib/voice-turn.js";

const employee = { id: "emp1", name: "Mira", timeoutMinutes: 10 };

// A fake clock: every sleep advances time instead of waiting.
function harness(states) {
  let t = 0, i = 0;
  return {
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    load: async () => states[Math.min(i++, states.length - 1)],
  };
}
const human = { id: "m2", author: "human", body: "Summarize it" };
const older = { id: "m1", author: "emp1", body: "Old answer." };

test("waits past the old 24 second cap and speaks the reply summary", async () => {
  const running = { messages: [older, human], runs: [{ id: "r1", message: "m2", employee: "emp1", status: "running" }] };
  const done = {
    messages: [older, human, { id: "m3", author: "emp1", body: "**Done.** See `a.md`.\n```js\nx\n```" }],
    runs: [{ id: "r1", message: "m2", employee: "emp1", status: "succeeded" }],
  };
  const spoken = [];
  const h = harness([...Array(120).fill(running), done]);
  const text = await awaitReply({ ...h, body: "Summarize it", employee, before: new Set(["m1"]), say: async (s) => spoken.push(s) });
  assert.equal(text, "Done. See a.md. The full details are in the chat.");
  assert.deepEqual(spoken, ["Still working on it."], "one cue at 45 s, the next only at 135 s");
});

test("ignores delegated child runs and earlier identical messages", async () => {
  const earlier = { id: "m0", author: "human", body: "Summarize it" };
  const state = {
    messages: [earlier, human],
    runs: [
      { id: "r0", message: "m0", employee: "emp1", status: "succeeded" },
      { id: "rc", message: "m2", employee: "emp1", status: "succeeded", parent: "r1" },
      { id: "r1", message: "m2", employee: "emp1", status: "failed" },
    ],
  };
  const text = await awaitReply({ ...harness([state]), body: "Summarize it", employee, before: new Set(["m0"]) });
  assert.equal(text, "Mira couldn't finish that. The run failed.");
});

test("stops when the voice session ends and survives dropped polls", async () => {
  let alive = true;
  const h = harness([]);
  h.load = async () => {
    alive = false;
    throw new Error("offline");
  };
  assert.equal(await awaitReply({ ...h, body: "x", employee, before: new Set(), live: () => alive }), null);
});

test("gives up politely after the employee's run limit", async () => {
  const h = harness([{ messages: [human], runs: [] }]);
  const text = await awaitReply({ ...h, body: "Summarize it", employee: { ...employee, timeoutMinutes: 1 }, before: new Set() });
  assert.match(text, /taking a while/);
});
