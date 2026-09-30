"use strict";
// The tray's Team items and tooltip (desktop/main.cjs), from the coordinator's
// team.get status. Pure, so node:test can check them without Electron
// (tests/team-ui.test.mjs). `run(method, payload)` sends a Team command.

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const LABELS = { off: "off", running: "on", paused: "paused", stopped: "stopped" };

function teamTrayItems(team, run) {
  if (!team) return [{ label: "Team: starting…", enabled: false }];
  const stopped = team.state === "stopped";
  const paused = team.state === "paused";
  return [
    {
      label: "Team on",
      type: "checkbox",
      checked: Boolean(team.enabled) && !stopped,
      // Electron has already flipped `checked` when the click arrives.
      click: (item) => run("team.set", { enabled: Boolean(item.checked) }),
    },
    paused
      ? { label: `Resume the team (paused until ${clock(team.pausedUntil)})`, click: () => run("team.resume") }
      : { label: "Pause team 1 hour", enabled: !stopped, click: () => run("team.pause", { minutes: 60 }) },
    stopped ? { label: "Resume the team", click: () => run("team.resume") } : { label: "Stop the team", click: () => run("team.stop") },
  ];
}

// "Any Bot · Team on · 3 working · 12/40 runs today" (Windows keeps 127 characters).
function teamTrayTooltip(team) {
  if (!team) return "Any Bot — your team is available";
  const parts = ["Any Bot", `Team ${LABELS[team.state] || "off"}`, `${team.working ?? 0} working`];
  if (team.state === "running" && team.settings) parts.push(`${team.today?.org ?? 0}/${team.settings.orgRunsPerDay} runs today`);
  return parts.join(" · ").slice(0, 127);
}

// What the menu shows; it's rebuilt only when this changes.
function traySignature(team) {
  if (!team) return "null";
  return JSON.stringify([team.state, team.enabled, team.pausedUntil, team.working, team.today?.org, team.settings?.orgRunsPerDay]);
}

module.exports = { teamTrayItems, teamTrayTooltip, traySignature };
