import React, { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import "./team.css";

// Settings → Team: the daily people review's switch and time. It is on by
// default (it only reads and uses no tokens); people.set checks the time.
// The review itself is in Org → People and on the HQ room's canvas. `stamp`
// is the snapshot's `people` (JSON): when a review runs it changes, and the
// row fetches again. A failed load keeps the card, with Try again, since
// this is the review's only off switch.
const clean = (message) => String(message || "").replace(/^Error invoking remote method '[^']+': Error: /, "");

export function PeopleReviewSettings({ stamp = "" }) {
  const [state, setState] = useState(null);
  const [time, setTime] = useState(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!window.anybot) return undefined;
    let live = true;
    window.anybot
      .request("people.review")
      .then((next) => {
        if (!live) return;
        setState(next);
        setLoadError("");
      })
      .catch((e) => live && setLoadError(clean(e.message) || "The review's settings didn't load."));
    return () => {
      live = false;
    };
  }, [stamp, attempt]);
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
  const enabled = state?.settings?.enabled;
  const at = state?.settings?.at;
  // Enter or leaving the field saves; an empty field goes back to the saved time.
  const saveTime = () => {
    if (!time) setTime(null);
    else if (time !== at) set({ at: time });
  };
  const last = state?.latest;
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
        {at && (
          <form
            className="people-time"
            onSubmit={(event) => {
              event.preventDefault();
              saveTime();
            }}
          >
            <label>
              <span>Runs at</span>
              <input
                type="time"
                value={time ?? at}
                disabled={!enabled || busy}
                onChange={(event) => setTime(event.target.value)}
                onBlur={saveTime}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setTime(null);
                }}
              />
            </label>
          </form>
        )}
        {last && (
          <small className="team-note">
            Last review: {new Date(last.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            {last.late ? " (late)" : ""}. Missed ones run when Any Bot next starts.
          </small>
        )}
        {loadError && (
          <p className="people-settings-error" role="alert">
            Couldn't load the review's settings: {loadError}{" "}
            <button type="button" className="mini" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </p>
        )}
        {error && (
          <p className="people-settings-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {/* Until the settings load, no switch: a disabled "off" would say the review is off. */}
      {at ? (
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={Boolean(enabled)}
          aria-label="Daily people review on"
          disabled={busy}
          onClick={() => set({ enabled: !enabled })}
        />
      ) : (
        <span />
      )}
    </div>
  );
}
