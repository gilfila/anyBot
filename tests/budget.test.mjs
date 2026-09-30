// The always-on team's brakes as pure rules (0.3.38): dispatch priority,
// lanes, the local day, reset times harnesses print, the provider circuit
// breaker, and the Team settings.
import test from "node:test";
import assert from "node:assert/strict";
import {
  Breaker,
  applyTeamSettings,
  dayStart,
  halted,
  laneOf,
  nextClockTime,
  parseResetTime,
  priorityOf,
  teamConfig,
  teamState,
  tokensOf,
} from "../runtime/budget.mjs";

const desk = { via: "desktop" };
const system = { via: "system" };
const buzz = { via: "buzz", channel: "general" };
const phone = { via: "phone", member: "owner" };
const bot = { via: "bot", employee: "e1" };
const HALF_HOUR = 30 * 60_000;

test("priorityOf follows the dispatch table", () => {
  // The owner's own message (or task start), and the owner's Run again / Run now.
  assert.equal(priorityOf({ origin: desk, rootOrigin: desk }), 30);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, ownerRun: true, kind: "routine" }), 30);
  // The owner's chain continuing (hand-offs, mentions, returns).
  assert.equal(priorityOf({ origin: bot, rootOrigin: desk, kind: "child" }), 25);
  // Guests: a Buzz or Slack message, a phone, and what their work hands on.
  assert.equal(priorityOf({ origin: buzz, rootOrigin: buzz, peopleStarted: true }), 20);
  assert.equal(priorityOf({ origin: phone, rootOrigin: phone, peopleStarted: true }), 20);
  assert.equal(priorityOf({ origin: bot, rootOrigin: buzz, peopleStarted: true, kind: "child" }), 20);
  // Autonomous work by kind.
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "review" }), 20);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "decision" }), 20);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "schedule" }), 15);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "task" }), 10);
  assert.equal(priorityOf({ origin: bot, rootOrigin: system, kind: "child" }), 10);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "plan" }), 5);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "routine" }), 0);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, wakePriority: 15 }), 15, "a wake's own priority wins");
  // Below 25, half an hour in the queue adds 5, never past 20.
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "routine", queuedMs: HALF_HOUR - 1 }), 0);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "routine", queuedMs: HALF_HOUR }), 5);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "schedule", queuedMs: HALF_HOUR }), 20);
  assert.equal(priorityOf({ origin: system, rootOrigin: system, kind: "review", queuedMs: 10 * HALF_HOUR }), 20);
  assert.equal(priorityOf({ origin: buzz, rootOrigin: buzz, peopleStarted: true, queuedMs: 10 * HALF_HOUR }), 20);
  assert.equal(priorityOf({ origin: bot, rootOrigin: desk, queuedMs: 10 * HALF_HOUR }), 25);
  assert.equal(priorityOf({ origin: desk, rootOrigin: desk, queuedMs: 10 * HALF_HOUR }), 30);
});

test("laneOf: only the owner at the desk (or the owner's own Run again) is the owner lane; bridges are guests", () => {
  assert.equal(laneOf({ origin: desk, rootOrigin: desk, peopleStarted: true }), "owner");
  assert.equal(laneOf({ origin: bot, rootOrigin: desk, peopleStarted: true }), "owner");
  assert.equal(laneOf({ origin: system, rootOrigin: system, peopleStarted: false, ownerRun: true }), "owner");
  for (const origin of [buzz, phone, { via: "slack", team: "T", user: "U", channel: "D" }, { via: "bridge" }])
    assert.equal(laneOf({ origin, rootOrigin: origin, peopleStarted: true }), "guest", origin.via);
  assert.equal(laneOf({ origin: system, rootOrigin: system, peopleStarted: false }), "autonomous");
  assert.equal(laneOf({ origin: bot, rootOrigin: system, peopleStarted: false }), "autonomous");
});

test("dayStart is local midnight, across daylight-saving changes", () => {
  const zone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // Clocks went forward at 02:00 on 8 March 2026 and back at 02:00 on 1 November.
    const spring = Date.parse("2026-03-08T15:00:00Z");
    assert.equal(new Date(dayStart(spring)).toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(dayStart(Date.parse("2026-03-09T15:00:00Z")) - dayStart(spring), 23 * 3600_000);
    const fall = Date.parse("2026-11-01T15:00:00Z");
    assert.equal(new Date(dayStart(fall)).toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(dayStart(Date.parse("2026-11-02T15:00:00Z")) - dayStart(fall), 25 * 3600_000);
    // A minute before midnight is still the same day; midnight starts the next.
    assert.equal(dayStart(Date.parse("2026-09-30T03:59:00Z")), Date.parse("2026-09-29T04:00:00Z"));
    assert.equal(dayStart(Date.parse("2026-09-30T04:00:00Z")), Date.parse("2026-09-30T04:00:00Z"));
    // The next 07:00 on the local clock.
    assert.equal(nextClockTime("07:00", Date.parse("2026-09-30T13:00:00Z")), Date.parse("2026-10-01T11:00:00Z"));
    assert.equal(nextClockTime("10:30", Date.parse("2026-09-30T13:00:00Z")), Date.parse("2026-09-30T14:30:00Z"));
    assert.equal(nextClockTime("25:00", Date.now()), null);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test("parseResetTime reads the reset times harnesses print, and gives null for anything else", () => {
  const zone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const now = Date.parse("2026-09-30T13:00:00Z"); // 09:00 in New York
    const inAnHour = Math.floor(now / 1000) + 3600;
    // Claude Code's older limit message carries the reset as epoch seconds.
    assert.equal(parseResetTime(`Claude AI usage limit reached|${inAnHour}`, now), inAnHour * 1000);
    // Codex: a time today (or tomorrow once it's passed), or a full date.
    assert.equal(
      parseResetTime("You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 3:05 PM.", now),
      Date.parse("2026-09-30T19:05:00Z"),
    );
    assert.equal(parseResetTime("You've hit your usage limit. Try again at 8:00 AM.", now), Date.parse("2026-10-01T12:00:00Z"));
    assert.equal(parseResetTime("You've hit your usage limit. Try again at Oct 3rd, 2026 3:05 PM.", now), Date.parse("2026-10-03T19:05:00Z"));
    // Claude Code: "resets 3pm (zone)", with an optional date.
    assert.equal(parseResetTime("You've hit your limit · resets 3pm (America/Los_Angeles)", now), Date.parse("2026-09-30T22:00:00Z"));
    assert.equal(parseResetTime("You've hit your limit · resets Oct 2, 4:30pm (America/Los_Angeles)", now), Date.parse("2026-10-02T23:30:00Z"));
    assert.equal(parseResetTime("You've hit your limit · resets 3pm (Not/AZone)", now), Date.parse("2026-09-30T19:00:00Z"), "an unknown zone reads as local");
    // Relative times.
    assert.equal(parseResetTime("Rate limited. Try again in 2 hours 3 minutes.", now), now + (2 * 60 + 3) * 60_000);
    assert.equal(parseResetTime("try again in 45 seconds", now), now + 45_000);
    assert.equal(parseResetTime("Try again in 5 days 3 hours.", now), now + (5 * 24 + 3) * 3600_000);
    assert.equal(parseResetTime("Limit resets at 2026-09-30T14:20:00Z", now), Date.parse("2026-09-30T14:20:00Z"));
    // Nothing usable: the breaker falls back to its own backoff.
    for (const text of [
      "billing quota 429",
      "",
      undefined,
      `usage limit reached|${Math.floor(now / 1000) - 60}`, // in the past
      "Try again at Oct 20th, 2026 3:05 PM.", // more than a week away
      "Try again in 30 days.",
    ])
      assert.equal(parseResetTime(text, now), null, String(text));
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

function memory() {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
    delete: (key) => map.delete(key),
    list: (prefix) => [...map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
  };
}

test("breaker: two limit failures in 10 minutes open it; it backs off, lets one probe through, and a success closes it", () => {
  let now = Date.parse("2026-09-30T10:00:00Z");
  const breaker = new Breaker(memory(), () => now);
  const active = new Set();
  const isActive = (run) => active.has(run);
  assert.equal(breaker.admit("claude", isActive), "closed");
  assert.equal(breaker.record("claude", { code: "usage_limit", run: "r1" }).opened, false);
  now += 11 * 60_000;
  assert.equal(breaker.record("claude", { code: "usage_limit", run: "r2" }).opened, false, "the first failure was more than 10 minutes ago");
  now += 60_000;
  const tripped = breaker.record("claude", { code: "auth", run: "r3" });
  assert.equal(tripped.opened, true);
  assert.equal(breaker.get("claude").state, "open");
  assert.equal(breaker.get("claude").openUntil, now + 15 * 60_000);
  assert.equal(breaker.get("claude").code, "auth");
  assert.equal(breaker.admit("claude", isActive), "open");
  assert.equal(breaker.admit("codex", isActive), "closed", "each harness has its own");
  assert.equal(breaker.record("claude", { code: "usage_limit", run: "r4" }).opened, false, "already open: opened once");
  // Any other failure never counts.
  for (const code of ["exit", "timeout", "model", undefined]) breaker.record("codex", { code, run: "x" });
  breaker.record("codex", { code: "exit", run: "y" });
  assert.equal(breaker.get("codex").state, "closed");
  // Open for 15, then 30, 60 and 120 minutes (and 120 after that).
  for (const minutes of [30, 60, 120, 120]) {
    now = breaker.get("claude").openUntil;
    assert.equal(breaker.get("claude").state, "half");
    assert.equal(breaker.admit("claude", isActive), "probe");
    breaker.probeStarted("claude", `probe-${minutes}`);
    active.add(`probe-${minutes}`);
    assert.equal(breaker.admit("claude", isActive), "open", "one probe at a time");
    active.delete(`probe-${minutes}`);
    assert.equal(breaker.record("claude", { code: "usage_limit", run: `probe-${minutes}` }).opened, true, "a failed probe opens it again");
    assert.equal(breaker.get("claude").openUntil, now + minutes * 60_000);
  }
  // A probe that ends some other way (stopped, a bot error) lets the next one through.
  now = breaker.get("claude").openUntil;
  assert.equal(breaker.admit("claude", isActive), "probe");
  breaker.probeStarted("claude", "stopped-probe");
  assert.equal(breaker.admit("claude", isActive), "probe", "that probe isn't running any more");
  breaker.probeStarted("claude", "good-probe");
  active.add("good-probe");
  assert.equal(breaker.succeeded("claude", "good-probe").closed, true);
  assert.equal(breaker.get("claude").state, "closed");
  assert.equal(breaker.admit("claude", isActive), "closed");
  // Closed again, it starts over at 15 minutes.
  breaker.record("claude", { code: "usage_limit", run: "a" });
  breaker.record("claude", { code: "usage_limit", run: "b" });
  assert.equal(breaker.get("claude").openUntil, now + 15 * 60_000);
  assert.equal(breaker.succeeded("claude", "an owner's run").closed, true, "any success closes it");
  assert.equal(breaker.succeeded("claude", "another").closed, false, "already closed");
});

test("breaker: a reset time from the provider sets how long it stays open, within a week", () => {
  let now = Date.parse("2026-09-30T10:00:00Z");
  const breaker = new Breaker(memory(), () => now);
  const trip = (resetAt) => {
    breaker.reset("claude");
    breaker.record("claude", { code: "usage_limit", run: "a" });
    breaker.record("claude", { code: "usage_limit", run: "b", resetAt });
    return breaker.get("claude").openUntil;
  };
  assert.equal(trip(now + 2 * 3600_000), now + 2 * 3600_000);
  assert.equal(trip(now + 8 * 24 * 3600_000), now + 15 * 60_000, "a week or more away: the usual backoff");
  assert.equal(trip(now - 60_000), now + 15 * 60_000, "already past: the usual backoff");
  assert.equal(trip(undefined), now + 15 * 60_000);
  assert.equal(breaker.reset("claude").closed, true);
  assert.equal(breaker.get("claude").state, "closed");
  assert.equal(breaker.reset("claude").closed, false);
  assert.deepEqual(breaker.list().map((b) => b.harness), [], "a closed breaker with no failures isn't listed");
  breaker.record("codex", { code: "auth", run: "c" });
  assert.deepEqual(breaker.list().map((b) => [b.harness, b.state, b.failures]), [["codex", "closed", 1]]);
});

test("Team settings default off, and each setting is checked", () => {
  const config = teamConfig(undefined);
  assert.equal(config.enabled, false);
  assert.equal(config.stopped, false);
  assert.equal(config.concurrency, null, "the app's own default until the owner sets one");
  assert.equal(config.ownerReserve, 2);
  assert.equal(config.orgRunsPerDay, 40);
  assert.equal(config.projectRunsPerDay, 40);
  assert.deepEqual(config.levelRuns, { cos: 16, director: 20, manager: 24, employee: 12, unleveled: 12 });
  assert.equal(config.orgTokensPerDay, 0);
  assert.deepEqual(config.dontAskAllowed, []);
  assert.deepEqual(teamConfig("not json"), config);
  assert.deepEqual(teamConfig(JSON.stringify({ concurrency: 99, ownerReserve: -1, orgRunsPerDay: "lots" })), config, "bad stored values fall back");
  assert.equal(teamState(config, 0), "off");
  assert.equal(teamState({ ...config, enabled: true }, 0), "running");
  assert.equal(teamState({ ...config, enabled: true, pausedUntil: 10 }, 5), "paused");
  assert.equal(teamState({ ...config, enabled: true, pausedUntil: 10 }, 10), "running");
  assert.equal(teamState({ ...config, pausedUntil: 10 }, 5), "paused", "the kill switch works with Team off too");
  assert.equal(teamState({ ...config, enabled: true, stopped: true, pausedUntil: 10 }, 5), "stopped");
  assert.deepEqual(["off", "running", "paused", "stopped"].map(halted), [false, false, true, true]);
  const changed = applyTeamSettings(config, {
    concurrency: 4,
    ownerReserve: 1,
    orgRunsPerDay: 150,
    projectRunsPerDay: 30,
    levelRuns: { unleveled: 6 },
    orgTokensPerDay: 2_000_000,
    dontAskAllowed: ["e1", "e2", "e1"],
  });
  assert.equal(changed.concurrency, 4);
  assert.equal(changed.levelRuns.unleveled, 6);
  assert.equal(changed.levelRuns.manager, 24, "other levels keep theirs");
  assert.deepEqual(changed.dontAskAllowed, ["e1", "e2"]);
  assert.equal(config.concurrency, null, "the original isn't changed");
  for (const [payload, message] of [
    [{ concurrency: 0 }, /1 to 12/],
    [{ concurrency: 13 }, /1 to 12/],
    [{ concurrency: 2.5 }, /1 to 12/],
    [{ ownerReserve: 12 }, /reserve/i],
    [{ concurrency: 3, ownerReserve: 3 }, /reserve/i],
    [{ orgRunsPerDay: 0 }, /runs a day/i],
    [{ projectRunsPerDay: -4 }, /runs a day/i],
    [{ levelRuns: { unleveled: 0 } }, /runs a day/i],
    [{ levelRuns: { captain: 3 } }, /level/i],
    [{ orgTokensPerDay: -1 }, /tokens/i],
    [{ dontAskAllowed: "e1" }, /list/i],
  ])
    assert.throws(() => applyTeamSettings(config, payload), message, JSON.stringify(payload));
  // The reserve is checked against the app's own default when no concurrency is set.
  assert.throws(() => applyTeamSettings(config, { ownerReserve: 4 }, { concurrency: 4 }), /reserve/i);
  assert.equal(applyTeamSettings(config, { ownerReserve: 0 }).ownerReserve, 0);
  // State changes (on, off, stop, pause) have their own commands; they're ignored here.
  assert.equal(applyTeamSettings(config, { enabled: true, stopped: true, pausedUntil: 9 }).enabled, false);
});

test("tokensOf counts input and output tokens from a run's stored usage", () => {
  assert.equal(tokensOf({ "gen_ai.usage.input_tokens": 40000, "gen_ai.usage.output_tokens": 120, "gen_ai.usage.cached_input_tokens": 39000 }), 40120);
  assert.equal(tokensOf(JSON.stringify({ "gen_ai.usage.input_tokens": 10, "gen_ai.usage.output_tokens": 5 })), 15);
  for (const empty of [null, "", "{}", "nonsense", { "gen_ai.usage.input_tokens": -3 }]) assert.equal(tokensOf(empty), 0);
});
