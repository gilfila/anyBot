// The daily people review (0.3.39): a read-only breakdown of which bots need
// adjusting, and which might be let go, from what's already in the database
// (no tokens). The pure metrics and verdict table first, then the daily job
// in the coordinator: once a local day at a set time, caught up at the next
// start, the HQ canvas section, its commands and what it stores.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import {
  DEFAULT_SETTINGS,
  FIXES,
  FIX_KINDS,
  FIX_LABELS,
  MIN_SAMPLE,
  RULES,
  applyPeopleSettings,
  buildReview,
  dayKey,
  dueSlot,
  fixWords,
  outcomeOf,
  peopleSettings,
  reasonWords,
  sectionBlocks,
  totalsLine,
  wilsonLower,
} from "../runtime/people-review.mjs";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Local noon, so days and slots are the computer's own, as in the app.
const NOW = new Date(2026, 8, 30, 12, 0, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();
const bot = (id, extra = {}) => ({
  id,
  role: `${id} writer`,
  harness: "claude",
  model: "opus",
  effort: "high",
  manager: "",
  created: iso(NOW - 60 * DAY),
  ...extra,
});
let seq = 0;
const runs = (employee, n, { cls = "ok", code, lane = "owner", candidate = false, idle = false, ago = HOUR, tokens = 0 } = {}) =>
  Array.from({ length: n }, () => ({ id: `r${++seq}`, employee, cls, code, created: iso(NOW - ago), started: iso(NOW - ago), lane, candidate, idle, tokens }));
const rows = (extra = {}) => ({
  now: NOW,
  team: "off",
  bots: [],
  runs: [],
  taskEvents: [],
  finishedTasks: [],
  stuck: [],
  approvals: [],
  stops: [],
  adjustments: [],
  assigned: [],
  starved: [],
  ...extra,
});
const of = (review, id) => review.bots.find((b) => b.id === id);
const codes = (entry) => entry.reasons.map((r) => r.code);
const events = (lead, type, n, by = "bot") => Array.from({ length: n }, (_, i) => ({ task: `t-${lead}-${type}-${i}`, lead, type, by, at: iso(NOW - HOUR) }));
const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i));

// Pure: outcomes, rates and the verdict table ----------------------------------

test("run outcomes: outages and Any Bot stopping are the environment's, an unexplained exit is unclear", () => {
  assert.deepEqual(outcomeOf("succeeded", ""), { cls: "ok" });
  assert.deepEqual(outcomeOf("failed", "Claude AI usage limit reached|1759152000"), { cls: "env", code: "usage_limit" });
  assert.deepEqual(outcomeOf("failed", "Not logged in · Please run /login"), { cls: "env", code: "auth" });
  assert.deepEqual(outcomeOf("failed", "spawn claude ENOENT"), { cls: "env", code: "launch" });
  assert.deepEqual(outcomeOf("interrupted", "Any Bot stopped during this run"), { cls: "env", code: "interrupted" });
  assert.deepEqual(outcomeOf("failed", "Run exceeded its configured 10-minute time limit"), { cls: "bot", code: "timeout" });
  assert.deepEqual(outcomeOf("failed", "Harness exited with code 1"), { cls: "unclear", code: "exit" });
  assert.deepEqual(outcomeOf("cancelled", "Run cancelled"), { cls: "cancelled" });
  assert.deepEqual(outcomeOf("queued", ""), { cls: "queued" });
});

test("rates are judged by their Wilson lower bound, never below the minimum sample", () => {
  assert.equal(MIN_SAMPLE, 10);
  assert.equal(wilsonLower(0, 0), 0);
  assert.equal(wilsonLower(10, 20).toFixed(3), "0.299");
  assert.equal(wilsonLower(6, 18).toFixed(3), "0.163");
  assert.ok(wilsonLower(5, 5) < 0.6, "5 of 5 is still uncertain");
});

test("usage limits and sign-in failures never count against a bot; its own timeouts do", () => {
  const review = buildReview(
    rows({
      bots: [bot("a"), bot("b")],
      runs: [
        ...runs("a", 10),
        ...runs("a", 10, { cls: "env", code: "usage_limit" }),
        ...runs("a", 5, { cls: "env", code: "auth" }),
        ...runs("b", 10),
        ...runs("b", 10, { cls: "bot", code: "timeout" }),
      ],
    }),
  );
  const a = of(review, "a");
  assert.equal(a.v, "ok");
  assert.equal(a.m.envFailed, 15);
  assert.equal(a.m.botFailed, 0);
  assert.deepEqual(a.reasons, []);
  assert.equal(a.fix, null);
  const b = of(review, "b");
  assert.equal(b.v, "adjust");
  assert.deepEqual(b.reasons[0], { code: "failures", level: "adjust", detail: "timeout" });
  assert.deepEqual(b.fix, { kind: "effort", key: "failures.timeout" });
  assert.deepEqual(review.counts, { fire: 0, adjust: 1, watch: 0, ok: 1, insufficient: 0 });
});

test("an unexplained exit is left out of the failure rate", () => {
  const review = buildReview(rows({ bots: [bot("a")], runs: [...runs("a", 10), ...runs("a", 10, { cls: "unclear", code: "exit" })] }));
  assert.equal(of(review, "a").v, "ok");
  assert.equal(of(review, "a").m.unclear, 10);
});

test("thin data is Not enough data, never a flag: 3 failures in 5 runs, or 9 clean runs", () => {
  const review = buildReview(
    rows({
      bots: [bot("c"), bot("d"), bot("e")],
      runs: [...runs("c", 2), ...runs("c", 3, { cls: "bot", code: "timeout" }), ...runs("d", 9), ...runs("e", 10)],
    }),
  );
  assert.equal(of(review, "c").v, "insufficient");
  assert.deepEqual(of(review, "c").reasons, []);
  assert.equal(of(review, "d").v, "insufficient");
  assert.equal(of(review, "e").v, "ok");
});

test("Watch and Adjust follow the table: 6 of 18 is Watch, 10 of 20 is Adjust", () => {
  const review = buildReview(
    rows({
      bots: [bot("w"), bot("x")],
      runs: [...runs("w", 12), ...runs("w", 6, { cls: "bot", code: "output_limit" }), ...runs("x", 10), ...runs("x", 10, { cls: "bot", code: "no_response" })],
    }),
  );
  assert.equal(of(review, "w").v, "watch");
  assert.deepEqual(of(review, "w").fix, { kind: "instructions", key: "failures.output_limit" });
  assert.equal(of(review, "x").v, "adjust");
  assert.deepEqual(of(review, "x").fix, { kind: "harness", key: "failures.no_response" });
});

test("cost per finished task is compared only with 3 or more peers on the same harness, model and effort", () => {
  const done = (lead, tokens) => repeat(3, (i) => ({ task: `${lead}-${i}`, lead, tokens, at: iso(NOW - HOUR) }));
  const review = buildReview(
    rows({
      bots: [
        bot("p1"),
        bot("p2"),
        bot("p3"),
        bot("x"),
        bot("y", { effort: "low" }),
        bot("z1", { harness: "codex", model: "gpt", effort: "medium" }),
        bot("z2", { harness: "codex", model: "gpt", effort: "medium" }),
        bot("z3", { harness: "codex", model: "gpt", effort: "medium" }),
      ],
      finishedTasks: [
        ...done("p1", 100_000),
        ...done("p2", 100_000),
        ...done("p3", 100_000),
        ...done("x", 300_000),
        ...done("y", 300_000),
        ...done("z1", 100_000),
        ...done("z2", 100_000),
        ...done("z3", 300_000),
      ],
    }),
  );
  const x = of(review, "x");
  assert.equal(x.v, "adjust");
  assert.deepEqual(codes(x), ["cost"]);
  assert.equal(x.m.costPerTask, 300_000);
  assert.equal(x.m.peerMedian, 100_000);
  assert.deepEqual(x.fix, { kind: "effort", key: "cost" });
  assert.equal(of(review, "p1").v, "ok", "a peer at the median is fine");
  assert.equal(of(review, "y").v, "insufficient", "a different effort isn't a peer");
  assert.equal(of(review, "z3").v, "insufficient", "two peers aren't enough");
});

test("reviews sent back: 5 of 10 is Watch, 8 of 10 Adjust, 2 of 3 too few; a task at the review limit is Watch", () => {
  const review = buildReview(
    rows({
      bots: [bot("l1"), bot("l2"), bot("l3"), bot("l4")],
      runs: [...runs("l4", 10)],
      taskEvents: [
        ...events("l1", "approved", 5),
        ...events("l1", "changes", 5),
        ...events("l2", "approved", 2),
        ...events("l2", "changes", 8),
        ...events("l3", "approved", 1),
        ...events("l3", "changes", 2),
        ...events("l4", "cap", 1),
      ],
    }),
  );
  assert.equal(of(review, "l1").v, "watch");
  assert.equal(of(review, "l2").v, "adjust");
  assert.deepEqual(of(review, "l2").fix, { kind: "effort", key: "rejections" });
  assert.equal(of(review, "l3").v, "insufficient");
  assert.equal(of(review, "l4").v, "watch");
  assert.deepEqual(codes(of(review, "l4")), ["reviewCap"]);
});

test("redo: your Request changes and Stops, out of its runs", () => {
  const review = buildReview(
    rows({
      bots: [bot("r"), bot("s")],
      runs: [...runs("r", 10), ...runs("s", 20)],
      stops: [...repeat(3, () => ({ employee: "r", at: iso(NOW - HOUR) })), { employee: "s", at: iso(NOW - HOUR) }],
      taskEvents: events("r", "changes", 3, "owner"),
    }),
  );
  const r = of(review, "r");
  assert.equal(r.m.redo, 6);
  assert.equal(r.v, "adjust");
  assert.deepEqual(codes(r), ["redo"]);
  assert.deepEqual(r.fix, { kind: "instructions", key: "redo" });
  assert.equal(of(review, "s").v, "ok");
});

test("declined tool requests: 3 is Watch, a high share of 10 or more is Adjust, expired never counts", () => {
  const asks = (employee, status, n) => repeat(n, () => ({ employee, status, at: iso(NOW - HOUR) }));
  const review = buildReview(
    rows({
      bots: [bot("d1"), bot("d2"), bot("d3")],
      runs: [...runs("d1", 10), ...runs("d2", 10), ...runs("d3", 10)],
      approvals: [...asks("d1", "denied", 3), ...asks("d1", "approved", 1), ...asks("d2", "denied", 9), ...asks("d2", "approved", 3), ...asks("d3", "expired", 20)],
    }),
  );
  assert.equal(of(review, "d1").v, "watch");
  assert.deepEqual(codes(of(review, "d1")), ["denials"]);
  assert.equal(of(review, "d2").v, "adjust");
  assert.equal(of(review, "d3").v, "ok");
  assert.equal(of(review, "d3").m.expired, 20);
});

test("stuck cards, busywork and a folder it can't start in are Watch, each with its own fix", () => {
  const review = buildReview(
    rows({
      bots: [bot("st"), bot("one"), bot("bw"), bot("own"), bot("ln")],
      runs: [
        ...runs("st", 10),
        ...runs("one", 10),
        // Reviews and turns another bot started are the runs that can be busywork.
        ...runs("bw", 2, { lane: "autonomous", candidate: true }),
        ...runs("bw", 10, { lane: "autonomous", candidate: true, idle: true }),
        // Task and routine runs aren't candidates, so they don't dilute it.
        ...runs("bw", 30, { lane: "autonomous" }),
        ...runs("own", 12, { candidate: true, idle: true }),
        ...runs("ln", 10),
        ...runs("ln", 3, { cls: "env", code: "launch" }),
      ],
      stuck: [
        { employee: "st", task: "t1", type: "in_progress" },
        { employee: "st", task: "t2", type: "review" },
        { employee: "one", task: "t3", type: "in_progress" },
      ],
    }),
  );
  assert.deepEqual(codes(of(review, "st")), ["stuck"]);
  assert.equal(of(review, "st").fix.kind, "manager");
  assert.equal(of(review, "one").v, "ok");
  assert.deepEqual(codes(of(review, "bw")), ["busywork"]);
  assert.equal(of(review, "bw").fix.kind, "instructions");
  assert.equal(of(review, "own").v, "ok", "work you asked for is never busywork");
  assert.deepEqual(codes(of(review, "ln")), ["launch"]);
  assert.equal(of(review, "ln").fix.kind, "workspace");
});

test("a bot adjusted in the last 7 days is held at Watch", () => {
  const review = buildReview(
    rows({
      bots: [bot("a")],
      runs: [...runs("a", 10), ...runs("a", 10, { cls: "bot", code: "timeout" })],
      adjustments: [{ employee: "a", at: iso(NOW - 3 * DAY) }],
    }),
  );
  const a = of(review, "a");
  assert.equal(a.v, "watch");
  assert.equal(a.raw, "adjust");
  assert.ok(a.notes.includes("cooldown"));
});

// Fire candidates -----------------------------------------------------------------

const back = (i) => dayKey(new Date(2026, 8, 30 - i, 12).getTime());
const history = (days, entry, team = "off") =>
  days.map((i) => ({ day: back(i), at: iso(new Date(2026, 8, 30 - i, 6, 45).getTime()), team, bots: [entry(i)] }));
const DAYS_13 = Array.from({ length: 13 }, (_, i) => i + 1);

test("a threshold alone never makes a fire candidate", () => {
  const review = buildReview(rows({ bots: [bot("f")], runs: runs("f", 20, { cls: "bot", code: "timeout" }) }));
  assert.equal(of(review, "f").v, "adjust");
});

test("fire candidate: Adjust for 14 days, and an adjustment 7 or more days ago didn't help by 25%", () => {
  const today = () => rows({ bots: [bot("f")], runs: [...runs("f", 5), ...runs("f", 15, { cls: "bot", code: "timeout" })] });
  const adjusted = (score) => history(DAYS_13, () => ({ id: "f", v: "adjust", raw: "adjust", code: "failures", score, idle: false }));
  const fired = buildReview({ ...today(), adjustments: [{ employee: "f", at: iso(NOW - 8 * DAY) }] }, { history: adjusted(0.6) });
  const f = of(fired, "f");
  assert.equal(f.v, "fire");
  assert.deepEqual(f.reasons[0], { code: "fire", level: "fire", detail: "adjusted" });
  assert.deepEqual(f.fix, { kind: "manager", key: "fire.adjusted" });
  // It helped (0.9 → 0.53): Adjust, not fire.
  assert.equal(of(buildReview({ ...today(), adjustments: [{ employee: "f", at: iso(NOW - 8 * DAY) }] }, { history: adjusted(0.9) }), "f").v, "adjust");
  // Never adjusted: still Adjust.
  assert.equal(of(buildReview(today(), { history: adjusted(0.6) }), "f").v, "adjust");
  // A day missing from the 14: not persisted.
  const gap = adjusted(0.6).filter((h) => h.day !== back(5));
  assert.equal(of(buildReview({ ...today(), adjustments: [{ employee: "f", at: iso(NOW - 8 * DAY) }] }, { history: gap }), "f").v, "adjust");
  // Adjusted again 3 days ago: held at Watch while that settles.
  const recent = buildReview(
    { ...today(), adjustments: [{ employee: "f", at: iso(NOW - 8 * DAY) }, { employee: "f", at: iso(NOW - 3 * DAY) }] },
    { history: adjusted(0.6) },
  );
  assert.equal(of(recent, "f").v, "watch");
});

test("idle is a fire candidate only with Team on, assigned work, 14 idle days and a teammate in the same role", () => {
  const team = [bot("m", { role: "director" }), bot("g", { role: "video editor", manager: "m" }), bot("h", { role: "video editor", manager: "m" })];
  const idleDays = (days, teamState = "running") => history(days, () => ({ id: "g", v: "insufficient", raw: "insufficient", idle: true }), teamState);
  const base = (extra = {}) => rows({ bots: team, team: "running", runs: runs("h", 3), assigned: ["g"], ...extra });
  const fired = of(buildReview(base(), { history: idleDays(DAYS_13) }), "g");
  assert.equal(fired.v, "fire");
  assert.deepEqual(fired.fix, { kind: "manager", key: "fire.idle", detail: "h" });
  assert.equal(fired.idle, true);
  // Team off in its rooms: idle isn't counted at all.
  const off = of(buildReview(base({ team: "off" }), { history: idleDays(DAYS_13) }), "g");
  assert.notEqual(off.v, "fire");
  assert.equal(off.idle, false);
  assert.ok(off.notes.includes("team-off"));
  // No assigned work.
  const unassigned = of(buildReview(base({ assigned: [] }), { history: idleDays(DAYS_13) }), "g");
  assert.notEqual(unassigned.v, "fire");
  assert.ok(unassigned.notes.includes("not-scheduled"));
  // Thin history.
  assert.notEqual(of(buildReview(base(), { history: idleDays([1, 2, 3, 4, 5]) }), "g").v, "fire");
  // Held by limits: a capacity note, not held against it.
  const starved = of(buildReview(base({ starved: ["g"] }), { history: idleDays(DAYS_13) }), "g");
  assert.notEqual(starved.v, "fire");
  assert.ok(starved.notes.includes("starved"));
  // Team was off on those days.
  assert.notEqual(of(buildReview(base(), { history: idleDays(DAYS_13, "off") }), "g").v, "fire");
  // No teammate in the same role.
  const alone = [bot("m", { role: "director" }), bot("g", { role: "video editor", manager: "m" }), bot("h", { role: "finance clerk", manager: "m" })];
  assert.notEqual(of(buildReview(base({ bots: alone }), { history: idleDays(DAYS_13) }), "g").v, "fire");
});

// The table, words, settings and slots ------------------------------------------

test("one table holds every rule, with its minimum data, thresholds, reason and fix", () => {
  const known = ["failures", "cost", "rejections", "reviewCap", "rubberStamp", "redo", "denials", "stuck", "busywork", "launch"];
  assert.deepEqual(RULES.map((r) => r.code), known);
  for (const rule of RULES) {
    for (const field of ["label", "counts", "min", "watch", "adjust", "why"]) assert.equal(typeof rule[field], "string", `${rule.code}.${field}`);
    assert.ok(rule.why.length > 20, `${rule.code} says why`);
  }
  for (const [key, fix] of Object.entries(FIXES)) {
    assert.ok(FIX_KINDS.includes(fix.kind), `${key} has a known kind`);
    assert.ok(fix.text.length > 10);
  }
  assert.deepEqual(FIX_KINDS, ["instructions", "model", "effort", "harness", "manager", "workspace"]);
  // Every reason has words, and every fix a sentence.
  const m = { ok: 10, botFailed: 5, costPerTask: 300_000, peerMedian: 100_000, reviews: 10, changes: 5, caps: 1, redo: 6, stops: 3, denied: 3, approved: 1, stuck: 2, idleRuns: 10, unattended: 12, launch: 3, asReviewer: 10, reopened: 1, requestsToday: 21 };
  for (const code of known) assert.ok(reasonWords({ code, level: "watch", detail: "timeout" }, m).length > 10, code);
  assert.match(reasonWords({ code: "fire", level: "fire", detail: "idle" }, m), /14 days/);
  assert.match(fixWords({ kind: "manager", key: "fire.idle", detail: "h" }, (id) => (id === "h" ? "Hana" : id)), /Hana/);
});

test("settings: on at 06:45 by default; a time must be HH:MM", () => {
  assert.deepEqual(DEFAULT_SETTINGS, { enabled: true, at: "06:45" });
  assert.deepEqual(peopleSettings(undefined), { enabled: true, at: "06:45", lastSlot: null });
  assert.deepEqual(peopleSettings('{"enabled":false,"at":"07:30","lastSlot":5}'), { enabled: false, at: "07:30", lastSlot: 5 });
  assert.equal(peopleSettings('{"at":"25:00"}').at, "06:45");
  assert.equal(peopleSettings("not json").enabled, true);
  const s = peopleSettings(undefined);
  assert.throws(() => applyPeopleSettings(s, { at: "7:5" }), /time/);
  assert.throws(() => applyPeopleSettings(s, { enabled: "yes" }), /on or off/);
  assert.equal(applyPeopleSettings(s, { at: "7:05" }).at, "07:05");
  assert.deepEqual(applyPeopleSettings(s, { enabled: false }), { enabled: false, at: "06:45", lastSlot: null });
});

test("the due slot is the latest time the clock passed; days are local", () => {
  const before = new Date(2026, 8, 30, 6, 44).getTime();
  assert.equal(dueSlot(before, "06:45"), new Date(2026, 8, 29, 6, 45).getTime());
  assert.equal(dueSlot(before + 60_000, "06:45"), new Date(2026, 8, 30, 6, 45).getTime());
  assert.equal(dayKey(new Date(2026, 8, 30, 23, 59).getTime()), "2026-09-30");
  assert.equal(dayKey(new Date(2026, 9, 1, 0, 1).getTime()), "2026-10-01");
});

test("the canvas section: a totals line, then a table of flagged bots with names, reasons and fixes", () => {
  const review = buildReview(
    rows({ bots: [bot("a"), bot("b")], runs: [...runs("a", 10), ...runs("b", 10), ...runs("b", 10, { cls: "bot", code: "timeout" })] }),
  );
  const people = { a: { name: "Ava", manager: "" }, b: { name: "Bo", manager: "Atlas" } };
  const blocks = sectionBlocks(review, people);
  assert.equal(blocks[0].type, "p");
  assert.match(blocks[0].text, /1 OK · 0 Watch · 1 Adjust · 0 Fire candidates · 0 Not enough data/);
  const table = blocks.find((b) => b.type === "table");
  assert.deepEqual(table.rows[0], ["Bot", "Manager", "Verdict", "Why", "Suggested fix"]);
  assert.equal(table.rows.length, 2, "only flagged bots are listed");
  assert.equal(table.rows[1][0], "Bo");
  assert.equal(table.rows[1][1], "Atlas");
  assert.equal(table.rows[1][2], "Adjust");
  assert.match(table.rows[1][3], /10 of 20 runs failed/);
  assert.match(table.rows[1][4], /^Effort: /);
  assert.ok(!JSON.stringify(blocks).includes('"b"'), "names, never ids");
  // A bot held at Watch after a change says so.
  const held = buildReview(
    rows({ bots: [bot("b")], runs: [...runs("b", 10), ...runs("b", 10, { cls: "bot", code: "timeout" })], adjustments: [{ employee: "b", at: iso(NOW - DAY) }] }),
  );
  assert.match(sectionBlocks(held, people).find((b) => b.type === "table").rows[1][3], /held at Watch/);
  const clean = sectionBlocks(buildReview(rows({ bots: [bot("a")], runs: runs("a", 10) })), people);
  assert.ok(!clean.some((b) => b.type === "table"));
  assert.ok(clean.some((b) => /No bot needs attention/.test(b.text)));
});

// The daily job in the coordinator ---------------------------------------------------

async function office(t, { clock, runner = async () => "ok", directory } = {}) {
  const dir = directory || (await mkdtemp(join(tmpdir(), "anybot-people-")));
  const attention = [];
  const diagnostics = [];
  const c = new Coordinator({ directory: dir, probe: async () => [], runner, ...(clock ? { clock } : {}) });
  clearInterval(c.timer); // only the test's own ticks
  c.on("attention", (entry) => attention.push(entry));
  c.on("diagnostic", (entry) => diagnostics.push(entry));
  t.after(async () => {
    if (!c.closed) await c.close();
    if (!directory) await rm(dir, { recursive: true, force: true });
  });
  await c.initialize();
  const hire = async (name, extra = {}) => {
    await c.command("employees.create", { name, role: name, harness: "claude", trusted: true, ...extra });
    return c.snapshot().employees.find((e) => e.name === name);
  };
  const room = async (title, members) => {
    await c.command("conversations.create", { title, members: members.map((m) => m.id) });
    return c.snapshot().conversations.at(-1);
  };
  return { c, dir, attention, diagnostics, hire, room };
}
// A finished run, placed in time (created, started and ended at `at`).
function insertRun(c, { employee, conversation, status = "succeeded", error = "", at, body = "lorem ipsum", author = "human", kind = "user" }) {
  const message = c.addMessage(conversation, author, kind, body);
  const run = c.addRun(conversation, employee, message, null, null, 0, null, null);
  const stamp = iso(at);
  c.store.run("UPDATE runs SET status=?,error=?,created=?,started=?,ended=? WHERE id=?", status, error, stamp, stamp, stamp, run);
  return run;
}
const metadata = (c, prefix) => c.store.all("SELECT key,value FROM metadata WHERE substr(key,1,?)=? ORDER BY key", prefix.length, prefix);
const TIMEOUT = "Run exceeded its configured 10-minute time limit";

test("people.review, people.run and people.set answer with the settings, the latest review and its history", async (t) => {
  const { c, hire } = await office(t);
  const fresh = await c.command("people.review");
  assert.equal(fresh.settings.enabled, true);
  assert.equal(fresh.settings.at, "06:45");
  assert.equal(typeof fresh.settings.next, "number");
  assert.equal(fresh.latest, null);
  assert.deepEqual(fresh.history, []);
  const nova = await hire("Nova");
  const old = await hire("Old");
  await c.command("employees.setArchived", { id: old.id, revision: old.revision, archived: true });
  const ran = await c.command("people.run");
  assert.equal(ran.latest.manual, true);
  assert.equal(ran.latest.day, dayKey(Date.now()));
  assert.deepEqual(ran.latest.bots.map((b) => b.id), [nova.id], "archived bots aren't reviewed");
  assert.equal(ran.latest.counts.insufficient, 1);
  assert.equal(ran.history.length, 1);
  assert.deepEqual(Object.keys(ran.history[0]).sort(), ["at", "counts", "day", "late", "manual", "verdicts"]);
  assert.deepEqual(ran.history[0].verdicts, { [nova.id]: "insufficient" });
  await assert.rejects(c.command("people.set", { at: "7:5" }), /time/);
  await assert.rejects(c.command("people.set", { enabled: 1 }), /on or off/);
  assert.equal((await c.command("people.set", { at: "18:30" })).settings.at, "18:30");
  const off = await c.command("people.set", { enabled: false });
  assert.equal(off.settings.enabled, false);
  assert.equal(off.settings.next, null);
  assert.equal((await c.command("people.review")).latest.day, ran.latest.day);
});

test("outages in the database don't count against a bot; its own timeouts in the last 14 days do", async (t) => {
  const { c, hire, room } = await office(t);
  const ava = await hire("Ava");
  const bo = await hire("Bo");
  const desk = await room("Desk", [ava, bo]);
  const hourAgo = Date.now() - HOUR;
  c.store.transaction(() => {
    for (let i = 0; i < 10; i++) {
      insertRun(c, { employee: ava.id, conversation: desk.id, at: hourAgo });
      insertRun(c, { employee: ava.id, conversation: desk.id, status: "failed", error: "Claude AI usage limit reached|1759152000", at: hourAgo });
      insertRun(c, { employee: bo.id, conversation: desk.id, at: hourAgo });
      insertRun(c, { employee: bo.id, conversation: desk.id, status: "failed", error: TIMEOUT, at: hourAgo });
    }
    // Older than the 14-day window.
    for (let i = 0; i < 20; i++) insertRun(c, { employee: bo.id, conversation: desk.id, status: "failed", error: TIMEOUT, at: Date.now() - 20 * DAY });
  });
  const { latest } = await c.command("people.run");
  const a = latest.bots.find((b) => b.id === ava.id);
  assert.equal(a.v, "ok");
  assert.equal(a.m.envFailed, 10);
  assert.equal(a.m.botFailed, 0);
  const b = latest.bots.find((x) => x.id === bo.id);
  assert.equal(b.v, "adjust");
  assert.equal(b.m.botFailed, 10);
  assert.equal(b.m.runs, 20);
  assert.equal(b.fix.kind, "effort");
});

test("busywork from the database: turns another bot started that left no trace, never your own work", async (t) => {
  const { c, hire, room } = await office(t);
  const ava = await hire("Ava");
  const bo = await hire("Bo");
  const desk = await room("Desk", [ava, bo]);
  const traced = [];
  c.store.transaction(() => {
    for (let i = 0; i < 10; i++) {
      // Ava's reply mentioned Bo: a turn nobody at the desk started.
      const run = insertRun(c, { employee: bo.id, conversation: desk.id, author: ava.id, kind: "assistant", at: Date.now() - HOUR });
      if (i < 2) traced.push(run);
    }
    // Two of them edited the canvas; the rest changed nothing.
    for (const run of traced) c.store.event("doc.updated", { conversation: desk.id, author: bo.id, run });
    // Your own messages that changed nothing are just answers.
    for (let i = 0; i < 12; i++) insertRun(c, { employee: ava.id, conversation: desk.id, at: Date.now() - HOUR });
  });
  const { latest } = await c.command("people.run");
  const b = latest.bots.find((x) => x.id === bo.id);
  assert.equal(b.m.unattended, 10);
  assert.equal(b.m.idleRuns, 8);
  assert.deepEqual(b.reasons.map((r) => r.code), ["busywork"]);
  const a = latest.bots.find((x) => x.id === ava.id);
  assert.equal(a.m.unattended, 0);
  assert.equal(a.v, "ok");
});

test("stuck cards from the database: over a day with nothing running, unless an outage left them there", async (t) => {
  const { c, hire, room } = await office(t);
  const lead = await hire("Lead");
  const rev = await hire("Rev");
  const desk = await room("Desk", [lead, rev]);
  const card = async (title, status, lastError) => {
    await c.command("tasks.create", { conversation: desk.id, title, assignees: [lead.id], reviewer: rev.id });
    const task = c.snapshot().tasks.find((x) => x.title === title);
    const message = c.addMessage(desk.id, "system", "task", "lorem");
    const run = c.addRun(desk.id, status === "review" ? rev.id : lead.id, message, null, null, 0, task.id, null);
    const old = iso(Date.now() - 2 * DAY);
    c.store.run("UPDATE runs SET status='failed',error=?,created=?,started=?,ended=? WHERE id=?", lastError, old, old, old, run);
    c.store.run("UPDATE tasks SET status=?,updated=? WHERE id=?", status, old, task.id);
  };
  await card("Stalled", "in_progress", TIMEOUT);
  await card("Outage", "in_progress", "Claude AI usage limit reached|1759152000");
  await card("Waiting review", "review", TIMEOUT);
  await card("Review after outage", "review", "Not logged in · Please run /login");
  const { latest } = await c.command("people.run");
  assert.equal(latest.bots.find((b) => b.id === lead.id).m.stuck, 1);
  assert.equal(latest.bots.find((b) => b.id === rev.id).m.stuck, 1);
});

test("what the review stores holds ids, counts and codes: no names, message text or error text", async (t) => {
  const { c, hire, room } = await office(t);
  const ava = await hire("Avalon");
  const bo = await hire("Bodhi", { manager: ava.id });
  const desk = await room("Desk", [ava, bo]);
  c.store.transaction(() => {
    for (let i = 0; i < 12; i++) {
      insertRun(c, { employee: bo.id, conversation: desk.id, at: Date.now() - HOUR, body: "lorem SECRET-BODY-7" });
      insertRun(c, { employee: bo.id, conversation: desk.id, status: "failed", error: "Harness exited: SECRET-ERR-9", at: Date.now() - HOUR });
    }
  });
  await c.command("people.run");
  const stored = JSON.stringify(metadata(c, "people."));
  assert.ok(stored.includes(bo.id));
  for (const secret of ["SECRET-BODY-7", "SECRET-ERR-9", "Avalon", "Bodhi", "Desk", "lorem"]) assert.ok(!stored.includes(secret), secret);
});

test("the HQ canvas gets one People review section, replaced each time, never appended", async (t) => {
  const { c, hire, room } = await office(t);
  const atlas = await hire("Atlas");
  const nova = await hire("Nova", { manager: atlas.id });
  const mara = await hire("Mara", { manager: atlas.id });
  const jim = await hire("Jim");
  const hq = await room("HQ", [atlas, jim, nova, mara]);
  const studio = await room("Studio", [nova, mara]);
  await c.command("docs.save", { conversation: hq.id, revision: 0, blocks: [{ type: "h2", text: "Goals" }, { type: "p", text: "Ship it" }] });
  await c.command("people.run");
  let doc = await c.command("docs.get", { conversation: hq.id });
  const headings = (d) => d.blocks.filter((b) => b.type.startsWith("h") && b.text === "People review").length;
  assert.equal(headings(doc), 1);
  assert.equal(doc.updatedBy, "system");
  assert.ok(doc.blocks.some((b) => b.text === "Ship it"), "the owner's own canvas stays");
  assert.ok(doc.blocks.some((b) => /Not enough data/.test(b.text)));
  const size = doc.blocks.length;
  await c.command("people.run");
  doc = await c.command("docs.get", { conversation: hq.id });
  assert.equal(headings(doc), 1);
  assert.equal(doc.blocks.length, size);
  assert.equal((await c.command("docs.get", { conversation: studio.id })).revision, 0, "other rooms are left alone");
});

test("the section isn't written into the top bot's direct chat, nor without an org", async (t) => {
  const { c, hire } = await office(t);
  const atlas = await hire("Atlas");
  await hire("Nova", { manager: atlas.id });
  await c.command("people.run");
  // Its direct chat is where Slack and Buzz reach it, and every run there reads the canvas.
  assert.ok(!c.directConversationId(atlas.id), "no direct chat is created for it");
  assert.deepEqual(c.snapshot().docs, []);

  const other = await office(t);
  const ava = await other.hire("Ava");
  const bo = await other.hire("Bo");
  const desk = await other.room("Desk", [ava, bo]);
  await other.c.command("people.run");
  assert.equal((await other.c.command("docs.get", { conversation: desk.id })).revision, 0);
  assert.deepEqual(other.c.snapshot().docs, []);
});

test("the daily job runs once a local day at its time, armed the first time it's seen", async (t) => {
  let clock = new Date(2026, 9, 5, 6, 0).getTime();
  const { c } = await office(t, { clock: () => clock });
  const reviews = async () => (await c.command("people.review")).history.length;
  c.tick();
  assert.equal(await reviews(), 0, "a new install waits for the next 06:45");
  assert.equal(JSON.parse(metadata(c, "people.review")[0].value).lastSlot, new Date(2026, 9, 4, 6, 45).getTime());
  clock = new Date(2026, 9, 5, 6, 44, 59).getTime();
  c.tick();
  assert.equal(await reviews(), 0);
  clock = new Date(2026, 9, 5, 6, 45).getTime();
  c.tick();
  const first = (await c.command("people.review")).latest;
  assert.equal(first.day, "2026-10-05");
  assert.equal(first.late, false);
  assert.equal(first.manual, false);
  for (const [h, m] of [[7, 0], [12, 0], [23, 59]]) {
    clock = new Date(2026, 9, 5, h, m).getTime();
    c.tick();
  }
  assert.equal(await reviews(), 1);
  // Moving the time later the same day doesn't run it twice that day.
  await c.command("people.set", { at: "08:00" });
  clock = new Date(2026, 9, 5, 23, 0).getTime();
  c.tick();
  assert.equal(await reviews(), 1);
  clock = new Date(2026, 9, 6, 8, 0, 10).getTime();
  c.tick();
  assert.equal(await reviews(), 2);
  assert.equal((await c.command("people.review")).latest.day, "2026-10-06");
});

test("a missed review is caught up at the next start, once, marked late", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-people-"));
  const clock = new Date(2026, 9, 7, 10, 0).getTime();
  const first = await office(t, { clock: () => clock, directory });
  await first.hire("Nova");
  first.c.store.run(
    "INSERT OR REPLACE INTO metadata(key,value) VALUES ('people.review', ?)",
    JSON.stringify({ enabled: true, at: "06:45", lastSlot: new Date(2026, 9, 5, 6, 45).getTime() }),
  );
  await first.c.close();
  const again = await office(t, { clock: () => clock, directory });
  // After hooks run in order: both coordinators close before the folder goes.
  t.after(() => rm(directory, { recursive: true, force: true }));
  again.c.tick();
  again.c.tick();
  const { latest, history } = await again.c.command("people.review");
  assert.equal(history.length, 1);
  assert.equal(latest.day, "2026-10-07");
  assert.equal(latest.late, true);
  assert.equal(JSON.parse(metadata(again.c, "people.review")[0].value).lastSlot, new Date(2026, 9, 7, 6, 45).getTime());
});

test("switched off, the daily job doesn't run", async (t) => {
  let clock = new Date(2026, 9, 5, 6, 0).getTime();
  const { c } = await office(t, { clock: () => clock });
  c.tick();
  await c.command("people.set", { enabled: false });
  clock = new Date(2026, 9, 5, 6, 46).getTime();
  c.tick();
  assert.equal((await c.command("people.review")).history.length, 0);
});

test("an alert only when a bot is newly Adjust or a fire candidate, and never for Run now", async (t) => {
  let clock = new Date(2026, 9, 5, 6, 0).getTime();
  const { c, hire, room, attention } = await office(t, { clock: () => clock });
  const bo = await hire("Bo");
  const ava = await hire("Ava");
  const desk = await room("Desk", [bo, ava]);
  c.store.transaction(() => {
    for (let i = 0; i < 10; i++) {
      insertRun(c, { employee: bo.id, conversation: desk.id, at: clock - HOUR });
      insertRun(c, { employee: bo.id, conversation: desk.id, status: "failed", error: TIMEOUT, at: clock - HOUR });
    }
  });
  c.tick(); // armed
  clock = new Date(2026, 9, 5, 6, 45).getTime();
  c.tick();
  assert.equal(attention.length, 1);
  assert.match(attention[0].title, /People review: 1 bot to adjust/);
  assert.match(attention[0].body, /Bo/);
  // Still Adjust the next day: no new alert.
  clock = new Date(2026, 9, 6, 6, 45).getTime();
  c.tick();
  assert.equal((await c.command("people.review")).history.length, 2);
  assert.equal(attention.length, 1);
  await c.command("people.run");
  assert.equal(attention.length, 1);
});

test("a review that fails is logged once and tried again in 10 minutes, not every tick", async (t) => {
  let clock = new Date(2026, 9, 5, 6, 0).getTime();
  const { c, diagnostics } = await office(t, { clock: () => clock });
  c.tick();
  let tries = 0;
  c.peopleRows = () => {
    tries += 1;
    throw new Error("disk trouble at C:\\Users\\someone\\private\\file.db");
  };
  clock = new Date(2026, 9, 5, 6, 45).getTime();
  c.tick();
  c.tick();
  assert.equal(tries, 1);
  const logged = diagnostics.filter((d) => d.code === "people.review_failed");
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].message.includes("someone"), "no paths");
  clock += 11 * 60_000;
  c.tick();
  assert.equal(tries, 2);
  assert.equal(diagnostics.filter((d) => d.code === "people.review_failed").length, 1, "the same error isn't logged again within the hour");
});

test("your Stop on a running run is counted as a redo signal", async (t) => {
  const aborted = ({ signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Run cancelled")), { once: true }));
  const { c, hire, room } = await office(t, { runner: aborted });
  const bo = await hire("Bo");
  const ava = await hire("Ava");
  const desk = await room("Desk", [bo, ava]);
  const until = async (check) => {
    for (let i = 0; !check(); i++) {
      if (i > 500) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  await c.command("messages.send", { requestId: "r1", conversation: desk.id, body: "@Bo draft it" });
  const running = () => c.snapshot().runs.find((r) => r.employee === bo.id && r.status === "running");
  await until(running);
  await c.command("runs.cancel", { id: running().id });
  await until(() => !c.snapshot().runs.some((r) => ["running", "cancelling"].includes(r.status)));
  // A queued run you drop isn't a redo.
  await c.command("runtime.pause");
  await c.command("messages.send", { requestId: "r2", conversation: desk.id, body: "@Bo again" });
  const queued = c.snapshot().runs.find((r) => r.status === "queued");
  await c.command("runs.cancel", { id: queued.id });
  await c.command("runtime.resume");
  // A task's Stop counts too.
  await c.command("tasks.create", { conversation: desk.id, title: "Draft", assignees: [ava.id], reviewer: "" });
  const task = c.snapshot().tasks.find((x) => x.title === "Draft");
  await c.command("tasks.start", { id: task.id });
  await until(() => c.snapshot().runs.some((r) => r.employee === ava.id && r.status === "running"));
  await c.command("tasks.stop", { id: task.id });
  await until(() => !c.snapshot().runs.some((r) => ["running", "cancelling"].includes(r.status)));
  const { latest } = await c.command("people.run");
  assert.equal(latest.bots.find((b) => b.id === bo.id).m.stops, 1);
  assert.equal(latest.bots.find((b) => b.id === ava.id).m.stops, 1);
});

// Review repairs (same release) ------------------------------------------------------

test("the review limit and Autopilot's bounce notes count tasks, not notes", () => {
  const note = (lead, task, type, hoursAgo = 1) => ({ task, lead, type, by: "system", at: iso(NOW - hoursAgo * HOUR) });
  const review = buildReview(
    rows({
      bots: [bot("cap"), bot("bn")],
      runs: [...runs("cap", 10), ...runs("bn", 10)],
      // One task sent back and forth after the limit posts the note each time.
      taskEvents: [note("cap", "t1", "cap", 30), note("cap", "t1", "cap", 5), note("bn", "t2", "bounce", 30), note("bn", "t2", "bounce", 2)],
      // The bounced task is also stuck In progress: still one card.
      stuck: [{ employee: "bn", task: "t2", type: "in_progress" }],
    }),
  );
  assert.equal(of(review, "cap").m.caps, 1);
  assert.match(reasonWords(of(review, "cap").reasons[0], of(review, "cap").m), /^1 task hit/);
  assert.equal(of(review, "bn").m.stuck, 1);
  assert.equal(of(review, "bn").v, "ok", "one stuck card is below Watch's 2");
});

test("a reviewer that passes everything, when you later reopen work it passed, is Watch", () => {
  const verdict = (reviewer, type, task, hoursAgo) => ({ task, lead: "lead", type, by: "bot", actor: reviewer, at: iso(NOW - hoursAgo * HOUR) });
  const passes = (reviewer, n) => repeat(n, (i) => verdict(reviewer, "approved", `${reviewer}-${i}`, 10));
  const reopened = (task, hoursAgo = 2) => ({ task, lead: "lead", type: "reopened", by: "owner", at: iso(NOW - hoursAgo * HOUR) });
  const review = buildReview(
    rows({
      bots: [bot("lead"), bot("rs"), bot("fair"), bot("few"), bot("early")],
      runs: runs("lead", 10),
      taskEvents: [
        ...passes("rs", 10),
        reopened("rs-3"),
        // Sends some back: not a rubber stamp, even when you reopen one.
        ...passes("fair", 9),
        verdict("fair", "changes", "fair-x", 10),
        reopened("fair-2"),
        // Too few reviews to judge.
        ...passes("few", 9),
        reopened("few-1"),
        // Reopened before it approved: not a sign it passed bad work.
        ...passes("early", 10),
        reopened("early-1", 20),
      ],
    }),
  );
  const rs = of(review, "rs");
  assert.equal(rs.v, "watch");
  assert.deepEqual(codes(rs), ["rubberStamp"]);
  assert.equal(rs.m.asReviewer, 10);
  assert.equal(rs.m.reopened, 1);
  assert.equal(rs.fix.kind, "instructions");
  assert.match(reasonWords(rs.reasons[0], rs.m), /all 10 reviews/);
  assert.equal(of(review, "fair").v, "ok");
  assert.equal(of(review, "few").v, "insufficient");
  assert.equal(of(review, "early").v, "ok");
  // The lead's own numbers are its reviews as lead.
  assert.equal(of(review, "lead").m.reviews, 39);
});

test("more than 20 tool requests in 24 hours is Watch, even when you allow them", () => {
  const asks = (employee, status, n, ago = HOUR) => repeat(n, () => ({ employee, status, at: iso(NOW - ago) }));
  const review = buildReview(
    rows({
      bots: [bot("q1"), bot("q2")],
      runs: [...runs("q1", 10), ...runs("q2", 10)],
      approvals: [...asks("q1", "approved", 21), ...asks("q2", "approved", 20), ...asks("q2", "approved", 30, 3 * DAY)],
    }),
  );
  const q1 = of(review, "q1");
  assert.equal(q1.v, "watch");
  assert.deepEqual(q1.reasons, [{ code: "denials", level: "watch", detail: "volume" }]);
  assert.match(reasonWords(q1.reasons[0], q1.m), /21 tool requests in the last 24 hours/);
  assert.equal(of(review, "q2").v, "ok", "20 a day, or more on older days, is fine");
});

test("with Team off, a bot with work that starts on its own isn't told nothing starts it", () => {
  const team = [bot("r1"), bot("r2")];
  const review = buildReview(rows({ bots: team, team: "off", assigned: ["r1"] }));
  assert.deepEqual(of(review, "r1").notes, ["team-off"]);
  assert.deepEqual(of(review, "r2").notes, ["not-scheduled"]);
  const running = buildReview(rows({ bots: team, team: "running", assigned: ["r1"], starved: ["r1"] }));
  assert.deepEqual(of(running, "r1").notes, ["starved"]);
});

test("words: one Fire candidate, the folder fix, and totals", () => {
  const review = { at: iso(NOW), late: false, counts: { ok: 1, watch: 0, adjust: 0, fire: 1, insufficient: 0 } };
  assert.match(totalsLine(review), /· 1 Fire candidate ·/);
  assert.match(totalsLine({ ...review, counts: { ...review.counts, fire: 2 } }), /· 2 Fire candidates ·/);
  assert.equal(FIX_LABELS.workspace, "Folder");
});

test("content added below the People review section survives the next review: a bot's append and your own lines", async (t) => {
  const { c, hire, room } = await office(t);
  const atlas = await hire("Atlas");
  const nova = await hire("Nova", { manager: atlas.id });
  const mara = await hire("Mara", { manager: atlas.id });
  const hq = await room("HQ", [atlas, nova, mara]);
  await c.command("people.run");
  let doc = await c.command("docs.get", { conversation: hq.id });
  assert.equal(doc.blocks[0].text, "People review");
  assert.ok(doc.blocks.every((b) => b.author === "system"), "the heading and every block it wrote are Any Bot's");
  // Atlas appends (doc.append always adds at the end), then you type a line at the bottom.
  c.docs.applyAgentAction(
    { type: "doc.append", markdown: "Atlas brief: hire a designer\n\n### Decisions\n- Keep Nova on video" },
    { id: "run-atlas", employee: atlas.id, conversation: hq.id },
  );
  doc = await c.command("docs.get", { conversation: hq.id });
  await c.command("docs.save", { conversation: hq.id, revision: doc.revision, blocks: [...doc.blocks, { type: "p", text: "Owner: call the accountant" }] });
  // Your edit inside the review's own text is the review's, and is replaced.
  doc = await c.command("docs.get", { conversation: hq.id });
  const totals = doc.blocks.findIndex((b) => b.author === "system" && b.type === "p");
  await c.command("docs.save", {
    conversation: hq.id,
    revision: doc.revision,
    blocks: doc.blocks.map((b, i) => (i === totals ? { ...b, text: `${b.text} (edited)` } : b)),
  });
  for (let i = 0; i < 2; i++) await c.command("people.run");
  doc = await c.command("docs.get", { conversation: hq.id });
  const texts = doc.blocks.map((b) => b.text);
  for (const kept of ["Atlas brief: hire a designer", "Decisions", "Keep Nova on video", "Owner: call the accountant"]) assert.ok(texts.includes(kept), kept);
  assert.equal(texts.filter((text) => text === "People review").length, 1);
  assert.ok(!texts.some((text) => text.endsWith("(edited)")));
  // The review stays where it was, above what was added after it.
  const firstAdded = texts.indexOf("Atlas brief: hire a designer");
  assert.ok(doc.blocks.slice(0, firstAdded).every((b) => b.author === "system"));
  assert.ok(doc.blocks.slice(firstAdded).every((b) => b.author !== "system"));
});

test("the section moves with HQ, is removed when there's no org, and never goes into a direct chat", async (t) => {
  const { c, hire, room } = await office(t);
  const atlas = await hire("Atlas");
  const nova = await hire("Nova", { manager: atlas.id });
  // Atlas is in no project: its direct chat is where Slack and Buzz reach it.
  await c.command("people.run");
  assert.deepEqual(c.snapshot().docs, []);
  const hq = await room("HQ", [atlas, nova]);
  await c.command("docs.save", { conversation: hq.id, revision: 0, blocks: [{ type: "h2", text: "Goals" }, { type: "p", text: "Ship it" }] });
  await c.command("people.run");
  const has = async (conversation) => (await c.command("docs.get", { conversation })).blocks.some((b) => b.text === "People review");
  assert.ok(await has(hq.id));
  // A room with more of Atlas's direct reports becomes HQ: the old section goes.
  const mara = await hire("Mara", { manager: atlas.id });
  const studio = await room("Studio", [atlas, nova, mara]);
  await c.command("people.run");
  assert.ok(await has(studio.id));
  assert.ok(!(await has(hq.id)));
  assert.ok((await c.command("docs.get", { conversation: hq.id })).blocks.some((b) => b.text === "Ship it"), "the owner's content stays");
  // No org any more: no section anywhere.
  for (const id of [nova.id, mara.id]) {
    const bot = c.snapshot().employees.find((e) => e.id === id);
    await c.command("employees.setArchived", { id, revision: bot.revision, archived: true });
  }
  await c.command("people.run");
  assert.ok(!(await has(studio.id)));
});

test("with Team on, a bot whose work Team turns away (a Codex bot) is held, not idle, and its card isn't stuck", async (t) => {
  const { c, hire, room } = await office(t);
  const atlas = await hire("Atlas");
  const cody = await hire("Cody", { harness: "codex", manager: atlas.id, role: "video editor" });
  await hire("Cora", { manager: atlas.id, role: "video editor" });
  const studio = await room("Studio", [atlas, cody]);
  await c.command("team.set", { enabled: true });
  await c.command("conversations.setAutopilot", { conversation: studio.id, enabled: true });
  await c.command("tasks.create", { conversation: studio.id, title: "Cut the trailer", assignees: [cody.id], reviewer: "" });
  c.tick(); // Autopilot starts it; Team refuses the Codex run.
  const task = c.snapshot().tasks.find((x) => x.title === "Cut the trailer");
  const refused = c.snapshot().runs.find((r) => r.employee === cody.id);
  assert.equal(refused.status, "cancelled");
  assert.equal(refused.started, null);
  assert.equal(task.status, "in_progress");
  let rows = c.peopleRows(Date.now());
  assert.ok(rows.starved.includes(cody.id));
  // Hired weeks ago, idle 13 days before today, a teammate in the same role: still not a fire candidate.
  c.store.run("UPDATE events SET created=? WHERE type IN ('employee.updated','employee.manager')", iso(Date.now() - 20 * DAY));
  const idleHistory = Array.from({ length: 13 }, (_, i) => ({
    day: dayKey(Date.now() - (i + 1) * DAY),
    team: "running",
    bots: [{ id: cody.id, v: "insufficient", raw: "insufficient", idle: true }],
  }));
  const judged = buildReview({ ...c.peopleRows(Date.now()), assigned: [cody.id] }, { history: idleHistory }).bots.find((b) => b.id === cody.id);
  assert.equal(judged.idle, false);
  assert.notEqual(judged.v, "fire");
  assert.deepEqual(judged.notes, ["starved"]);
  // Two days later the card is still In progress: Team turned its run away, so it isn't stuck.
  const before = iso(Date.now() - 2 * DAY);
  c.store.run("UPDATE tasks SET updated=? WHERE id=?", before, task.id);
  c.store.run("UPDATE runs SET created=?,ended=? WHERE id=?", before, before, refused.id);
  rows = c.peopleRows(Date.now());
  assert.ok(!rows.stuck.some((s) => s.task === task.id));
  assert.ok(!rows.assigned.includes(cody.id), "an In progress card isn't work anything starts on its own");
  // An enabled routine Team would refuse: held, whether or not it came due yet.
  await c.command("routines.create", { name: "Check in", prompt: "Check in", minutes: 60, conversation: studio.id, employee: cody.id });
  assert.ok(c.peopleRows(Date.now()).starved.includes(cody.id));
});

test("a card whose last run was stopped (by you, Stop the team or a refusal) isn't stuck", async (t) => {
  const { c, hire, room } = await office(t);
  const lead = await hire("Lead");
  const other = await hire("Other");
  const desk = await room("Desk", [lead, other]);
  const card = async (title, status, error = "") => {
    await c.command("tasks.create", { conversation: desk.id, title, assignees: [lead.id], reviewer: "" });
    const task = c.snapshot().tasks.find((x) => x.title === title);
    const run = c.addRun(desk.id, lead.id, c.addMessage(desk.id, "system", "task", "lorem"), null, null, 0, task.id, null);
    const old = iso(Date.now() - 2 * DAY);
    c.store.run("UPDATE runs SET status=?,error=?,created=?,started=?,ended=? WHERE id=?", status, error, old, old, old, run);
    c.store.run("UPDATE tasks SET status='in_progress',updated=? WHERE id=?", old, task.id);
    return task.id;
  };
  const stopped = await card("Stopped", "cancelled", "Run cancelled");
  const stalled = await card("Stalled", "failed", TIMEOUT);
  const { stuck } = c.peopleRows(Date.now());
  assert.deepEqual(stuck.map((s) => s.task), [stalled]);
  assert.ok(!stuck.some((s) => s.task === stopped));
});

test("a Stop from someone else's phone isn't counted as yours", async (t) => {
  const aborted = ({ signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Run cancelled")), { once: true }));
  const { c, hire, room } = await office(t, { runner: aborted });
  const bo = await hire("Bo");
  const ava = await hire("Ava");
  const desk = await room("Desk", [bo, ava]);
  const until = async (check) => {
    for (let i = 0; !check(); i++) {
      if (i > 500) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const running = () => c.snapshot().runs.find((r) => r.status === "running");
  const idle = () => !c.snapshot().runs.some((r) => ["running", "cancelling"].includes(r.status));
  await c.command("messages.send", { requestId: "m1", conversation: desk.id, body: "@Bo draft it" });
  await until(running);
  await c.command("runs.cancel", { id: running().id, by: "member" });
  await until(idle);
  await c.command("messages.send", { requestId: "m2", conversation: desk.id, body: "@Ava draft it" });
  await until(running);
  await c.command("runs.cancel", { id: running().id, by: "owner" });
  await until(idle);
  const { latest } = await c.command("people.run");
  assert.equal(latest.bots.find((b) => b.id === bo.id).m.stops, 0);
  assert.equal(latest.bots.find((b) => b.id === ava.id).m.stops, 1, "the owner's phone counts, like the desk");
});

test("tool requests answered from Slack aren't counted as yours", async (t) => {
  const { c, hire, room } = await office(t);
  const bo = await hire("Bo");
  const ava = await hire("Ava");
  const desk = await room("Desk", [bo, ava]);
  const ask = () => {
    const run = insertRun(c, { employee: bo.id, conversation: desk.id, at: Date.now() - HOUR });
    const id = `ap-${Math.random().toString(36).slice(2)}`;
    c.store.run(
      "INSERT INTO approvals(id,run,conversation,employee,tool,summary,status,created) VALUES (?,?,?,?,?,?,?,?)",
      id,
      run,
      desk.id,
      bo.id,
      "Bash",
      "lorem",
      "pending",
      iso(Date.now() - HOUR),
    );
    return id;
  };
  for (let i = 0; i < 3; i++) await c.command("approvals.decide", { id: ask(), decision: "deny", by: "slack" });
  await c.command("approvals.decide", { id: ask(), decision: "deny" });
  const { latest } = await c.command("people.run");
  const b = latest.bots.find((x) => x.id === bo.id);
  assert.equal(b.m.denied, 1, "only the desk's answer is yours");
  assert.ok(!b.reasons.some((r) => r.code === "denials"));
});

test("from the database: which bot approved a review, and your reopening of a finished task", async (t) => {
  const { c, hire, room } = await office(t);
  const lead = await hire("Lead");
  const rev = await hire("Rev");
  const desk = await room("Desk", [lead, rev]);
  await c.command("tasks.create", { conversation: desk.id, title: "Draft", assignees: [lead.id], reviewer: rev.id });
  const task = c.snapshot().tasks.find((x) => x.title === "Draft");
  c.store.run("UPDATE tasks SET status='review' WHERE id=?", task.id);
  c.board.move({ id: task.id, status: "done" }, rev.id);
  await c.command("tasks.move", { id: task.id, status: "in_progress" });
  const { taskEvents } = c.peopleRows(Date.now());
  const approved = taskEvents.find((e) => e.type === "approved");
  assert.equal(approved.actor, rev.id);
  assert.equal(approved.lead, lead.id);
  const reopened = taskEvents.find((e) => e.type === "reopened");
  assert.equal(reopened.by, "owner");
  assert.equal(reopened.task, task.id);
  assert.equal(reopened.actor, undefined);
});

test("the next review time skips a day already reviewed, and the snapshot says when a review ran", async (t) => {
  let clock = new Date(2026, 9, 5, 6, 0).getTime();
  const { c } = await office(t, { clock: () => clock });
  c.tick();
  const stamp = () => JSON.stringify(c.snapshot().people);
  const before = stamp();
  clock = new Date(2026, 9, 5, 6, 45).getTime();
  c.tick();
  assert.notEqual(stamp(), before, "a review changes the snapshot, so open pages fetch it again");
  assert.equal(c.snapshot().people.at, (await c.command("people.review")).latest.at);
  clock = new Date(2026, 9, 5, 8, 0).getTime();
  const later = await c.command("people.set", { at: "09:00" });
  assert.equal(later.settings.next, new Date(2026, 9, 6, 9, 0).getTime(), "today was reviewed, so tomorrow");
  const ran = stamp();
  await c.command("people.run");
  assert.notEqual(stamp(), ran);
});
