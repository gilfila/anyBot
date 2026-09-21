import React, { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Clock,
  Cpu,
  Download,
  ExternalLink,
  Folder,
  FileText,
  Mic,
  MessageSquare,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Users,
  Workflow,
  Volume2,
  X,
} from "lucide-react";
import { presets, names } from "./constants.js";
import { empty, time } from "./lib/ui.js";
import { Avatar } from "./components/Avatar.jsx";
import { SlimeAvatar } from "./components/SlimeAvatar.jsx";
import { WorkingIndicator } from "./components/WorkingIndicator.jsx";
import { Status } from "./components/Status.jsx";
import { Empty } from "./components/Empty.jsx";
import { Modal } from "./components/Modal.jsx";
import { PageTitle } from "./components/PageTitle.jsx";
import { MobileAccess } from "./components/MobileAccess.jsx";
import { EmployeeForm } from "./components/EmployeeForm.jsx";
import { ConversationForm } from "./components/ConversationForm.jsx";
import { ConversationMembersForm } from "./components/ConversationMembersForm.jsx";
import { RoutineForm } from "./components/RoutineForm.jsx";

export function App() {
  const harnessName = (id) =>
    data.harnesses.find((h) => h.id === id)?.name || names[id] || id;
  const [data, setData] = useState(empty),
    [view, setView] = useState("team"),
    [conversationId, setConversationId] = useState(null);
  const [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState(""),
    [recipients, setRecipients] = useState([]);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [dictating, setDictating] = useState(false),
    [voiceAgent, setVoiceAgent] = useState(null);
  const recognition = useRef(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dismissedRuns, setDismissedRuns] = useState(new Set());
  const [lastSeenMessages, setLastSeenMessages] = useState({});
  const end = useRef(null);
  async function openArtifact(artifact) {
    setError("");
    try {
      const preview = await window.anybot.request("artifacts.preview", {
        id: artifact.id,
        conversation: artifact.conversation,
      });
      setModal({ type: "artifact", artifact, preview });
    } catch (error) {
      setError(error.message);
    }
  }
  async function revealArtifact(artifact) {
    try {
      await window.anybot.request("artifacts.reveal", {
        id: artifact.id,
        conversation: artifact.conversation,
      });
    } catch (error) {
      setError(error.message);
    }
  }
  async function refresh() {
    if (!window.anybot) return;
    try {
      setData(await window.anybot.request("snapshot"));
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }
  useEffect(() => {
    refresh();
    const off = window.anybot?.onChanged(refresh);
    const timer = setInterval(refresh, 4000);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, []);
  async function act(method, payload) {
    setError("");
    setBusy(true);
    try {
      const next = await window.anybot.request(method, payload);
      setData(next);
      return next;
    } catch (e) {
      setError(
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      );
      return null;
    } finally {
      setBusy(false);
    }
  }
  const conversation = data.conversations.find((c) => c.id === conversationId);
  const messages = data.messages.filter(
    (m) => m.conversation === conversationId,
  );
  const runs = data.runs.filter((r) => r.conversation === conversationId);
  const activeRuns = runs.filter((r) =>
    ["queued", "running", "cancelling"].includes(r.status),
  );
  const activeRecipients = recipients.filter((id) =>
    conversation?.members.includes(id) &&
      data.employees.some((e) => e.id === id && !e.archived),
  );
  function openConversation(c) {
    setConversationId(c.id);
    setRecipients(
      c.members
        .filter((id) => !data.employees.find((e) => e.id === id)?.archived)
        .slice(0, 1),
    );
    setView("chat");
    setDraft("");
    const convMessages = data.messages.filter((m) => m.conversation === c.id);
    const latestId = convMessages.length > 0 ? convMessages[convMessages.length - 1].id : null;
    if (latestId) {
      setLastSeenMessages((prev) => ({ ...prev, [c.id]: latestId }));
    }
  }
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversationId]);
  async function send(event) {
    event.preventDefault();
    if (busy || !draft.trim() || !activeRecipients.length) return;
    const result = await act("messages.send", {
      conversation: conversationId,
      body: draft,
      recipients: activeRecipients,
      requestId: crypto.randomUUID(),
    });
    if (result) setDraft("");
  }
  function startDictation(onText) {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      setError("Dictation is unavailable in this build. Install the Flow companion or enable microphone speech recognition.");
      return;
    }
    if (recognition.current) {
      recognition.current.stop();
      recognition.current = null;
      setDictating(false);
      return;
    }
    const next = new Speech();
    next.continuous = true;
    next.interimResults = false;
    next.lang = navigator.language || "en-US";
    next.onresult = (event) => {
      const text = [...event.results]
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript.trim())
        .filter(Boolean)
        .join(" ");
      if (text) onText(text);
    };
    next.onerror = (event) => {
      if (event.error !== "aborted") setError(`Dictation stopped: ${event.error}`);
    };
    next.onend = () => {
      recognition.current = null;
      setDictating(false);
    };
    recognition.current = next;
    setDictating(true);
    next.start();
  }
  async function startVoiceChat() {
    if (!conversation || conversation.members.length !== 1) return;
    const employee = data.employees.find((item) => item.id === conversation.members[0]);
    if (!employee) return;
    setVoiceAgent(employee);
    startDictation(async (text) => {
      const before = new Set(data.messages.filter((message) => message.conversation === conversationId).map((message) => message.id));
      await act("messages.send", {
        conversation: conversationId,
        body: text,
        recipients: [employee.id],
        requestId: crypto.randomUUID(),
      });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const snapshot = await window.anybot.request("snapshot");
        setData(snapshot);
        const reply = snapshot.messages.find((message) => message.conversation === conversationId && message.author === employee.id && !before.has(message.id));
        if (reply) {
          window.speechSynthesis?.speak(new SpeechSynthesisUtterance(reply.body));
          break;
        }
      }
    });
  }
  async function directChat(employee) {
    const existing = data.conversations.find(
      (c) => c.members.length === 1 && c.members[0] === employee.id,
    );
    if (existing) {
      openConversation(existing);
      return;
    }
    const next = await act("conversations.create", {
      title: employee.name,
      members: [employee.id],
    });
    if (next) {
      const created = next.conversations.at(-1);
      openConversation(created);
    }
  }
  const sidebarTerm = sidebarSearch.trim().toLowerCase();
  const sidebarEmployees = data.employees
    .filter((employee) => !employee.archived)
    .filter((employee) => !sidebarTerm || `${employee.name} ${employee.role}`.toLowerCase().includes(sidebarTerm));
  const groupConversations = data.conversations.filter(
    (item) => item.members.length > 1 && (!sidebarTerm || item.title.toLowerCase().includes(sidebarTerm)),
  );
  function getConversationForEmployee(employeeId) {
    return data.conversations.find(
      (c) => c.members.length === 1 && c.members[0] === employeeId,
    );
  }
  function hasUnreadMessages(convId) {
    if (!convId) return false;
    const convMessages = data.messages.filter((m) => m.conversation === convId && m.author !== "human");
    if (convMessages.length === 0) return false;
    const lastSeenId = lastSeenMessages[convId];
    if (!lastSeenId) return convMessages.length > 0;
    const lastSeenIndex = convMessages.findIndex((m) => m.id === lastSeenId);
    return lastSeenIndex < convMessages.length - 1;
  }
  function dismissRun(runId) {
    setDismissedRuns((prev) => new Set([...prev, runId]));
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Bot size={22} />
          </span>
          anyBot<span className="alpha">LOCAL</span>
        </div>
        <label className="sidebar-search">
          <Search size={15} />
          <input
            aria-label="Search bots and group conversations"
            placeholder="Search"
            value={sidebarSearch}
            onChange={(event) => setSidebarSearch(event.target.value)}
          />
        </label>
        <div className="workspace">
          <span className="workspace-icon">W</span>
          <div>
            My workspace<small>Personal workspace</small>
          </div>
          <ShieldCheck size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <button
            className={view === "work" ? "selected" : ""}
            onClick={() => setView("work")}
          >
            <Workflow size={18} />
            Activity
            {data.runtime.active > 0 && (
              <span className="nav-count">{data.runtime.active}</span>
            )}
          </button>
          <button
            className={view === "routines" ? "selected" : ""}
            onClick={() => setView("routines")}
          >
            <Clock size={18} />
            Routines
          </button>
        </nav>
        <div className="nav-label conversation-label">
          BOTS
          <span>{sidebarEmployees.length}</span>
        </div>
        <div className="conversation-list bot-list">
          {sidebarEmployees.map((employee) => {
            const botConv = getConversationForEmployee(employee.id);
            const unread = botConv && hasUnreadMessages(botConv.id);
            return (
              <button
                key={employee.id}
                className={
                  view === "chat" && conversation?.members.length === 1 && conversation.members[0] === employee.id
                    ? "selected"
                    : ""
                }
                onClick={() => directChat(employee)}
              >
                <SlimeAvatar small employee={employee} />
                <span>{employee.name}</span>
                {unread && <i className="unread-dot" />}
              </button>
            );
          })}
          {!sidebarEmployees.length && <p className="side-empty">No bots match your search.</p>}
        </div>
        <div className="nav-label conversation-label">
          GROUP CHATS
          <button
            title="New group conversation"
            aria-label="New group conversation"
            onClick={() => setModal({ type: "conversation" })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="conversation-list">
          {groupConversations.length === 0 ? (
            <p className="side-empty">Your group conversations will live here.</p>
          ) : (
            groupConversations.map((c) => {
              const unread = hasUnreadMessages(c.id);
              return (
                <button
                  key={c.id}
                  className={
                    view === "chat" && c.id === conversationId ? "selected" : ""
                  }
                  onClick={() => openConversation(c)}
                >
                  <MessageSquare size={16} />
                  <span>{c.title}</span>
                  {unread && <i className="unread-dot" />}
                </button>
              );
            })
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="runtime-indicator">
            <i className={connected && !data.runtime.paused ? "online" : ""} />
            <span>
              {!connected
                ? "Connecting to runtime"
                : data.runtime.paused
                  ? "New work paused"
                  : "Local runtime online"}
            </span>
          </div>
          <p>Closing the window shuts down the local runtime cleanly.</p>
          <button className="plain" onClick={() => setView("settings")}>
            <Monitor size={16} />
            Runtime & privacy
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="user">
          <span className="user-avatar">Y</span>
          <div>
            You<small>Workspace owner</small>
          </div>
          <button
            className={`settings-cog${data.update ? " has-update" : ""}`}
            title={data.update ? `Update available: v${data.update.version}` : "Settings"}
            aria-label={data.update ? `Settings — update available (v${data.update.version})` : "Settings"}
            onClick={() => setView("settings")}
          >
            <Settings2 size={17} />
            {data.update && <i className="update-dot" />}
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {
                {
                  team: "Your team",
                  work: "Activity",
                  routines: "Routines",
                  harnesses: "Harnesses",
                  settings: "Settings",
                  chat: conversation?.title || "Conversation",
                }[view]
              }
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-label">
              <Monitor size={14} />
              On this computer
            </span>
            <span className="version">
              {data.runtime.version ? `v${data.runtime.version}` : "Preview"}
            </span>
          </div>
        </header>
        {!window.anybot && (
          <div className="banner">
            This preview has no desktop connection. Run <code>npm start</code>{" "}
            to use your employees.
          </div>
        )}
        {error && (
          <div role="alert" className="banner error">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {view === "team" && (
          <div className="page team-page">
            <div className="page-heading">
              <div className="eyebrow">
                A LITTLE TEAM. A LOT OF POSSIBILITY.
              </div>
              <div className="heading-row">
                <div>
                  <h1>Your next great team starts here.</h1>
                  <p>
                    Give each bot a role. Bring your own harness. Get to work
                    together.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => setModal({ type: "employee" })}
                >
                  <Plus size={16} />
                  Create employee
                </button>
              </div>
            </div>
            <section className="intro-panel">
              <div>
                <span className="pill">
                  <span className="dot" /> BUILT AROUND YOUR WORK
                </span>
                <h2>
                  Different strengths.
                  <br />
                  One shared conversation.
                </h2>
                <p>
                  Bring Claude, Codex, Gemini, and Hermes into the same
                  workspace. Your employees keep their conversations and can
                  hand work to each other.
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    data.employees.length
                      ? setModal({ type: "conversation" })
                      : setModal({ type: "employee" })
                  }
                >
                  {data.employees.length
                    ? "Start a team conversation"
                    : "Meet your first employee"}
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="team-illustration" aria-hidden="true">
                <div className="orbit-node peach">
                  A<span>Claude</span>
                </div>
                <div className="orbit-node blue">
                  M<span>Codex</span>
                </div>
                <div className="orbit-node purple">
                  S<span>Gemini</span>
                </div>
                <div className="orbit-node green">
                  R<span>Hermes</span>
                </div>
                <div className="orbit-core">
                  <Bot size={32} />
                  <span>anyBot</span>
                </div>
              </div>
            </section>
            <div className="section-heading">
              <h2>
                {data.employees.length ? "Your employees" : "Start with a role"}
              </h2>
              {data.employees.length ? (
                <button
                  className="text-button"
                  onClick={() => setShowArchived(!showArchived)}
                >
                  {showArchived
                    ? "Show active employees"
                    : "Show archived employees"}
                </button>
              ) : (
                <span>Make it yours. You can customize every employee.</span>
              )}
            </div>
            <div className="employee-grid">
              {data.employees
                .filter((e) => Boolean(e.archived) === showArchived)
                .map((e) => (
                  <article className="employee-card" key={e.id}>
                    <div className="card-top">
                      <SlimeAvatar employee={e} working={data.runs.some(
                        (r) => r.employee === e.id && r.status === "running"
                      )} />
                      <Status
                        status={
                          e.archived
                            ? "archived"
                            : data.runs.some(
                                  (r) =>
                                    r.employee === e.id &&
                                    r.status === "running",
                                )
                              ? "working"
                              : "available"
                        }
                      />
                    </div>
                    <h3>{e.name}</h3>
                    <div className="role">{e.role}</div>
                    <p>{e.instructions}</p>
                    <div className="card-footer">
                      <span className="harness-tag">
                        <Cpu size={13} />
                        {harnessName(e.harness)}
                      </span>
                      {e.archived ? (
                        <button
                          aria-label={`Restore ${e.name}`}
                          title="Restore employee"
                          onClick={() =>
                            act("employees.setArchived", {
                              id: e.id,
                              revision: e.revision,
                              archived: false,
                            })
                          }
                        >
                          <RefreshCw size={17} />
                        </button>
                      ) : (
                        <>
                          <button
                            title={`Edit ${e.name}`}
                            aria-label={`Edit ${e.name}`}
                            onClick={() =>
                              setModal({
                                type: "employee",
                                preset: e,
                                editing: true,
                              })
                            }
                          >
                            <Settings2 size={16} />
                          </button>
                          <button
                            title={`Archive ${e.name}`}
                            aria-label={`Archive ${e.name}`}
                            onClick={() =>
                              act("employees.setArchived", {
                                id: e.id,
                                revision: e.revision,
                                archived: true,
                              })
                            }
                          >
                            <Archive size={16} />
                          </button>
                          <button
                            title={`Message ${e.name}`}
                            aria-label={`Message ${e.name}`}
                            onClick={() => directChat(e)}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              {(data.employees.length ? [] : presets).map((p) => (
                <article className="employee-card template" key={p.harness}>
                  <div className="card-top">
                    <SlimeAvatar employee={p} />
                    <span className="template-label">ROLE TEMPLATE</span>
                  </div>
                  <h3>{p.role}</h3>
                  <div className="role">{harnessName(p.harness)}</div>
                  <p>{p.summary}</p>
                  <button
                    className="template-button"
                    onClick={() => setModal({ type: "employee", preset: p })}
                  >
                    <Plus size={15} />
                    Create {p.role.toLowerCase()}
                  </button>
                </article>
              ))}
            </div>
            <div className="section-heading lower">
              <h2>A workspace that stays with you</h2>
            </div>
            <div className="principles">
              <div>
                <MessageSquare size={21} />
                <h3>Conversations, not terminals</h3>
                <p>Talk to one employee or bring a whole team into the room.</p>
              </div>
              <div>
                <Workflow size={21} />
                <h3>Let the team collaborate</h3>
                <p>Enable bounded handoffs and see who is doing what.</p>
              </div>
              <div>
                <ShieldCheck size={21} />
                <h3>Your computer. Your control.</h3>
                <p>
                  Local history, visible work, and a stop button when you need
                  it.
                </p>
              </div>
            </div>
          </div>
        )}
        {view === "chat" && conversation && (
          <div className="chat-layout">
            <section className="chat-main">
              <div className="chat-heading">
                <div>
                  <h2>{conversation.title}</h2>
                  <p>
                    {conversation.members.length} employee
                    {conversation.members.length === 1 ? "" : "s"} ·{" "}
                    {conversation.delegation
                      ? "Team handoffs enabled"
                      : "Direct responses"}
                  </p>
                </div>
                <div className="avatar-stack">
                  {conversation.members.map((id) => {
                    const emp = data.employees.find((e) => e.id === id);
                    const isWorking = activeRuns.some((r) => r.employee === id);
                    return (
                      <SlimeAvatar
                        small
                        key={id}
                        employee={emp}
                        working={isWorking}
                      />
                    );
                  })}
                  <button
                    type="button"
                    className="secondary"
                    title="Manage bots in this conversation"
                    aria-label="Manage bots in this conversation"
                    onClick={() => setModal({ type: "conversation-members" })}
                  >
                    <Users size={16} />
                    Manage bots
                  </button>
                </div>
                {conversation.members.length === 1 && (
                  <button
                    type="button"
                    className={voiceAgent ? "secondary voice-active" : "secondary"}
                    onClick={() => {
                      if (voiceAgent) {
                        recognition.current?.stop();
                        window.speechSynthesis?.cancel();
                        setVoiceAgent(null);
                      } else startVoiceChat();
                    }}
                  >
                    <Volume2 size={15} />
                    {voiceAgent ? "Stop voice chat" : "Voice chat"}
                  </button>
                )}
              </div>
              <div className="messages">
                {!messages.length && (
                  <div className="chat-empty">
                    <span className="empty-icon">
                      <MessageSquare size={28} />
                    </span>
                    <h2>What are we working on?</h2>
                    <p>
                      Give your team a clear objective. They’ll bring their
                      progress and results back here.
                    </p>
                  </div>
                )}
                {messages.map((m) => (
                  <div className={`message ${m.kind}`} key={m.id}>
                    {m.author === "human" ? (
                      <Avatar small employee={{ name: "Y" }} />
                    ) : (
                      <SlimeAvatar
                        small
                        employee={data.employees.find((e) => e.id === m.author)}
                      />
                    )}
                    <div className="message-content">
                      <div className="message-meta">
                        <strong>
                          {m.author === "human"
                            ? "You"
                            : data.employees.find((e) => e.id === m.author)
                                ?.name || "Coordinator"}
                        </strong>
                        <span>{time(m.created)}</span>
                        {m.kind === "handoff" && (
                          <span className="handoff-label">
                            <Workflow size={12} />
                            Handoff
                          </span>
                        )}
                      </div>
                      <div className="message-body">{m.body}</div>
                    </div>
                  </div>
                ))}
                {activeRuns.map((r) => (
                  <div className="message" key={r.id}>
                    <SlimeAvatar
                      small
                      employee={data.employees.find((e) => e.id === r.employee)}
                      working
                    />
                    <div className="message-content">
                      <div className="message-meta">
                        <strong>
                          {
                            data.employees.find((e) => e.id === r.employee)
                              ?.name
                          }
                        </strong>
                        <Status status={r.status} />
                        <button
                          className="mini"
                          onClick={() => act("runs.cancel", { id: r.id })}
                        >
                          <Square size={12} />
                          Stop
                        </button>
                      </div>
                      <div className="message-body">
                        {r.output || "Waiting for the harness…"}
                      </div>
                    </div>
                  </div>
                ))}
                {runs
                  .filter((r) =>
                    ["failed", "interrupted", "cancelled"].includes(r.status) &&
                    !dismissedRuns.has(r.id),
                  )
                  .map((r) => (
                    <div className="run-notice" key={r.id}>
                      <div className="run-notice-content">
                        <Status status={r.status} />
                        <span>
                          {data.employees.find((e) => e.id === r.employee)?.name}:{" "}
                          {r.error || "Stopped by you."}
                        </span>
                      </div>
                      <button
                        className="run-notice-dismiss"
                        aria-label="Dismiss notice"
                        onClick={() => dismissRun(r.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                <div ref={end} />
              </div>
              <WorkingIndicator
                runs={activeRuns}
                employees={data.employees}
                onStopAll={activeRuns.length > 0 ? () => act("runtime.stopAll") : null}
              />
              <form className="composer" onSubmit={send}>
                <div className="recipient-row">
                  <span>To</span>
                  {conversation.members.map((id) => {
                    const e = data.employees.find((e) => e.id === id);
                    return (
                      <button
                        type="button"
                        className={
                          recipients.includes(id)
                            ? "recipient chosen"
                            : "recipient"
                        }
                        key={id}
                        disabled={Boolean(e?.archived)}
                        onClick={() =>
                          setRecipients(
                            recipients.includes(id)
                              ? recipients.filter((r) => r !== id)
                              : [...recipients, id],
                          )
                        }
                      >
                        {recipients.includes(id) && <Check size={12} />}{" "}
                        {e?.name}
                        {e?.archived ? " (archived)" : ""}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  aria-label="Message your team"
                  placeholder="Give your team something to work on…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(e);
                    }
                  }}
                />
                <div className="composer-bottom">
                  <span>Enter to send · Shift + Enter for a new line</span>
                  <div className="composer-actions">
                    <button
                      type="button"
                      className={dictating ? "dictation active" : "dictation"}
                      aria-label={dictating ? "Stop dictation" : "Dictate message"}
                      title="Dictate with Flow-compatible speech input"
                      onClick={() => startDictation((text) => setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${text}`))}
                    >
                      <Mic size={17} />
                    </button>
                    <button
                      className="send"
                      aria-label="Send message"
                      disabled={busy || !connected || !draft.trim() || !activeRecipients.length}
                    >
                      <ArrowUp size={19} />
                    </button>
                  </div>
                </div>
              </form>
              <div className="composer-note">
                Local harnesses use your configured accounts and permissions.
              </div>
            </section>
            <aside className="context-panel">
              <div className="eyebrow">IN THIS CONVERSATION</div>
              {conversation.members.map((id) => {
                const e = data.employees.find((e) => e.id === id);
                const isWorking = activeRuns.some((r) => r.employee === id);
                return (
                  <div className="participant" key={id}>
                    <SlimeAvatar small employee={e} working={isWorking} />
                    <div>
                      <strong>{e?.name}</strong>
                      <small>{e?.role}</small>
                      <span>{harnessName(e?.harness)}</span>
                    </div>
                  </div>
                );
              })}
              <div className="context-divider" />
              <div className="eyebrow">DELIVERABLES</div>
              {(data.artifacts || []).filter(
                (a) => a.conversation === conversationId,
              ).length === 0 && (
                <p>Files returned by your employees will appear here.</p>
              )}
              {(data.artifacts || [])
                .filter((a) => a.conversation === conversationId)
                .map((a) => (
                  <button
                    className="artifact-item"
                    key={a.id}
                    onClick={() => openArtifact(a)}
                  >
                    <FileText size={18} />
                    <span>
                      {a.name}
                      <small>
                        {Math.max(1, Math.ceil(a.bytes / 1024))} KB ·{" "}
                        {time(a.created)}
                      </small>
                    </span>
                  </button>
                ))}
              <div className="context-divider" />
              <div className="eyebrow">HOW WORK HAPPENS</div>
              <p>
                Each employee runs in their own workspace. Handoffs stay within
                this conversation.
              </p>
              <div className="detail-line">
                <Workflow size={15} />
                Up to 8 runs per task
              </div>
              <div className="detail-line">
                <Monitor size={15} />
                Runs on this computer
              </div>
              <div className="detail-line">
                <ShieldCheck size={15} />
                Trusted local execution
              </div>
            </aside>
          </div>
        )}
        {view === "work" && (
          <div className="page">
            <PageTitle
              eyebrow="FOLLOW THE WORK"
              title="Activity"
              description="Every assignment, handoff, and result — in one place."
            />
            <div className="activity-summary">
              <div>
                <strong>
                  {data.runs.filter((r) => r.status === "running").length}
                </strong>
                <span>Working now</span>
              </div>
              <div>
                <strong>
                  {data.runs.filter((r) => r.status === "queued").length}
                </strong>
                <span>In the queue</span>
              </div>
              <div>
                <strong>
                  {data.runs.filter((r) => r.status === "succeeded").length}
                </strong>
                <span>Completed</span>
              </div>
            </div>
            {!data.runs.length ? (
              <Empty
                title="A clear view of progress"
                text="Send your first assignment and follow it here, from the queue to the final result."
              />
            ) : (
              <div className="run-list">
                {[...data.runs].reverse().map((r) => (
                  <article className="run-row" key={r.id}>
                    <SlimeAvatar
                      small
                      employee={data.employees.find((e) => e.id === r.employee)}
                      working={r.status === "running"}
                    />
                    <div className="run-description">
                      <strong>
                        {data.employees.find((e) => e.id === r.employee)?.name}
                      </strong>
                      <p>
                        {data.messages.find((m) => m.id === r.message)?.body}
                      </p>
                      {r.error && (
                        <small className="error-text">{r.error}</small>
                      )}
                    </div>
                    <Status status={r.status} />
                    {["running", "queued"].includes(r.status) && (
                      <button
                        className="secondary"
                        onClick={() => act("runs.cancel", { id: r.id })}
                      >
                        Stop
                      </button>
                    )}
                    <button
                      aria-label="Open conversation"
                      onClick={() =>
                        openConversation(
                          data.conversations.find(
                            (c) => c.id === r.conversation,
                          ),
                        )
                      }
                    >
                      <ArrowUpRight size={19} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
        {view === "harnesses" && (
          <div className="page">
            <PageTitle
              eyebrow="BRING YOUR OWN INTELLIGENCE"
              title="Your harnesses"
              description="Connect the tools you already use. Each employee can have a different engine."
            />
            <button
              className="secondary refresh"
              disabled={busy}
              onClick={() => act("harnesses.probe")}
            >
              <RefreshCw size={15} />
              Check installations
            </button>
            <div className="harness-list">
              {data.harnesses.map((h) => (
                <article key={h.id}>
                  <div className="harness-icon">
                    <Cpu size={24} />
                  </div>
                  <div>
                    <h3>{h.name}</h3>
                    <p>{h.detail}</p>
                    {h.login && (
                      <>
                        <code>{h.login}</code>
                        <small>
                          Run this in your terminal to authenticate.
                        </small>
                      </>
                    )}
                    {h.executable && (
                      <small className="path">{h.executable}</small>
                    )}
                  </div>
                  <Status status={h.status} />
                </article>
              ))}
            </div>
            <div className="info-box">
              <CircleHelp size={19} />
              <div>
                <strong>Detection is just the first step.</strong>
                {data.runtime.customHarnessError && (
                  <p role="alert">{data.runtime.customHarnessError}</p>
                )}
                <p>
                  Custom CLIs can be registered in harnesses.json in your app
                  data directory. Restart anyBot after changing this
                  owner-controlled file. Custom launchers run with your local
                  account permissions.
                </p>
                <p>
                  A detected executable still needs a supported version and a
                  working login. Your first task will surface any configuration
                  or permission errors.
                </p>
              </div>
            </div>
          </div>
        )}
        {view === "settings" && (
          <div className="page">
            <PageTitle
              eyebrow="CONFIGURE YOUR WORKSPACE"
              title="Settings"
              description="Manage your team, harnesses, and runtime preferences."
            />
            {data.update && (
              <div className="update-banner">
                <div className="update-banner-icon">
                  <Download size={20} />
                </div>
                <div className="update-banner-content">
                  <strong>Update available: v{data.update.version}</strong>
                  <p>{data.update.name}</p>
                  {data.update.body && (
                    <p className="update-body">
                      {data.update.body.length > 200
                        ? `${data.update.body.slice(0, 200)}…`
                        : data.update.body}
                    </p>
                  )}
                </div>
                <div className="update-banner-actions">
                  <button
                    className="primary"
                    onClick={() => act("update.open")}
                  >
                    <ExternalLink size={14} />
                    View release
                  </button>
                  <button
                    className="secondary"
                    onClick={() => act("update.dismiss", { version: data.update.version })}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <div className="settings-nav">
              <button
                className="settings-nav-item"
                onClick={() => setView("team")}
              >
                <Users size={18} />
                <div>
                  <strong>Your team</strong>
                  <small>Manage your AI employees</small>
                </div>
                <span className="settings-nav-count">{data.employees.length}</span>
                <ChevronRight size={16} />
              </button>
              <button
                className="settings-nav-item"
                onClick={() => setView("harnesses")}
              >
                <Cpu size={18} />
                <div>
                  <strong>Harnesses</strong>
                  <small>Connect AI tools and engines</small>
                </div>
                <span className="settings-nav-count">{data.harnesses.length}</span>
                <ChevronRight size={16} />
              </button>
            </div>
            <h2 className="settings-section-title">Runtime & Privacy</h2>
            <div className="settings-card">
              <div>
                <h3>Background work</h3>
                <p>
                  Keep the coordinator and active employees available in the
                  tray when the window closes. Use Quit when you want to stop
                  the runtime completely. Your computer must stay awake for
                  employees to keep working.
                </p>
              </div>
              <div className="settings-actions">
                <button
                  className="secondary"
                  onClick={() =>
                    act(data.runtime.paused ? "runtime.resume" : "runtime.pause")
                  }
                >
                  {data.runtime.paused ? <Play size={15} /> : <Pause size={15} />}
                  {data.runtime.paused ? "Resume new work" : "Pause new work"}
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    act("runtime.tray", { enabled: !data.runtime.keepRunningInTray })
                  }
                >
                  {data.runtime.keepRunningInTray ? "Tray mode enabled" : "Enable tray mode"}
                </button>
              </div>
            </div>
            <div className="settings-card">
              <div>
                <h3>Launch at login</h3>
                <p>
                  Start anyBot with Windows so scheduled work and long-running
                  employees remain available after you sign in. The setting is
                  opt-in and can be changed at any time.
                </p>
              </div>
              <button
                className="secondary"
                onClick={() =>
                  act("runtime.startup", {
                    enabled: !data.runtime.launchAtLogin,
                  })
                }
              >
                {data.runtime.launchAtLogin ? "Enabled" : "Enable"}
              </button>
            </div>
            <div className="settings-card">
              <div>
                <h3>Stop the team</h3>
                <p>Cancel running and queued assignments and pause new work.</p>
              </div>
              <button className="danger" onClick={() => act("runtime.stopAll")}>
                <Square size={15} />
                Stop all work
              </button>
            </div>
            <div className="settings-card">
              <div>
                <h3>Quit anyBot</h3>
                <p>Stop the local runtime and exit the desktop app.</p>
              </div>
              <button className="danger" onClick={() => act("app.quit")}>
                <Square size={15} />
                Quit and stop active work
              </button>
            </div>
            <div className="settings-card">
              <div>
                <h3>Trusted local execution</h3>
                <p>
                  Employees run your installed harnesses with your OS account.
                  Separate workspaces are not security sandboxes. Configured
                  tools may access files, networks, and connected accounts
                  according to the harness settings.
                </p>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="settings-card">
              <div>
                <h3>Saved on this computer</h3>
                <p>
                  Conversations and work history are stored in a local SQLite
                  database. Mobile access is disabled unless explicitly
                  configured. The desktop owner remains local; the companion
                  gateway can be configured with named members and
                  conversation invitations when shared access is enabled.
                </p>
                <code className="path">{data.runtime.directory}</code>
                {data.runtime.userDataFallback && (
                  <p role="alert" className="banner error">
                    The normal profile directory is not writable. anyBot is using an emergency temporary profile; repair the Windows profile permissions before relying on saved work.
                  </p>
                )}
              </div>
              <Folder size={22} />
            </div>
            <MobileAccess />
          </div>
        )}
        {view === "routines" && (
          <div className="page">
            <PageTitle
              eyebrow="KEEP THE WORK MOVING"
              title="Routines"
              description="Give recurring work a home. Results come back to the conversation you choose."
            />
            <button
              className="primary refresh"
              onClick={() => setModal({ type: "routine" })}
              disabled={!data.conversations.length}
            >
              <Plus size={16} />
              Create routine
            </button>
            {!data.routines?.length ? (
              <Empty
                title="Make the repeatable work automatic"
                text="Create a conversation first, then give an employee an assignment to repeat at a regular interval."
              />
            ) : (
              <div className="run-list">
                {data.routines.map((r) => (
                  <article className="run-row" key={r.id}>
                    <Clock size={23} />
                    <div className="run-description">
                      <strong>{r.name}</strong>
                      <p>{r.prompt}</p>
                      <small>
                        Every {r.minutes} minutes ·{" "}
                        {r.enabled
                          ? `Next: ${new Date(r.nextRun).toLocaleString()}`
                          : "Paused"}
                      </small>
                      {r.lastOccurrence && (
                        <small>Last occurrence: {r.lastOccurrence}</small>
                      )}
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => act("routines.runNow", { id: r.id })}
                    >
                      <Play size={14} />
                      Run now
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        act("routines.setEnabled", {
                          id: r.id,
                          enabled: !r.enabled,
                        })
                      }
                    >
                      {r.enabled ? <Pause size={14} /> : <Play size={14} />}{" "}
                      {r.enabled ? "Pause" : "Resume"}
                    </button>
                  </article>
                ))}
              </div>
            )}
            <div className="info-box">
              <Monitor size={20} />
              <div>
                <strong>
                  Your computer must be awake and anyBot must be running.
                </strong>
                <p>
                  Missed occurrences are skipped. A routine will not overlap its
                  previous work. Pausing the runtime also pauses scheduled
                  dispatch.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
      {modal && (
        <Modal
          title={
            modal.type === "employee"
              ? modal.editing
                ? "Edit employee"
                : "Create an employee"
              : modal.type === "artifact"
                ? modal.artifact.name
                : modal.type === "routine"
                  ? "Create a routine"
                  : modal.type === "conversation-members"
                    ? "Manage conversation bots"
                  : "Start a conversation"
          }
          onClose={() => setModal(null)}
        >
          {error && (
            <p role="alert" className="banner error">
              {error}
            </p>
          )}
          {modal.type === "employee" ? (
            <EmployeeForm
              harnesses={data.harnesses}
              preset={modal.preset}
              editing={modal.editing}
              busy={busy}
              onSave={async (p) => {
                if (
                  await act(
                    modal.editing ? "employees.update" : "employees.create",
                    p,
                  )
                )
                  setModal(null);
              }}
            />
          ) : modal.type === "artifact" ? (
            <div className="artifact-preview">
              {modal.preview.kind === "text" ? (
                <>
                  <pre>{modal.preview.text}</pre>
                  {modal.preview.truncated && (
                    <p>Preview limited to the first 512 KB.</p>
                  )}
                </>
              ) : modal.preview.kind === "image" ? (
                <img src={modal.preview.url} alt={modal.artifact.name} />
              ) : (
                <p>
                  This file is available in local storage. Open its folder to
                  use it in your preferred application.
                </p>
              )}
              <p>
                Created by{" "}
                {data.employees.find(
                  (e) =>
                    e.id ===
                    data.runs.find((r) => r.id === modal.artifact.run)
                      ?.employee,
                )?.name || "an employee"}{" "}
                · {new Date(modal.artifact.created).toLocaleString()}
              </p>
              <button
                className="secondary"
                onClick={() => revealArtifact(modal.artifact)}
              >
                <Folder size={16} />
                Show in folder
              </button>
            </div>
          ) : modal.type === "routine" ? (
            <RoutineForm
              data={data}
              busy={busy}
              onSave={async (p) => {
                if (await act("routines.create", p)) setModal(null);
              }}
            />
          ) : modal.type === "conversation-members" ? (
            <ConversationMembersForm
              employees={data.employees.filter((e) => !e.archived || conversation?.members.includes(e.id))}
              selected={conversation?.members || []}
              busy={busy}
              onSave={async (members) => {
                const next = await act("conversations.updateMembers", {
                  conversation: conversationId,
                  members,
                });
                if (next) setModal(null);
              }}
            />
          ) : (
            <ConversationForm
              employees={data.employees.filter((e) => !e.archived)}
              busy={busy}
              onSave={async (p) => {
                const next = await act("conversations.create", p);
                if (next) {
                  openConversation(next.conversations.at(-1));
                  setModal(null);
                }
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
