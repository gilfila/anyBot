import React from "react";
import { CirclePause, OctagonX, Play, RotateCcw, Zap } from "lucide-react";
import { breakerNote, breakerShort, breakerTitle, clockTime, openBreakers, resumeChoices } from "../lib/team.js";
import "./team.css";

// The sidebar's Team strip: working count and today's runs, the pause, and
// any harness waiting on a usage limit. Hidden while Team is off and nothing
// is waiting, so nothing changes for people who don't use it.
export function TeamPulse({ team, harnessName, busy, onOpen, onAct }) {
  if (!team) return null;
  const breakers = openBreakers(team);
  if (team.state === "off" && !breakers.length) return null;
  const label =
    team.state === "running"
      ? `Team on · ${team.working ?? 0} working · ${team.today?.org ?? 0}/${team.settings?.orgRunsPerDay ?? 0} today`
      : team.state === "paused"
        ? `Team paused until ${clockTime(team.pausedUntil)}`
        : team.state === "stopped"
          ? "Team stopped"
          : null;
  // Screen readers hear the state when it changes, not every run count.
  const announced = { running: "Team on", paused: "Team paused", stopped: "Team stopped" }[team.state] || "";
  return (
    <div className={`team-pulse is-${team.state}`}>
      <span className="visually-hidden" role="status">
        {[announced, ...breakers.map((breaker) => `${breakerTitle(breaker, harnessName)}, ${breakerShort(breaker)}`)].filter(Boolean).join(". ")}
      </span>
      {label && (
        <div className="team-pulse-row">
          <button type="button" className="team-pulse-main" title="Open Settings → Team" onClick={onOpen}>
            {team.state === "stopped" ? <OctagonX size={13} /> : team.state === "paused" ? <CirclePause size={13} /> : <Zap size={13} />}
            <span>{label}</span>
          </button>
          {team.state === "running" ? (
            <button
              type="button"
              className="resume-link"
              title="Pause the team for 1 hour"
              aria-label="Pause the team for 1 hour"
              disabled={busy}
              onClick={() => onAct("team.pause", { minutes: 60 })}
            >
              Pause 1h
            </button>
          ) : (
            resumeChoices(team).map(({ label: choice, payload }) => (
              <button key={choice} type="button" className="resume-link" disabled={busy} onClick={() => onAct("team.resume", payload)}>
                {payload?.enabled !== false && <Play size={11} />}
                {choice}
              </button>
            ))
          )}
        </div>
      )}
      {breakers.map((breaker) => (
        <div className="team-pulse-row team-pulse-breaker" key={breaker.harness}>
          <span>
            {breakerTitle(breaker, harnessName)} · {breakerShort(breaker)}
          </span>
          <button
            type="button"
            className="resume-link"
            title="Let its waiting work try again now"
            disabled={busy}
            onClick={() => onAct("breaker.reset", { harness: breaker.harness })}
          >
            <RotateCcw size={11} />
            Try now
          </button>
        </div>
      ))}
    </div>
  );
}

// Above a chat's message box: the team is stopped or paused, or a harness
// this chat's bots use (`harnesses`, ids) is waiting on a usage limit.
export function TeamBanner({ team, harnesses = [], harnessName = (id) => id, busy, onAct }) {
  if (!team) return null;
  const used = new Set(harnesses);
  const breakers = openBreakers(team).filter((breaker) => used.has(breaker.harness));
  return (
    <>
      {(team.state === "stopped" || team.state === "paused") && (
        <div className={`paused-banner team-banner is-${team.state}`} role="status">
          {team.state === "stopped" ? <OctagonX size={18} /> : <CirclePause size={18} />}
          <span>
            {team.state === "stopped"
              ? "The team is stopped: nothing starts on its own here. Your own messages still go through."
              : `The team is paused until ${clockTime(team.pausedUntil)}: nothing starts on its own. Your own messages still go through.`}
          </span>
          {resumeChoices(team).map(({ label, payload }) => (
            <button key={label} type="button" className="secondary" disabled={busy} onClick={() => onAct("team.resume", payload)}>
              {payload?.enabled !== false && <Play size={14} />}
              {label}
            </button>
          ))}
        </div>
      )}
      {breakers.map((breaker) => (
        <div className="paused-banner team-banner" role="status" key={breaker.harness}>
          <Zap size={18} />
          <span>{breakerNote(breaker, harnessName)}</span>
          <button type="button" className="secondary" disabled={busy} onClick={() => onAct("breaker.reset", { harness: breaker.harness })}>
            <RotateCcw size={14} />
            Try now
          </button>
        </div>
      ))}
    </>
  );
}
