// The daily people review in the app (0.3.39): Org → People's rows, their
// sorting and trend, the words for a problem entry, and the wiring (the
// renderer's commands are allowlisted, styles use tokens).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describeIssue } from "../src/lib/diagnostics.js";
import { filterPeople, peopleRows, sortPeople, trendLabel, trendOf } from "../src/lib/people.js";

const employees = [
  { id: "a", name: "Atlas", role: "Chief of staff", archived: 0 },
  { id: "n", name: "Nova", role: "Director", archived: 0 },
  { id: "h", name: "Hana", role: "Editor", archived: 0 },
  { id: "x", name: "Gone", role: "Old", archived: 1 },
  { id: "z", name: "Zed", role: "New", archived: 0 },
];
const m = (extra = {}) => ({ runs: 0, ok: 0, botFailed: 0, reviews: 0, changes: 0, redo: 0, stops: 0, stuck: 0, costPerTask: null, ...extra });
const latest = {
  day: "2026-09-30",
  at: "2026-09-30T06:45:00.000Z",
  late: false,
  counts: { fire: 1, adjust: 1, watch: 0, ok: 1, insufficient: 1 },
  bots: [
    { id: "a", v: "ok", reasons: [], fix: null, notes: [], m: m({ runs: 30, ok: 30 }), d: { runs: 2 } },
    {
      id: "n",
      v: "adjust",
      was: "watch",
      reasons: [{ code: "failures", level: "adjust", detail: "timeout" }],
      fix: { kind: "effort", key: "failures.timeout" },
      notes: [],
      m: m({ runs: 20, ok: 10, botFailed: 10, costPerTask: 90_000 }),
      d: { runs: 1 },
    },
    {
      id: "h",
      v: "fire",
      reasons: [{ code: "fire", level: "fire", detail: "idle" }],
      fix: { kind: "manager", key: "fire.idle", detail: "n" },
      notes: ["idle"],
      m: m(),
      d: { runs: 0 },
    },
    { id: "x", v: "insufficient", reasons: [], fix: null, notes: [], m: m(), d: { runs: 0 } },
  ],
};

test("People rows: names from the roster, archived bots left out, new bots marked, words for reasons and fixes", () => {
  const rows = peopleRows(latest, employees);
  assert.deepEqual(rows.map((r) => r.id), ["a", "n", "h", "z"]);
  const nova = rows.find((r) => r.id === "n");
  assert.equal(nova.name, "Nova");
  assert.equal(nova.label, "Adjust");
  assert.equal(nova.was, "Watch");
  assert.equal(nova.failRate, 0.5);
  assert.equal(nova.failed, "10 of 20", "counts, not a bare percentage the verdict doesn't use");
  assert.equal(rows.find((r) => r.id === "h").failed, null);
  assert.match(nova.reasons[0], /10 of 20 runs failed/);
  assert.equal(nova.fix.kind, "Effort");
  const hana = rows.find((r) => r.id === "h");
  assert.match(hana.fix.text, /Nova covers the same role/);
  assert.match(hana.notes[0], /ran nothing in 14 days/);
  const zed = rows.find((r) => r.id === "z");
  assert.equal(zed.v, null);
  assert.equal(zed.label, "Not reviewed yet");
  assert.deepEqual(peopleRows(null, employees).map((r) => r.label), ["Not reviewed yet", "Not reviewed yet", "Not reviewed yet", "Not reviewed yet"]);
});

test("People rows sort by verdict (worst first), name, or a number with blanks last", () => {
  const rows = peopleRows(latest, employees);
  assert.deepEqual(sortPeople(rows, "verdict", "desc").map((r) => r.id), ["h", "n", "a", "z"]);
  assert.deepEqual(sortPeople(rows, "verdict", "asc").map((r) => r.id), ["z", "a", "n", "h"]);
  assert.deepEqual(sortPeople(rows, "name", "asc").map((r) => r.name), ["Atlas", "Hana", "Nova", "Zed"]);
  assert.deepEqual(sortPeople(rows, "failures", "desc").map((r) => r.id), ["n", "a", "h", "z"]);
  assert.deepEqual(sortPeople(rows, "cost", "desc").map((r) => r.id).slice(0, 1), ["n"]);
  assert.deepEqual(sortPeople(rows, "runs", "asc").map((r) => r.id), ["h", "n", "a", "z"], "not reviewed yet sorts last either way");
});

test("a bot's trend is its verdict on each of the last days, oldest first", () => {
  const history = [
    { day: "2026-09-30", verdicts: { n: "adjust" } },
    { day: "2026-09-29", verdicts: { n: "watch" } },
    { day: "2026-09-28", verdicts: {} },
  ];
  assert.deepEqual(trendOf(history, "n"), [
    { day: "2026-09-28", v: null },
    { day: "2026-09-29", v: "watch" },
    { day: "2026-09-30", v: "adjust" },
  ]);
});

test("the renderer's people commands are allowlisted, and their problems have words", async () => {
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  const allowlist = main.match(/const methods = new Set\(\[([\s\S]*?)\]\)/)[1];
  for (const method of ["people.review", "people.run", "people.set"]) assert.ok(allowlist.includes(`"${method}"`), method);
  for (const code of ["people.review_failed", "people.canvas_failed"]) {
    const issue = describeIssue({ code, context: {} });
    assert.notEqual(issue.title, code);
    assert.ok(issue.hint.length > 40);
  }
});

test("Org has a People tab, the Settings row is in place, and the styles use tokens only", async () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const org = await read("src/components/org/OrgPage.jsx");
  assert.match(org, /tab === "people"/);
  assert.match(org, /<PeopleTab/);
  const app = await read("src/App.jsx");
  assert.match(app, /<PeopleReviewSettings/);
  const css = await read("src/components/org/people.css");
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), "no hex colors");
  assert.ok(!/rgba?\(|hsla?\(/i.test(css), "no rgb or hsl colors");
  // The canvas names Any Bot's own edits.
  assert.match(await read("src/components/doc/ProjectDoc.jsx"), /"system" \? "Any Bot"/);
});

test("People rows filter by verdict, and a trend has words for screen readers", () => {
  const rows = peopleRows(latest, employees);
  assert.deepEqual(filterPeople(rows, "all").map((r) => r.id), ["a", "n", "h", "z"]);
  assert.deepEqual(filterPeople(rows, "adjust").map((r) => r.id), ["n"]);
  assert.deepEqual(filterPeople(rows, "fire").map((r) => r.id), ["h"]);
  assert.deepEqual(filterPeople(rows, "watch"), []);
  const days = trendOf(
    [
      { day: "2026-09-30", verdicts: { n: "adjust" } },
      { day: "2026-09-29", verdicts: { n: "watch" } },
      { day: "2026-09-28", verdicts: {} },
    ],
    "n",
  );
  assert.equal(trendLabel(days), "Last 3 reviews, oldest first: not reviewed, Watch, Adjust");
});

test("Org → People and the Settings row fetch again when a review runs, and say when they can't load", async () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const tab = await read("src/components/org/PeopleTab.jsx");
  assert.match(tab, /data\.people/, "the tab follows the snapshot's people stamp");
  assert.match(tab, /role="img"/);
  assert.match(tab, /aria-pressed/, "verdict filters");
  assert.match(tab, /outages don't count/);
  const settings = await read("src/components/PeopleReviewSettings.jsx");
  assert.match(settings, /stamp/);
  assert.match(settings, /Try again/, "a failed load keeps the card, with a way to retry");
  assert.match(settings, /onSubmit/, "Enter saves the time");
  assert.doesNotMatch(settings, /if \(!state\) return null/);
  assert.match(await read("src/App.jsx"), /<PeopleReviewSettings stamp=/);
});
