import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Settings,
  Square,
  Users,
  Volume2,
  Workflow,
  WifiOff,
} from "lucide-react";
import { createClient } from "./client.mjs";
import { createListener, createSpeaker, voiceError } from "../src/lib/voice.js";
import { awaitReply } from "../src/lib/voice-turn.js";
import { createNativeListener, nativeSpeech, nativeVoiceAvailable } from "./native-voice.mjs";

const voicePhaseLabel = {
  listening: "Listening",
  transcribing: "Hearing you",
  thinking: "Working",
  speaking: "Speaking",
};
import { beginOidc, consumeOidcCallback } from "./oidc.mjs";
import "./style.css";

const blank = { employees: [], conversations: [], runs: [], runtime: {} };
const active = (r) => ["running", "queued", "cancelling"].includes(r.status);
function Avatar({ name }) {
  return (
    <span className="avatar">{name?.slice(0, 1) || <Bot size={20} />}</span>
  );
}
function App() {
  const [client, setClient] = useState(null),
    [data, setData] = useState(blank),
    [view, setView] = useState("chats"),
    [thread, setThread] = useState(null),
    [detail, setDetail] = useState(null),
    [error, setError] = useState(""),
    [online, setOnline] = useState(false),
    [busy, setBusy] = useState(false),
    [recipients, setRecipients] = useState([]),
    [drafts, setDrafts] = useState({}),
    [newChat, setNewChat] = useState(false),
    [pendingRequests, setPendingRequests] = useState({});
  const [audit, setAudit] = useState(null);
  const [memberForm, setMemberForm] = useState({ id: "", name: "", role: "member" });
  const pending = pendingRequests[thread];
  const setPending = (value) =>
    setPendingRequests((p) => ({ ...p, [thread]: value }));
  const refreshLock = useRef(null);
  const generation = useRef(0),
    sending = useRef(false),
    listener = useRef(null),
    speaker = useRef(null),
    // Bumped on every voice start/stop and on unmount so callbacks from an
    // old listener or reply wait know they are stale.
    voiceTurn = useRef(0);
  const [dictating, setDictating] = useState(false);
  const [voiceChat, setVoiceChat] = useState(false);
  const [voicePhase, setVoicePhase] = useState(null);
  const draft = drafts[thread] || "";
  const name = (id) =>
    data.employees.find((e) => e.id === id)?.name ||
    (id === "human" ? "You" : "Coordinator");
  function disconnect() {
    generation.current++;
    setClient(null);
    setData(blank);
    setDetail(null);
    setThread(null);
    setDrafts({});
    setPendingRequests({});
    setOnline(false);
    setError("");
    setAudit(null);
  }
  async function refresh() {
    if (!client) return;
    if (refreshLock.current === generation.current) return;
    const g = ++generation.current;
    refreshLock.current = g;
    try {
      const overview = await client.request("/overview");
      const content = thread
        ? await client.request(`/conversations/${thread}`)
        : null;
      if (g !== generation.current) return;
      setData(overview);
      if (content)
        setDetail((previous) => {
          if (previous?.conversation.id !== content.conversation.id)
            return content;
          const merged = new Map(
            [...previous.messages, ...content.messages].map((m) => [m.id, m]),
          );
          return {
            ...content,
            messages: [...merged.values()],
            olderCursor:
              previous.messages.length > content.messages.length
                ? previous.olderCursor
                : content.olderCursor,
          };
        });
      setOnline(true);
    } catch (e) {
      if (g !== generation.current) return;
      setOnline(false);
      if (e.status === 401) {
        disconnect();
        setError(
          "Session expired or revoked. Connect again from your desktop.",
        );
      }
    } finally {
      if (refreshLock.current === g) refreshLock.current = null;
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 4000);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      generation.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, thread]);
  function open(c) {
    setThread(c.id);
    setDetail(null);
    setRecipients(
      c.members
        .filter((id) => data.employees.some((e) => e.id === id && !e.archived))
        .slice(0, 1),
    );
    setView("chats");
    setError("");
  }
  async function send(event, bodyOverride = null) {
    event?.preventDefault();
    const body = bodyOverride ?? draft;
    if (sending.current || !online || !body.trim() || !recipients.length)
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    const payload =
      pending?.conversation === thread
        ? pending
        : {
            conversation: thread,
            body,
            recipients: [...recipients],
            requestId: crypto.randomUUID(),
          };
    setPending(payload);
    try {
      await client.request(`/conversations/${thread}/messages`, {
        method: "POST",
        body: payload,
      });
      setDrafts((d) => ({ ...d, [thread]: "" }));
      setPending(null);
      await refresh();
    } catch (e) {
      setError(
        `${e.message}. Your message is kept. Retry sends the same request, avoiding duplicate work.`,
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function stop(id) {
    setError("");
    try {
      await client.request(`/runs/${id}/cancel`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  // The phone follows the desktop's Voice settings. With ElevenLabs connected
  // on the desktop, audio goes through the gateway (the key never leaves the
  // desktop) and each bot keeps its voice. Otherwise the phone's own speech
  // engine is used: native plugins in the app, the browser API on the web.
  async function voiceConfig() {
    try {
      return await client.request("/voice");
    } catch {
      return { cloud: false, stt: "system", tts: "system" };
    }
  }
  function makeListener(config, handlers) {
    if (config.cloud && config.stt === "elevenlabs" && navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
      return createListener({ provider: "elevenlabs", transcribe: (blob) => client.transcribe(blob), ...handlers });
    if (nativeVoiceAvailable()) return createNativeListener(handlers);
    return createListener({ provider: "system", ...handlers });
  }
  function stopVoice() {
    voiceTurn.current += 1;
    listener.current?.stop();
    speaker.current?.cancel();
    listener.current = speaker.current = null;
    setDictating(false);
    setVoiceChat(false);
    setVoicePhase(null);
  }
  useEffect(() => {
    if (listener.current) stopVoice();
  }, [thread]);
  useEffect(() => () => stopVoice(), []);
  async function toggleDictation() {
    if (dictating) {
      stopVoice();
      return;
    }
    stopVoice();
    const turn = voiceTurn.current,
      live = () => voiceTurn.current === turn,
      target = thread;
    const config = await voiceConfig();
    if (!live()) return;
    const next = makeListener(config, {
      onText: (text) => {
        if (live())
          setDrafts((d) => ({ ...d, [target]: `${d[target] || ""}${d[target] ? " " : ""}${text}` }));
      },
      onError: (message) => live() && setError(message),
      onEnd: () => live() && stopVoice(),
    });
    listener.current = next;
    setDictating(true);
    setError("");
    try {
      await next.start();
    } catch (e) {
      if (live()) {
        setError(voiceError(e));
        stopVoice();
      }
    }
  }
  async function startVoiceChat() {
    if (voiceChat) {
      stopVoice();
      return;
    }
    if (!conversation || conversation.members.length !== 1) {
      setError("Voice chat is available for one employee at a time.");
      return;
    }
    const employee = data.employees.find((e) => e.id === conversation.members[0]);
    if (!employee) return;
    stopVoice();
    const turn = voiceTurn.current,
      live = () => voiceTurn.current === turn,
      convId = thread;
    const config = await voiceConfig();
    if (!live()) return;
    const talk = createSpeaker({
      provider: config.cloud && config.tts === "elevenlabs" ? "elevenlabs" : "system",
      synthesize: (text, id) => client.speak(text, id),
      local: nativeVoiceAvailable() ? nativeSpeech : null,
      onError: (message) => live() && setError(message),
    });
    const say = async (text) => {
      if (!live() || !text) return;
      setVoicePhase("speaking");
      await talk.speak(text, employee.id);
      if (live()) setVoicePhase("thinking");
    };
    const load = () => client.request(`/conversations/${convId}`);
    const next = makeListener(config, {
      onState: (phase) => live() && setVoicePhase(phase),
      onError: (message) => live() && setError(message),
      onEnd: () => live() && stopVoice(),
      onText: async (text) => {
        if (!live()) return;
        // The microphone stays off while the bot works and talks.
        next.pause();
        setVoicePhase("thinking");
        try {
          const before = new Set((await load()).messages.map((m) => m.id));
          await client.request(`/conversations/${convId}/messages`, {
            method: "POST",
            body: { body: text, recipients: [employee.id], requestId: crypto.randomUUID() },
          });
          refresh();
          await say("On it.");
          const reply = await awaitReply({ load, body: text, employee, before, live, say });
          refresh();
          await say(reply);
        } catch (e) {
          if (live()) setError(voiceError(e));
        } finally {
          if (live()) {
            setVoicePhase("listening");
            next.resume();
          }
        }
      },
    });
    listener.current = next;
    speaker.current = talk;
    setVoiceChat(true);
    setVoicePhase("listening");
    setError("");
    try {
      await next.start();
    } catch (e) {
      if (live()) {
        setError(voiceError(e));
        stopVoice();
      }
    }
  }
  if (!client)
    return (
      <Connect
        error={error}
        onOidcSignIn={async (address, issuer, clientId) => {
          const redirectUri = `${window.location.origin}${window.location.pathname}`;
          const authorizationUrl = await beginOidc({
            workspaceAddress: address,
            issuer,
            clientId,
            redirectUri,
          });
          window.location.assign(authorizationUrl);
        }}
        onConnect={async (address, code, identityToken) => {
          let next;
          if (identityToken.trim()) {
            // OIDC access tokens stay in memory and are never persisted.
            next = createClient(address, identityToken.trim());
          } else {
            const entry = createClient(address);
            const session = await entry.request("/pair", {
              method: "POST",
              body: { code, name: "anyBot mobile" },
            });
            next = createClient(address, session.token);
          }
          const overview = await next.request("/overview");
          setData(overview);
          setClient(next);
          setOnline(true);
          setError("");
        }}
      />
    );
  const conversation =
    data.conversations.find((c) => c.id === thread) || detail?.conversation;
  return (
    <div className="phone-shell">
      <header>
        <div>
          {thread && view === "chats" ? (
            <button
              className="icon"
              aria-label="Back to conversations"
              onClick={() => {
                setThread(null);
                setDetail(null);
              }}
            >
              <ArrowLeft />
            </button>
          ) : (
            <span className="brand">
              <Bot /> anyBot
            </span>
          )}
          <small className={online ? "connection" : "connection offline"}>
            {online ? "Connected to your team" : "Host unreachable"}
          </small>
        </div>
        <button className="icon" aria-label="Refresh" onClick={refresh}>
          <RefreshCw size={19} />
        </button>
      </header>
      {!online && (
        <div className="notice">
          <WifiOff size={16} /> Your host may be offline. Drafts stay here; work
          status may be out of date.
        </div>
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <main className={thread && view === "chats" ? "conversation" : ""}>
        {view === "chats" && !thread && (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">YOUR WORKSPACE</p>
                <h1>Conversations</h1>
              </div>
              <button
                className="icon primary"
                aria-label="New conversation"
                onClick={() => setNewChat(true)}
              >
                <Plus />
              </button>
            </div>
            <p className="intro">
              Your people. Your agents. One place to work.
            </p>
            {data.conversations.length ? (
              data.conversations
                .slice()
                .reverse()
                .map((c) => (
                  <button
                    className="chat-row"
                    key={c.id}
                    onClick={() => open(c)}
                  >
                    <Avatar name={c.title} />
                    <span>
                      <strong>{c.title}</strong>
                      <small>{c.members.map(name).join(", ")}</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))
            ) : (
              <Empty
                title="Start something together"
                text="Create a conversation with an employee from your desktop team."
              />
            )}
            {data.moreConversations && (
              <p className="muted">
                Showing the latest 100 conversations. Older conversations remain
                on desktop.
              </p>
            )}
          </>
        )}
        {view === "chats" && thread && (
          <>
            <div className="thread-title">
              <h1>{conversation?.title || "Conversation"}</h1>
              <p>{conversation?.members.map(name).join(" · ")}</p>
              {conversation?.delegation ? (
                <span className="pill">Team handoffs enabled</span>
              ) : null}
              {conversation?.members.length === 1 ? (
                <button
                  className={`voice-chat ${voiceChat ? "active" : ""}`}
                  aria-label={voiceChat ? "Stop voice chat" : "Start voice chat"}
                  onClick={startVoiceChat}
                >
                  <Volume2 size={16} /> {voiceChat ? voicePhaseLabel[voicePhase] || "Listening" : "Voice chat"}
                </button>
              ) : null}
            </div>
            <section className="messages" aria-label="Messages">
              {!detail ? (
                <p>Loading conversation…</p>
              ) : (
                <>
                  {detail.olderCursor && (
                    <button
                      className="secondary"
                      onClick={async () => {
                        try {
                          const older = await client.request(
                            `/conversations/${thread}?before=${detail.olderCursor}`,
                          );
                          setDetail((d) =>
                            d?.conversation.id !== older.conversation.id
                              ? d
                              : {
                                  ...d,
                                  messages: [...older.messages, ...d.messages],
                                  olderCursor: older.olderCursor,
                                },
                          );
                        } catch (e) {
                          setError(e.message);
                        }
                      }}
                    >
                      Load earlier messages
                    </button>
                  )}
                  {detail.messages.map((m) => (
                    <article
                      className={`message ${m.author === "human" ? "mine" : ""}`}
                      key={m.id}
                    >
                      <div className="byline">
                        {name(m.author)}{" "}
                        <time>
                          {new Date(m.created).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <div className="bubble">{m.body}</div>
                    </article>
                  ))}
                  {!detail.messages.length && (
                    <Empty
                      title="What are we working on?"
                      text="Choose who should respond, then send your first assignment."
                    />
                  )}
                  {detail.runs.filter(active).map((r) => (
                    <article className="live-run" key={r.id}>
                      <div>
                        <strong>{name(r.employee)}</strong>
                        <span className="pill">{r.status}</span>
                        <button
                          className="icon"
                          aria-label={`Stop ${name(r.employee)}`}
                          onClick={() => stop(r.id)}
                        >
                          <Square size={15} />
                        </button>
                      </div>
                      <p>{r.output || "Working on your request…"}</p>
                    </article>
                  ))}
                </>
              )}
            </section>
            <form className="composer" onSubmit={send}>
              <div className="recipients" aria-label="Recipients">
                {conversation?.members.map((id) => {
                  const e = data.employees.find((e) => e.id === id);
                  return e && !e.archived ? (
                    <button
                      type="button"
                      disabled={!!pending}
                      className={
                        recipients.includes(id) ? "chip chosen" : "chip"
                      }
                      key={id}
                      onClick={() =>
                        setRecipients((ids) =>
                          ids.includes(id)
                            ? ids.filter((x) => x !== id)
                            : [...ids, id],
                        )
                      }
                    >
                      {recipients.includes(id) && <Check size={12} />} {e.name}
                    </button>
                  ) : null;
                })}
              </div>
              <div className="compose-input">
                <textarea
                  aria-label="Message your team"
                  placeholder="Give your team an assignment…"
                  value={draft}
                  disabled={!!pending}
                  maxLength={24000}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [thread]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className={`dictate ${dictating ? "active" : ""}`}
                  aria-label={dictating ? "Stop dictation" : "Dictate message"}
                  title={dictating ? "Stop dictation" : "Dictate message"}
                  onClick={toggleDictation}
                  disabled={!!pending || voiceChat}
                >
                  <Mic size={18} />
                </button>
                <button
                  className="send"
                  aria-label={pending ? "Retry message" : "Send message"}
                  disabled={
                    busy || !online || !draft.trim() || !recipients.length
                  }
                >
                  <ArrowUp size={22} />
                </button>
              </div>
              <small>
                {pending
                  ? "Delivery uncertain. Retry uses the same request ID."
                  : !online
                    ? "Offline draft · not sent"
                    : "Your agents keep working on the host."}
              </small>
            </form>
          </>
        )}
        {view === "team" && (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">BUILT TOGETHER</p>
                <h1>Your team</h1>
              </div>
              <Users />
            </div>
            <p className="intro">Different strengths. A shared conversation.</p>
            {data.employees
              .filter((e) => !e.archived)
              .map((e) => (
                <article className="employee" key={e.id}>
                  <Avatar name={e.name} />
                  <div>
                    <h2>{e.name}</h2>
                    <p>{e.role}</p>
                    <span className="pill">{e.harness}</span>
                  </div>
                  <button
                    className="icon"
                    aria-label={`Chat with ${e.name}`}
                    onClick={() => {
                      const existing = data.conversations.find(
                        (c) => c.members.length === 1 && c.members[0] === e.id,
                      );
                      if (existing) open(existing);
                      else setNewChat({ employee: e.id });
                    }}
                  >
                    <MessageSquare size={20} />
                  </button>
                </article>
              ))}
            {!data.employees.length && (
              <Empty
                title="Your team starts on desktop"
                text="Create employees on the main app, then return here to work with them."
              />
            )}
          </>
        )}
        {view === "work" && (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">IN MOTION</p>
                <h1>Work activity</h1>
              </div>
              <Workflow />
            </div>
            <p className="intro">
              {data.runtime.active || 0} running ·{" "}
              {data.runtime.paused ? "New work paused" : "Ready for new work"}
            </p>
            {data.runs
              .slice()
              .reverse()
              .map((r) => (
                <article className="work-card" key={r.id}>
                  <div>
                    <Avatar name={name(r.employee)} />
                    <strong>{name(r.employee)}</strong>
                    <span className="pill">{r.status}</span>
                  </div>
                  <p>
                    {r.error ||
                      r.output?.slice(-300) ||
                      "Waiting for a response"}
                  </p>
                  {active(r) && (
                    <button className="secondary" onClick={() => stop(r.id)}>
                      <Square size={13} /> Stop work
                    </button>
                  )}
                </article>
              ))}
            {!data.runs.length && (
              <Empty
                title="Room for your next idea"
                text="Send an assignment to see progress here."
              />
            )}
          </>
        )}
        {view === "settings" && (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">YOUR CONNECTION</p>
                <h1>Settings</h1>
              </div>
              <Settings />
            </div>
            <section className="settings-card">
              <h2>Connected workspace</h2>
              <p className="server">{client.origin}</p>
              <p>
                Agents run on this host. Keeping the phone open is not required.
              </p>
              <span className="pill">
                Host version {data.runtime.version || "unknown"}
              </span>
            </section>
            <section className="settings-card">
              <h2>Private by default</h2>
              <p>
                This preview keeps its session and drafts in memory. Closing the
                app may require reconnecting. No provider API keys are stored
                here.
              </p>
              <p>
                Notifications, persistent secure storage, and artifact browsing
                are not enabled yet. Configured human members can share
                conversations with explicit invitations.
              </p>
            </section>
            {(data.memberRole === "owner" || data.deviceRole === "operator") && (
              <section className="settings-card">
                <h2>Audit trail</h2>
                <p>Token-free workspace actions available to owners and operators.</p>
                <button className="secondary" onClick={async () => {
                  try { setAudit((await client.request("/audit?limit=20")).entries); }
                  catch (e) { setError(e.message); }
                }}>Load recent activity</button>
                {audit && <div className="audit-list">{audit.map((entry, index) => <p key={`${entry.at}-${index}`}><strong>{entry.action}</strong> · {entry.actor} · {new Date(entry.at).toLocaleString()}</p>)}</div>}
              </section>
            )}
            {data.memberRole === "owner" && (
              <section className="settings-card">
                <h2>Workspace people</h2>
                <p>Manage the human identities that can be invited into shared conversations.</p>
                <div className="member-list">
                  {(data.humanMembers || []).map((member) => (
                    <p key={member.id}>
                      <strong>{member.name}</strong> · {member.id} · {member.role}
                      {member.role !== "owner" && member.id !== data.memberId && (
                        <button className="secondary" onClick={async () => {
                          try {
                            const result = await client.request(`/members/${encodeURIComponent(member.id)}`, { method: "DELETE" });
                            setData((current) => ({ ...current, humanMembers: result.members }));
                          } catch (e) { setError(e.message); }
                        }}>Remove</button>
                      )}
                    </p>
                  ))}
                </div>
                <form className="member-form" onSubmit={async (event) => {
                  event.preventDefault();
                  try {
                    const result = await client.request("/members", { method: "POST", body: memberForm });
                    setData((current) => ({ ...current, humanMembers: result.members }));
                    setMemberForm({ id: "", name: "", role: "member" });
                  } catch (e) { setError(e.message); }
                }}>
                  <input required maxLength={160} placeholder="Member ID" value={memberForm.id} onChange={(e) => setMemberForm((m) => ({ ...m, id: e.target.value }))} />
                  <input required maxLength={60} placeholder="Display name" value={memberForm.name} onChange={(e) => setMemberForm((m) => ({ ...m, name: e.target.value }))} />
                  <select value={memberForm.role} onChange={(e) => setMemberForm((m) => ({ ...m, role: e.target.value }))}>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button className="primary">Add person</button>
                </form>
              </section>
            )}
            <button
              className="secondary wide"
              onClick={async () => {
                try {
                  await client.request("/session", { method: "DELETE" });
                  disconnect();
                } catch {
                  setError(
                    "Could not revoke this session on the host. Revoke it on desktop, or retry when connected.",
                  );
                }
              }}
            >
              Disconnect and clear this device
            </button>
          </>
        )}
      </main>
      {!(thread && view === "chats") && (
        <nav className="tabs" aria-label="Main navigation">
          {[
            ["chats", "Chats", MessageSquare],
            ["team", "Team", Users],
            ["work", "Work", Workflow],
            ["settings", "Settings", Settings],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              aria-current={view === key ? "page" : undefined}
              onClick={() => setView(key)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {newChat && (
          <NewChat
            employees={data.employees.filter((e) => !e.archived)}
            humanMembers={data.humanMembers || []}
            currentHuman={data.memberId || ""}
          initial={newChat.employee}
          onClose={() => setNewChat(false)}
          onCreate={async (payload) => {
            const c = await client.request("/conversations", {
              method: "POST",
              body: payload,
            });
            setData((d) => ({ ...d, conversations: [...d.conversations, c] }));
            setNewChat(false);
            open(c);
          }}
        />
      )}
    </div>
  );
}
function Empty({ title, text }) {
  return (
    <div className="empty">
      <Bot size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function Connect({ onConnect, onOidcSignIn, error: externalError }) {
  const [address, setAddress] = useState(""),
    [code, setCode] = useState(""),
    [identityToken, setIdentityToken] = useState(""),
    [issuer, setIssuer] = useState(""),
    [clientId, setClientId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    consumeOidcCallback()
      .then((result) => {
        if (active && result) return onConnect(result.workspaceAddress, "", result.token);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="connect">
      <div className="brand">
        <Bot /> anyBot
      </div>
      <div className="connect-hero">
        <span className="hero-icon">
          <Users size={34} />
        </span>
        <p className="eyebrow">YOUR TEAM, WITH YOU</p>
        <h1>
          Good work
          <br />
          travels with you.
        </h1>
        <p>
          Pick up the conversation with your AI employees, wherever you are.
        </p>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
          await onConnect(address, code, identityToken);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Connect your workspace</h2>
        <p>
          Use a two-minute desktop connection code, or paste a short-lived
          access token from your configured identity provider.
        </p>
        <label>
          Workspace address
          <input
            type="url"
            required
            placeholder="https://your-workspace.example"
            autoCapitalize="none"
            autoCorrect="off"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label>
          Connection code
          <input
            required={!identityToken.trim()}
            autoComplete="off"
            spellCheck="false"
            maxLength={12}
            placeholder="12-character code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label>
          Identity provider token <span className="optional">optional</span>
          <textarea
            autoComplete="off"
            spellCheck="false"
            rows={3}
            value={identityToken}
            onChange={(e) => setIdentityToken(e.target.value)}
            placeholder="Paste a short-lived JWT to use external sign-in"
          />
          <small>Kept in memory only. When present, it replaces the connection code.</small>
        </label>
        <fieldset className="oidc-box">
          <legend>Browser sign-in with OIDC <span className="optional">optional</span></legend>
          <label>
            OIDC issuer
            <input
              type="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://login.example.com/realms/team"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
            />
          </label>
          <label>
            OIDC client ID
            <input
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="anybot-mobile"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary wide"
            disabled={busy || !address.trim() || !issuer.trim() || !clientId.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onOidcSignIn(address, issuer, clientId);
              } catch (e) {
                setError(e.message);
                setBusy(false);
              }
            }}
          >
            Sign in with provider <ChevronRight size={18} />
          </button>
          <small>Uses authorization code + PKCE S256. The token returns to this device and is kept in memory only.</small>
        </fieldset>
        {(error || externalError) && (
          <p role="alert" className="error">
            {error || externalError}
          </p>
        )}
        <button className="primary wide" disabled={busy}>
          {busy ? "Connecting…" : "Connect to my team"}
          <ChevronRight size={18} />
        </button>
        <small>
          Agents stay on your desktop or server. Your phone is their companion.
        </small>
      </form>
    </div>
  );
}
function NewChat({ employees, humanMembers = [], currentHuman = "", initial, onClose, onCreate }) {
  const [members, setMembers] = useState(initial ? [initial] : []),
    [humanInvites, setHumanInvites] = useState([]),
    [title, setTitle] = useState(""),
    [handoffs, setHandoffs] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="sheet-backdrop">
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="New conversation"
      >
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
        <h1>Bring the team in.</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onCreate({ title, members, humanMembers: humanInvites, delegation: handoffs });
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Conversation name
            <input
              autoFocus
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are we working on?"
            />
          </label>
          <fieldset>
            <legend>Choose employees</legend>
            {employees.map((e) => (
              <label className="choice" key={e.id}>
                <input
                  type="checkbox"
                  checked={members.includes(e.id)}
                  onChange={() =>
                    setMembers((m) =>
                      m.includes(e.id)
                        ? m.filter((x) => x !== e.id)
                        : [...m, e.id],
                    )
                  }
                />
                <Avatar name={e.name} />
                <span>
                  {e.name}
                  <small>{e.role}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {humanMembers.length > 1 && (
            <fieldset>
              <legend>Share with humans</legend>
              <p className="muted">Invite configured teammates to this conversation.</p>
              {humanMembers.filter((member) => member.id !== currentHuman).map((member) => (
                <label className="choice" key={member.id}>
                  <input
                    type="checkbox"
                    checked={humanInvites.includes(member.id)}
                    onChange={() => setHumanInvites((ids) => ids.includes(member.id) ? ids.filter((id) => id !== member.id) : [...ids, member.id])}
                  />
                  <Avatar name={member.name} />
                  <span>{member.name}<small>{member.role}</small></span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="choice">
            <input
              type="checkbox"
              checked={handoffs}
              onChange={(e) => setHandoffs(e.target.checked)}
            />
            <span>Allow handoffs between these employees</span>
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy || !members.length}>
            Create conversation
          </button>
        </form>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
