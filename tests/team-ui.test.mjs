// The Team's words in the app and the tray (0.3.38): its state, why a
// queued run waits (and whether the owner can interrupt what blocks it), and
// the tray menu's Team items.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { breakerTitle, occurrenceLabel, openBreakers, teamLine, waitText } from "../src/lib/team.js";

const require = createRequire(import.meta.url);
const { teamTrayItems, teamTrayTooltip, traySignature } = require("../desktop/team-tray.cjs");

const names = { n1: "Nova", r1: "Reel" };
const context = { name: (id) => names[id] || "A bot", harnessName: (id) => ({ claude: "Claude Code", codex: "Codex" })[id] || id };

test("a queued run says why it waits, and offers Interrupt only for work nobody at the desk started", () => {
  const now = Date.parse("2026-09-30T10:12:00Z");
  const busy = waitText(
    { reason: "bot-busy", blocker: "run-1", blockerEmployee: "n1", lane: "autonomous", kind: "routine", since: "2026-09-30T10:00:00Z", mine: true },
    { ...context, now },
  );
  assert.deepEqual(busy, { text: "Nova is on a routine (started 12m ago).", interrupt: "run-1" });
  const folder = waitText({ reason: "folder-busy", blocker: "run-2", blockerEmployee: "r1", lane: "autonomous", kind: "task", since: "2026-09-30T10:12:00Z", mine: true }, { ...context, now });
  assert.deepEqual(folder, { text: "Waiting for its folder: Reel is on an Autopilot task (started just now) there.", interrupt: "run-2" });
  const guest = waitText({ reason: "bot-busy", blocker: "run-3", blockerEmployee: "n1", lane: "guest", since: "2026-09-30T10:02:00Z", mine: true }, { ...context, now });
  assert.equal(guest.interrupt, "run-3");
  assert.match(guest.text, /Slack, Buzz or a phone/);
  const own = waitText({ reason: "bot-busy", blocker: "run-4", blockerEmployee: "n1", lane: "owner", since: "2026-09-30T10:02:00Z", mine: true }, { ...context, now });
  assert.equal(own.interrupt, null, "your own work is stopped, not interrupted");
  assert.match(own.text, /your earlier message/);
  // A queued routine waiting on another isn't yours to push ahead.
  assert.equal(waitText({ reason: "bot-busy", blocker: "run-5", blockerEmployee: "n1", lane: "autonomous", kind: "routine", since: "2026-09-30T10:02:00Z", mine: false }, { ...context, now }).interrupt, null);
  assert.match(waitText({ reason: "slots", slots: 8 }).text, /All 8 slots/);
  assert.match(waitText({ reason: "reserve", slots: 6 }).text, /kept for you/);
  for (const [scope, pattern] of [
    ["bot", /12 runs for this bot/],
    ["project", /project's 12 runs/],
    ["org", /team's 12 runs/],
    ["tokens", /token limit/],
  ])
    assert.match(waitText({ reason: "budget", scope, cap: 12, used: 12 }).text, pattern);
  assert.match(waitText({ reason: "breaker", harness: "claude", code: "usage_limit", until: now + 3600_000 }, context).text, /^Claude Code usage limit: this waits until /);
  assert.match(waitText({ reason: "breaker", harness: "codex", code: "auth", until: now }, context).text, /^Codex sign-in problem/);
  assert.match(waitText({ reason: "paused" }).text, /paused/);
  assert.match(waitText({ reason: "stopped" }).text, /resume/);
  assert.equal(waitText(null), null);
  assert.equal(waitText({ reason: "something new" }), null);
});

test("the Team's state in a line, and the breakers holding work", () => {
  assert.equal(teamLine(null), "");
  assert.match(teamLine({ state: "off" }), /as they always have/);
  assert.match(teamLine({ state: "running", today: { org: 12 }, settings: { orgRunsPerDay: 40 } }), /12 of 40 runs today/);
  assert.match(teamLine({ state: "paused", pausedUntil: Date.now() + 60_000 }), /^Paused until/);
  assert.match(teamLine({ state: "stopped" }), /resume/);
  const team = {
    breakers: [
      { harness: "claude", state: "open", code: "usage_limit" },
      { harness: "codex", state: "closed", code: "" },
      { harness: "cursor", state: "half", code: "auth" },
    ],
  };
  assert.deepEqual(openBreakers(team).map((b) => b.harness), ["claude", "cursor"]);
  assert.deepEqual(openBreakers(undefined), []);
  assert.equal(breakerTitle(team.breakers[0], context.harnessName), "Claude Code usage limit");
  assert.equal(breakerTitle(team.breakers[2]), "cursor sign-in problem");
  assert.equal(occurrenceLabel("skipped-stopped"), "skipped (the team was stopped or paused)");
  assert.equal(occurrenceLabel("missed"), "missed");
});

test("the tray has Team on, a one-hour pause and Stop the team, and they call the Team's commands", () => {
  const calls = [];
  const run = (method, payload) => calls.push([method, payload]);
  const click = (items, label) => items.find((item) => item.label.startsWith(label)).click({ checked: !items.find((item) => item.label.startsWith(label)).checked });
  const off = teamTrayItems({ state: "off", enabled: false, stopped: false }, run);
  assert.deepEqual(off.map((item) => item.label), ["Team on", "Pause team 1 hour", "Stop the team"]);
  assert.equal(off[0].type, "checkbox");
  assert.equal(off[0].checked, false);
  click(off, "Team on");
  click(off, "Pause team 1 hour");
  click(off, "Stop the team");
  assert.deepEqual(calls, [
    ["team.set", { enabled: true }],
    ["team.pause", { minutes: 60 }],
    ["team.stop", undefined],
  ]);
  calls.length = 0;
  const on = teamTrayItems({ state: "running", enabled: true, stopped: false }, run);
  assert.equal(on[0].checked, true);
  click(on, "Team on");
  assert.deepEqual(calls, [["team.set", { enabled: false }]]);
  const paused = teamTrayItems({ state: "paused", enabled: true, pausedUntil: Date.now() + 3600_000 }, run);
  assert.match(paused[1].label, /^Resume the team \(paused until/);
  const stopped = teamTrayItems({ state: "stopped", enabled: false, stopped: true }, run);
  assert.equal(stopped[0].checked, false);
  assert.equal(stopped[1].enabled, false, "no pause while stopped");
  assert.equal(stopped[2].label, "Resume the team");
  calls.length = 0;
  stopped[2].click({});
  assert.deepEqual(calls, [["team.resume", undefined]]);
  assert.deepEqual(teamTrayItems(null, run).map((item) => item.enabled), [false]);
  // The tooltip fits Windows' 127 characters and says what's going on.
  const tip = teamTrayTooltip({ state: "running", working: 3, today: { org: 12 }, settings: { orgRunsPerDay: 40 } });
  assert.equal(tip, "Any Bot · Team on · 3 working · 12/40 runs today");
  assert.ok(tip.length <= 127);
  assert.equal(teamTrayTooltip(null), "Any Bot — your team is available");
  assert.equal(teamTrayTooltip({ state: "off", working: 0 }), "Any Bot · Team off · 0 working");
  assert.notEqual(traySignature({ state: "running", working: 1 }), traySignature({ state: "running", working: 2 }));
  assert.equal(traySignature(null), "null");
});
