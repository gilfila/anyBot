import React, { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import "./team.css";

// Settings → Team: the daily people review's switch and time. It is on by
// default (it only reads and uses no tokens); people.set checks the time.
// The review itself is in Org → People and on the HQ room's canvas.
const clean = (message) => String(message || "").replace(/^Error invoking remote method '[^']+': Error: /, "");

export function PeopleReviewSettings() {
  const [state, setState] = useState(null);
  const [time, setTime] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!window.anybot) return undefined;
    let live = true;
    window.anybot
      .request("people.review")
      .then((next) => live && setState(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!state) return null;
  const { enabled, at } = state.settings;
  const set = async (payload) => {
    setBusy(true);
    try {
      setState(await window.anybot.request("people.set", payload));
      setError("");
      setTime(null);
    } catch (e) {
      setError(clean(e.message));
    } finally {
      setBusy(false);
    }
  };
  const last = state.latest;
  return (
    <div className="settings-card team-card people-settings">
      <div className="team-icon" aria-hidden="true">
        <UserCheck size={20} />
      </div>
      <div>
        <h3>Daily people review</h3>
        <p>
          Once a day Any Bot looks at each bot's last 14 days (failed runs, cost per task, work sent back or redone, declined
          tool requests, stuck cards and busywork) and gives it a verdict, OK, Watch, Adjust or Fire candidate, with one
          suggested fix. It uses no tokens and changes nothing. The breakdown goes to your HQ room's canvas and to Org → People.
        </p>
        <label className="people-time">
          <span>Runs at</span>
          <input
            type="time"
            value={time ?? at}
            disabled={!enabled || busy}
            onChange={(event) => setTime(event.target.value)}
            onBlur={() => time && time !== at && set({ at: time })}
          />
        </label>
        {last && (
          <small className="team-note">
            Last review: {new Date(last.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            {last.late ? " (late)" : ""}. Missed ones run when Any Bot next starts.
          </small>
        )}
        {error && (
          <p className="people-settings-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={enabled}
        aria-label="Daily people review on"
        disabled={busy}
        onClick={() => set({ enabled: !enabled })}
      />
    </div>
  );
}
