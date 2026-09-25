import test from "node:test";
import assert from "node:assert/strict";
import { threadIndex } from "../src/components/chat/threads.js";

test("a bot whose turn failed still counts as a thread participant", () => {
  const messages = [
    { id: "root", thread: null, author: "human", created: "1" },
    { id: "a1", thread: "root", author: "ada", created: "2" },
  ];
  const runs = [
    { id: "r1", thread: "root", employee: "ada", status: "succeeded" },
    { id: "r2", thread: "root", employee: "lin", status: "failed", dismissed: false },
    { id: "r3", thread: "root", employee: "kay", status: "running" },
  ];
  const entry = threadIndex(messages, runs).get("root");
  assert.deepEqual(entry.participants, ["ada", "lin", "kay"]);
  assert.deepEqual(entry.working, ["kay"]);
  assert.deepEqual(entry.failed.map((r) => r.id), ["r2"]);
});
