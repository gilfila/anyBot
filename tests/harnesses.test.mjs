import test from "node:test";
import assert from "node:assert/strict";
import { recentHarnessFailures } from "../src/lib/harnesses.js";

const now = Date.parse("2026-09-25T12:00:00.000Z");
const employees = [
  { id: "a", name: "Altman", harness: "codex" },
  { id: "d", name: "Dario", harness: "claude" },
];

test("a harness's recent failures are its own bots' failed runs from the last week, newest first", () => {
  const runs = [
    { id: "r1", employee: "a", status: "failed", ended: "2026-09-24T09:00:00.000Z", error: "Codex exited 1\nstack…" },
    { id: "r2", employee: "a", status: "failed", ended: "2026-09-25T08:00:00.000Z", error: "" },
    { id: "r3", employee: "a", status: "succeeded", ended: "2026-09-25T09:00:00.000Z" },
    { id: "r4", employee: "d", status: "failed", ended: "2026-09-25T09:00:00.000Z", error: "other harness" },
    { id: "r5", employee: "a", status: "failed", ended: "2026-09-17T12:00:00.000Z", error: "too old" },
    { id: "r6", employee: "a", status: "failed", ended: null, error: "still settling" },
  ];
  assert.deepEqual(recentHarnessFailures("codex", runs, employees, now), [
    { id: "r2", bot: "Altman", ended: "2026-09-25T08:00:00.000Z", error: "The run failed." },
    { id: "r1", bot: "Altman", ended: "2026-09-24T09:00:00.000Z", error: "Codex exited 1\nstack…" },
  ]);
  assert.deepEqual(recentHarnessFailures("antigravity", runs, employees, now), [], "no bots, no failures");
  assert.deepEqual(recentHarnessFailures("codex", undefined, undefined, now), []);
});
