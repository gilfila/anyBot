import React, { useEffect, useState } from "react";
import { Copy, ExternalLink, Hash, UserPlus } from "lucide-react";
import { slackCreateAppUrl, slackManifest } from "../../runtime/slack-format.mjs";
import "./slack-panel.css";

const STATE_TEXT = {
  online: ["ok", "Connected to Slack"],
  connecting: ["warn", "Connecting to Slack…"],
  starting: ["warn", "Starting…"],
  off: ["warn", "Starting…"],
  error: ["off", "Can't reach Slack"],
};

// A bot's menu → Connect to Slack. Each bot gets its own Slack app (made from
// a manifest), so it shows up in Slack under its own name. The tokens go to
// the main process (runtime/slack-bridge.mjs) and never come back.
export function SlackPanel({ employee }) {
  const [status, setStatus] = useState(null);
  const [tokens, setTokens] = useState({ botToken: "", appToken: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = () =>
    window.anybot
      ?.request("slack.status", { employee: employee.id })
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
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const connect = async (event) => {
    event.preventDefault();
    if (await call("slack.connect", tokens)) setTokens({ botToken: "", appToken: "" });
  };
  const copyManifest = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(slackManifest(employee.name), null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Use Open Slack instead.");
    }
  };

  if (!status) return <p className="slack-panel">Loading…</p>;

  if (!status.connected)
    return (
      <div className="slack-panel">
        <p>
          Give {employee.name} a Slack app of its own, so you can DM it or @mention it in a channel. It runs on this
          computer: Slack never needs to reach in, and only people you pair can give it work.
        </p>
        <ol className="slack-steps">
          <li>
            <strong>Create {employee.name}'s Slack app.</strong> Slack opens with everything filled in. Pick your
            workspace, then click <em>Next</em> and <em>Create</em>.
            <div className="slack-actions">
              <button type="button" className="primary" onClick={() => window.anybot.openUrl(slackCreateAppUrl(employee.name))}>
                <ExternalLink size={15} />
                Open Slack
              </button>
              <button type="button" className="secondary" onClick={copyManifest}>
                <Copy size={15} />
                {copied ? "Copied" : "Copy the manifest"}
              </button>
            </div>
          </li>
          <li>
            <strong>Install it.</strong> In the app's settings, open <em>Install App</em>, click <em>Install to
            workspace</em>, and allow it. Copy the <em>Bot User OAuth Token</em> (it starts with <code>xoxb-</code>).
          </li>
          <li>
            <strong>Make an app token.</strong> Open <em>Basic Information</em>, scroll to <em>App-Level Tokens</em>, and
            click <em>Generate Token and Scopes</em>. Add the <code>connections:write</code> scope, then copy the token (it
            starts with <code>xapp-</code>).
          </li>
          <li>
            <strong>Paste both here.</strong>
            <form className="slack-tokens" onSubmit={connect}>
              <label>
                Bot token
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="xoxb-…"
                  value={tokens.botToken}
                  onChange={(e) => setTokens({ ...tokens, botToken: e.target.value })}
                />
              </label>
              <label>
                App token
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="xapp-…"
                  value={tokens.appToken}
                  onChange={(e) => setTokens({ ...tokens, appToken: e.target.value })}
                />
              </label>
              <button type="submit" className="primary" disabled={busy || !tokens.botToken || !tokens.appToken}>
                {busy ? "Connecting…" : "Connect"}
              </button>
            </form>
          </li>
        </ol>
        {error && (
          <p className="slack-error" role="alert">
            {error}
          </p>
        )}
        <p className="slack-hint">
          Tip: to give it {employee.name}'s picture, upload one under <em>Basic Information → Display Information</em>.
          The tokens are stored encrypted on this computer.
        </p>
      </div>
    );

  const [tone, label] = STATE_TEXT[status.state] || STATE_TEXT.starting;
  const handle = `@${status.botName || employee.name}`;
  const remaining = status.pairing ? Math.max(0, Date.parse(status.pairing.expires) - now) : 0;
  return (
    <div className="slack-panel">
      <p className={`slack-status is-${tone}`}>
        <span aria-hidden="true" />
        {status.state === "error" && status.error ? `${label}: ${status.error}` : label}
        {status.team && <small> · {status.team}</small>}
      </p>
      {status.pairing && remaining > 0 && (
        <div className="slack-code" role="status">
          <small>DM {handle} this code in Slack to pair yourself:</small>
          <strong>
            {status.pairing.code.slice(0, 3)} {status.pairing.code.slice(3)}
          </strong>
          <small>
            Works once, for {Math.floor(remaining / 60000)}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")} more.
          </small>
        </div>
      )}
      <h3>Who can give {employee.name} work in Slack</h3>
      {status.users.length ? (
        <ul className="slack-people">
          {status.users.map((person) => (
            <li key={person.id}>
              <span>{person.name}</span>
              <button type="button" className="secondary" disabled={busy} onClick={() => call("slack.removeUser", { user: person.id })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="slack-hint">Nobody yet. Pair yourself with the code above.</p>
      )}
      <div className="slack-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => call("slack.pair")}>
          <UserPlus size={15} />
          {status.users.length ? "Pair someone else" : "New pairing code"}
        </button>
      </div>
      <h3>Using it</h3>
      <ul className="slack-usage">
        <li>
          DM <strong>{handle}</strong> in Slack. Its reply comes back in the DM, and the conversation also shows in its
          chat here.
        </li>
        <li>
          <Hash size={13} aria-hidden="true" /> In a channel, type <code>/invite {handle}</code>, then @mention it. It replies
          in a thread.
        </li>
        <li>When it needs your OK for something risky, it posts Approve and Deny buttons.</li>
      </ul>
      {error && (
        <p className="slack-error" role="alert">
          {error}
        </p>
      )}
      <div className="slack-actions slack-disconnect">
        <button type="button" className="secondary danger" disabled={busy} onClick={() => call("slack.disconnect")}>
          Disconnect from Slack
        </button>
      </div>
    </div>
  );
}
