import React, { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import "./buzz-panel.css";

const BUZZ_DOWNLOAD = "https://github.com/block/buzz/releases/latest";

function ago(iso, now) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
}

function CopyValue({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The value is on screen to type instead.
    }
  };
  return (
    <span className="buzz-copy">
      <small>{label}</small>
      <code>{value}</code>
      <button type="button" className="secondary" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function Step({ n, done, current, title, children }) {
  const state = done ? "done" : current ? "current" : "todo";
  return (
    <li className={`buzz-step is-${state}`} aria-current={current ? "step" : undefined}>
      <span className="buzz-step-mark" aria-label={done ? "Done" : `Step ${n}`}>
        {done ? <Check size={14} aria-hidden="true" /> : n}
      </span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

// A bot's menu → Connect to Buzz. Buzz Desktop runs a Buzz agent on Any Bot
// (runtime/anybot-acp.mjs); @mentions come in through the local connection in
// runtime/buzz-bridge.mjs. Buzz keeps the agent's keys.
export function BuzzPanel({ employee }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restarted, setRestarted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = () =>
    window.anybot
      ?.request("buzz.status", { employee: employee.id })
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      load();
      setNow(Date.now());
    }, 2000);
    return () => clearInterval(timer);
  }, [employee.id]);
  const call = async (method, payload = {}) => {
    setBusy(true);
    setError("");
    try {
      setStatus(await window.anybot.request(method, { employee: employee.id, ...payload }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className="buzz-panel">Loading…</p>;

  const on = status.enabled && status.listening;
  const added = Boolean(status.harness?.current);
  const heard = Boolean(status.recent);
  const agentMade = heard || restarted;
  const current = !on ? 1 : !added ? 2 : !agentMade ? 3 : !heard ? 4 : 0;

  return (
    <div className="buzz-panel">
      <p>
        Let people @mention {employee.name} in Buzz.
        Buzz Desktop runs a Buzz agent that hands each mention to {employee.name} here, then posts the reply in the Buzz
        thread. Buzz keeps the agent's identity; Any Bot stores no Buzz keys.
      </p>
      {heard && (
        <p className={`buzz-live is-${status.recent.status === "succeeded" ? "ok" : status.recent.status === "running" ? "warn" : "off"}`} role="status">
          <span aria-hidden="true" />
          {status.recent.status === "running" ? "Working on a Buzz message" : "Connected"}
          <small>
            {" "}
            · last message {ago(status.recent.at, now)}
            {status.recent.channel ? ` in ${status.recent.channel}` : ""}
            {status.recent.status !== "running" && status.recent.status !== "succeeded" ? ` (${status.recent.status})` : ""}
          </small>
        </p>
      )}
      <ol className="buzz-steps">
        <Step n={1} done={on} current={current === 1} title="Turn on the Buzz connection">
          <p>
            A local connection that only programs on this computer can reach. It's shared by every bot you connect.
            {status.enabled && !status.listening && " It's on but couldn't start; see Settings → Diagnostics."}
          </p>
          <div className="buzz-actions">
            <button type="button" className={current === 1 ? "primary" : "secondary"} disabled={busy} onClick={() => call("buzz.set", { enabled: !status.enabled })}>
              {status.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
        </Step>
        <Step n={2} done={added} current={current === 2} title="Add Any Bot to Buzz Desktop">
          {status.buzzFound ? (
            <p>
              {status.harness && !added
                ? "Any Bot moved since it was added, so Buzz would start the old copy. Add it again."
                : "Adds Any Bot to the list of runtimes Buzz Desktop can run an agent on."}
            </p>
          ) : (
            <p>Buzz Desktop isn't on this computer yet. Install it and open it once, then come back.</p>
          )}
          <div className="buzz-actions">
            {!status.buzzFound && (
              <button type="button" className={current === 2 ? "primary" : "secondary"} onClick={() => window.anybot.openUrl(BUZZ_DOWNLOAD)}>
                <ExternalLink size={15} />
                Get Buzz Desktop
              </button>
            )}
            <button
              type="button"
              className={current === 2 && status.buzzFound ? "primary" : "secondary"}
              disabled={busy || !status.buzzFound}
              onClick={() => call("buzz.install")}
            >
              {added ? "Add again" : "Add to Buzz Desktop"}
            </button>
          </div>
        </Step>
        <Step n={3} done={agentMade} current={current === 3} title={`Make ${employee.name}'s agent in Buzz`}>
          <p>
            <em>Quit and reopen Buzz Desktop</em> so it sees Any Bot. Then create an agent, choose <strong>Any Bot</strong> as
            its runtime, and name it after {employee.name}. Under <em>Advanced → Environment variables</em>, add this line so
            it always reaches this bot, even if you rename either one:
          </p>
          <div className="buzz-values">
            <CopyValue label="Name" value={employee.name} />
            <CopyValue label="Variable" value="ANYBOT_EMPLOYEE" />
            <CopyValue label="Value" value={employee.id} />
          </div>
          {!agentMade && (
            <div className="buzz-actions">
              <button type="button" className={current === 3 ? "primary" : "secondary"} disabled={!added} onClick={() => setRestarted(true)}>
                I've made the agent
              </button>
            </div>
          )}
        </Step>
        <Step n={4} done={heard} current={current === 4} title="Say hello">
          <p>
            Add the agent to a Buzz channel and @mention it. {employee.name} works on it here (you'll see it in its direct
            chat) and replies in the Buzz thread.
            {!heard && on && added && " This step ticks itself off when the first message arrives."}
          </p>
        </Step>
      </ol>
      {error && (
        <p className="buzz-error" role="alert">
          {error}
        </p>
      )}
      <h3>Good to know</h3>
      <ul className="buzz-notes">
        <li>By default a Buzz agent only answers its owner. Change who it answers in the agent's settings in Buzz.</li>
        <li>
          Risky steps still wait for your approval in Any Bot. The Buzz thread only says {employee.name} is waiting; it never
          shows the command.
        </li>
        <li>
          <code>!cancel</code> in Buzz, or a new mention while it's working, stops the run here.
        </li>
        <li>Any Bot has to be running for the agent to answer. If it isn't, the agent says so in the thread.</li>
      </ul>
    </div>
  );
}
