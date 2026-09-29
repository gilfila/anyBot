import test from "node:test";
import assert from "node:assert/strict";
import {
  botNamed,
  closeOpenFence,
  copyText,
  delegationBlock,
  elapsed,
  handedTo,
  manifestPaths,
  matchArtifacts,
  replyRun,
  runDetails,
  stamp,
} from "../src/lib/chat.js";

test("copied replies drop the machine blocks but keep ordinary code", () => {
  const body = [
    "Built the page.",
    "",
    "```js",
    "console.log(1)",
    "```",
    "",
    "```anybot-artifacts",
    '{"paths":["site/index.html"]}',
    "```",
    "",
    "```anybot-actions  ",
    '[{"type":"task.update"}]',
    "```",
    "```anybot",
    '{"type":"delegate","employeeId":"x","objective":"y"}',
    "```",
  ].join("\n");
  assert.equal(copyText(body), "Built the page.\n\n```js\nconsole.log(1)\n```");
  assert.equal(copyText("```anybotish\nkeep\n```"), "```anybotish\nkeep\n```");
  assert.equal(copyText(null), "");
});

test("a manifest lists up to 8 distinct paths; anything else stays code", () => {
  assert.deepEqual(manifestPaths('{"paths":["a.md","b/c.png","a.md"]}'), ["a.md", "b/c.png"]);
  for (const bad of ["", "not json", "{}", '{"paths":[]}', '{"paths":"a.md"}', '{"paths":[1]}', '{"paths":[""]}', JSON.stringify({ paths: Array.from({ length: 9 }, (_, i) => `${i}.md`) })])
    assert.equal(manifestPaths(bad), null, bad);
});

test("listed paths pair with collected artifacts by file name, each used once", () => {
  const artifacts = [
    { id: "1", name: "index.md" },
    { id: "2", name: "index.md" },
    { id: "3", name: "chart.png" },
  ];
  assert.deepEqual(
    matchArtifacts(["docs/index.md", "site\\index.md", "notes/index.md", "chart.png"], artifacts).map((item) => [item.name, item.artifact?.id ?? null]),
    [
      ["index.md", "1"],
      ["index.md", "2"],
      ["index.md", null],
      ["chart.png", "3"],
    ],
  );
  assert.equal(matchArtifacts(["x.md"]).at(0).artifact, null);
});

test("a reply still streaming shows an unclosed code fence as code", () => {
  assert.equal(closeOpenFence("Here:\n```python\n# setup\nx = 1"), "Here:\n```python\n# setup\nx = 1\n```");
  assert.equal(closeOpenFence("```js\na()\n```\nthen ```"), "```js\na()\n```\nthen ```\n```");
  for (const done of ["No code yet", "```js\na()\n```", "", undefined]) assert.equal(closeOpenFence(done), String(done ?? ""));
});

test("a delegation block reads only a well-formed delegate request", () => {
  assert.deepEqual(delegationBlock('{"type":"delegate","employeeId":"e1","objective":"Ship it"}'), { employeeId: "e1", objective: "Ship it" });
  for (const bad of ["x", "{}", '{"type":"delegate","employeeId":1,"objective":"a"}', '{"type":"other","employeeId":"e","objective":"a"}'])
    assert.equal(delegationBlock(bad), null, bad);
});

test("a reply finds its run, and a handoff the runs it started", () => {
  const runs = [
    { id: "r1", message: "m1", response: "m2" },
    { id: "r2", message: "m2", response: null },
    { id: "r3", message: "m2" },
  ];
  assert.equal(replyRun({ id: "m2" }, runs).id, "r1");
  assert.equal(replyRun({ id: "m9" }, runs), null);
  assert.equal(replyRun({}, runs), null);
  assert.deepEqual(handedTo({ id: "m2" }, runs).map((r) => r.id), ["r2", "r3"]);
  assert.deepEqual(handedTo(null, runs), []);
});

test("@mentions resolve by name, ignoring case and preferring active bots", () => {
  const employees = [
    { id: "old", name: "Kai", archived: 1 },
    { id: "new", name: "Kai", archived: 0 },
    { id: "o", name: "O'Neil" },
  ];
  assert.equal(botNamed("kai", employees).id, "new");
  assert.equal(botNamed(" O'NEIL ", employees).id, "o");
  assert.equal(botNamed("Sage", employees), null);
  assert.equal(botNamed("", employees), null);
  assert.equal(botNamed("Kai", [{ id: "old", name: "Kai", archived: 1 }]).id, "old");
});

test("Details goes to the harness when it has problems, else to diagnostics", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const employees = [{ id: "e1", name: "Kai", harness: "codex" }];
  const run = { id: "r1", employee: "e1", status: "failed", ended: "2026-09-29T11:00:00Z" };
  assert.deepEqual(runDetails(run, { employees, harnesses: [{ id: "codex" }], runs: [run] }, now), { view: "harnesses", harness: "codex" });
  assert.deepEqual(runDetails(run, { employees, harnesses: [{ id: "codex", issues: [{ id: "x" }] }], runs: [] }, now), { view: "harnesses", harness: "codex" });
  const interrupted = { ...run, status: "interrupted" };
  assert.deepEqual(runDetails(interrupted, { employees, harnesses: [{ id: "codex" }], runs: [interrupted] }, now), { view: "diagnostics" });
  assert.deepEqual(runDetails(run, { employees: [], harnesses: [], runs: [] }, now), { view: "diagnostics" });
});

test("timestamps show the day when it isn't today, with the full date as a title", () => {
  const now = new Date(2026, 8, 29, 16, 30);
  const today = stamp(new Date(2026, 8, 29, 14, 2), now, "en-US");
  assert.match(today.label, /^02:02\sPM$/);
  assert.match(today.title, /Tuesday, September 29, 2026/);
  assert.match(stamp(new Date(2026, 8, 28, 9, 5), now, "en-US").label, /^Yesterday 09:05\sAM$/);
  assert.match(stamp(new Date(2026, 8, 26, 9, 5), now, "en-US").label, /^Sep 26, 09:05\sAM$/);
  assert.match(stamp(new Date(2025, 11, 31, 23, 59), now, "en-US").label, /^Dec 31, 2025, 11:59\sPM$/);
  // Yesterday across a month boundary.
  assert.match(stamp(new Date(2026, 8, 30, 23, 0), new Date(2026, 9, 1, 8, 0), "en-US").label, /^Yesterday /);
  assert.deepEqual(stamp("not a date", now), { label: "", title: "" });
});

test("elapsed time reads in seconds, minutes, then hours", () => {
  const start = "2026-09-29T12:00:00.000Z";
  const at = (seconds) => Date.parse(start) + seconds * 1000;
  assert.equal(elapsed(start, at(8)), "8s");
  assert.equal(elapsed(start, at(125)), "2m 05s");
  assert.equal(elapsed(start, at(3840)), "1h 04m");
  assert.equal(elapsed(start, at(-5)), "0s");
  assert.equal(elapsed("", at(5)), "");
});
