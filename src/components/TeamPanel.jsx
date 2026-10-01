import React, { useState } from "react";
import { CirclePause, OctagonX, Play, RotateCcw, Users } from "lucide-react";
import { breakerNote, openBreakers, resumeChoices, teamLine } from "../lib/team.js";
import "./team.css";

// Settings → Team: the always-on team's switch, pause and kill switch, how
// many bots work at once, its daily limits, harnesses waiting on a usage
// limit, and which bots that act without asking may work unattended. Every
// change goes through the coordinator's team.* commands (runtime/budget.mjs
// checks them).
const FIELDS = [
  ["concurrency", "Bots working at once", "1 to 12, for all work."],
  ["ownerReserve", "Kept for you", "Slots only your own work may use while Team is on."],
  ["orgRunsPerDay", "Runs a day, whole team", "Work nobody at the desk started."],
  ["projectRunsPerDay", "Runs a day, each project", ""],
  ["botRunsPerDay", "Runs a day, each bot", ""],
  ["orgTokensPerDay", "Tokens a day", "Input and output, for that work. 0 means no limit."],
];

export function TeamPanel({ data, act, busy, harnessName = (id) => id }) {
  const team = data.team;
  const [draft, setDraft] = useState(null);
  if (!team) return null;
  const settings = team.settings;
  const saved = {
    concurrency: settings.concurrency,
    ownerReserve: settings.ownerReserve,
    orgRunsPerDay: settings.orgRunsPerDay,
    projectRunsPerDay: settings.projectRunsPerDay,
    botRunsPerDay: settings.levelRuns.unleveled,
    orgTokensPerDay: settings.orgTokensPerDay,
  };
  const values = draft || saved;
  const on = team.enabled && team.state !== "stopped";
  const halted = team.state === "paused" || team.state === "stopped";
  const breakers = openBreakers(team);
  const active = data.employees.filter((e) => !e.archived);
  const dontAsk = active.filter((e) => e.permissionMode === "dontAsk");
  const codex = active.filter((e) => e.harness === "codex");
  const save = async () => {
    const number = (key) => Number(values[key]);
    const next = await act("team.set", {
      concurrency: number("concurrency"),
      ownerReserve: number("ownerReserve"),
      orgRunsPerDay: number("orgRunsPerDay"),
      projectRunsPerDay: number("projectRunsPerDay"),
      levelRuns: { unleveled: number("botRunsPerDay") },
      orgTokensPerDay: number("orgTokensPerDay"),
    });
    if (next) setDraft(null);
  };
  const allow = (employee, allowed) =>
    act("team.set", {
      dontAskAllowed: allowed
        ? [...new Set([...settings.dontAskAllowed, employee.id])]
        : settings.dontAskAllowed.filter((id) => id !== employee.id),
    });
  const today = team.today || { org: 0, owner: 0, tokens: 0 };

  return (
    <section className="team-panel" aria-labelledby="team-title">
      <h2 id="team-title" className="settings-section-title">
        Team
      </h2>
      <div className="settings-card team-card">
        <div className="team-icon" aria-hidden="true">
          <Users size={20} />
        </div>
        <div>
          <h3>Always-on team</h3>
          <p>
            Let your bots keep working without you. Routines, Autopilot and hand-offs run within daily limits, with a stop
            switch and a brake for provider usage limits. Your own messages always go first and are never limited.
          </p>
          <p className={`team-state is-${team.state}`}>
            <span aria-hidden="true" />
            {teamLine(team)}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={on}
          aria-label="Team on"
          disabled={busy}
          onClick={() => act("team.set", { enabled: !on })}
        />
      </div>
      <div className="team-actions">
        {halted ? (
          resumeChoices(team).map(({ label, payload }) => (
            <button key={label} type="button" className="secondary" disabled={busy} onClick={() => act("team.resume", payload)}>
              {payload?.enabled !== false && <Play size={14} />}
              {label === "Resume" ? "Resume the team" : label}
            </button>
          ))
        ) : (
          <>
            <button type="button" className="secondary" disabled={busy} onClick={() => act("team.pause", { minutes: 60 })}>
              <CirclePause size={14} />
              Pause 1 hour
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => act("team.pause", { until: "07:00" })}>
              Pause until 07:00
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => act("team.stop")}>
              <OctagonX size={14} />
              Stop the team
            </button>
          </>
        )}
      </div>
      <p className="team-note">
        <strong>Stop the team</strong> works with Team on or off, and turning Team off does the same. Work nobody at the desk
        started stops, including work that is running: tasks, hand-offs and messages from Slack, Buzz or your phone wait until
        you resume, and the rest (routine runs, for example) is cancelled. Routines are skipped and Autopilot turns off in every
        project. Your own messages, and hand-offs and @mentions in your own threads, still go through; <strong>Stop
        everything</strong> stops those too. <strong>Pause</strong> holds waiting work without cancelling it, lets running work
        finish (it can't hand anything on), and skips routines that come due.
      </p>

      <form
        className="team-limits"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {FIELDS.map(([key, label, hint]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="number"
              min={key === "orgTokensPerDay" || key === "ownerReserve" ? 0 : 1}
              max={key === "concurrency" ? 12 : key === "ownerReserve" ? 11 : undefined}
              step="1"
              value={values[key]}
              onChange={(event) => setDraft({ ...values, [key]: event.target.value })}
            />
            {hint && <small>{hint}</small>}
          </label>
        ))}
        <div className="team-limits-actions">
          <button type="submit" className="secondary" disabled={busy || !draft}>
            Save limits
          </button>
          {draft && (
            <button type="button" className="secondary" onClick={() => setDraft(null)}>
              Undo
            </button>
          )}
        </div>
      </form>
      <p className="team-usage">
        Today: {today.org} of {settings.orgRunsPerDay} runs nobody at the desk started · {today.owner} of yours ·{" "}
        {today.tokens.toLocaleString()} tokens. Limits start over at midnight.
      </p>

      <div className="team-block">
        <h3>Usage limits</h3>
        {breakers.length ? (
          <ul className="team-breakers">
            {breakers.map((breaker) => (
              <li key={breaker.harness}>
                <span>{breakerNote(breaker, harnessName)}</span>
                <button type="button" className="secondary" disabled={busy} onClick={() => act("breaker.reset", { harness: breaker.harness })}>
                  <RotateCcw size={14} />
                  Try now
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No harness is waiting on a usage limit. After two limit or sign-in refusals in 10 minutes, a harness's routines,
            Autopilot tasks and hand-offs wait (15 minutes, then 30, 60 and 120) instead of failing again and again. Messages from
            you, Slack, Buzz or your phone still try.
          </p>
        )}
      </div>

      {dontAsk.length > 0 && (
        <div className="team-block">
          <h3>Bots that act without asking</h3>
          <p>With Team on, these bots only take work you send them. Tick one to let it take routines, Autopilot tasks and hand-offs too.</p>
          <ul className="team-optins">
            {dontAsk.map((employee) => (
              <li key={employee.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={settings.dontAskAllowed.includes(employee.id)}
                    onChange={(event) => allow(employee, event.target.checked)}
                  />
                  {employee.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {codex.length > 0 && !team.codexUnattended && (
        <p className="team-note">
          Codex bots ({codex.map((e) => e.name).join(", ")}) only take work you send them while Team is on. Their MCP servers
          run outside Codex's sandbox, and Any Bot can't yet switch them off for work nobody is watching.
        </p>
      )}
      <p className="team-note team-ceiling">
        <strong>Your Claude and ChatGPT plans are the real ceiling.</strong> Bots run on the same plans as your own Claude Code
        and Codex, so a busy team can use up the 5-hour or weekly limit you work with too. Start with low limits, and check
        Activity → Tokens today before you raise them.
      </p>
    </section>
  );
}
