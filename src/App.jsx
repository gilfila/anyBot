import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  Archive,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Columns3,
  Clock,
  Cpu,
  Download,
  ExternalLink,
  Folder,
  FileText,
  Loader,
  Mic,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  Workflow,
  Volume2,
  X,
} from "lucide-react";
import { presets, names } from "./constants.js";
import { empty, time, shouldShowUpdateChrome } from "./lib/ui.js";

function UpdateButton({ update, onAction, onDismiss }) {
  const [busy, setBusy] = useState(false);

  const handleAction = async (action) => {
    setBusy(true);
    try {
      await onAction(action);
    } finally {
      setBusy(false);
    }
  };

  // Update states: idle, checking, available, downloading, downloaded, error
  // Only render for actionable states; return null for idle/unknown.
  const state = update?.state;
  if (!state || state === "idle") return null;
  const version = update?.version;
  const progress = update?.progress;
  const error = update?.error;

  if (state === "checking") {
    return (
      <button className="update-btn checking" disabled title="Checking for updates...">
        <Loader size={14} className="spinning" />
      </button>
    );
  }

  if (state === "downloading") {
    const percent = progress?.percent || 0;
    return (
      <button className="update-btn downloading" disabled title={`Downloading update: ${percent}%`}>
        <div className="update-progress-ring">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <circle cx="10" cy="10" r="8" fill="none" style={{ stroke: "var(--rule-strong)" }} strokeWidth="2" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              style={{ stroke: "var(--accent)" }}
              strokeWidth="2"
              strokeDasharray={`${percent * 0.5} 50`}
              strokeLinecap="round"
              transform="rotate(-90 10 10)"
            />
          </svg>
          <span className="update-progress-text">{percent}%</span>
        </div>
      </button>
    );
  }

  if (state === "downloaded") {
    return (
      <button
        className="update-btn ready"
        onClick={() => handleAction("install")}
        disabled={busy}
        title={`Install update v${version} and restart`}
      >
        <RefreshCw size={14} />
        <span>Restart</span>
      </button>
    );
  }

  if (state === "error") {
    return (
      <button
        className="update-btn error"
        onClick={() => handleAction("retry")}
        disabled={busy}
        title={error?.message || "Update failed. Click to retry."}
      >
        <AlertCircle size={14} />
        <span>Retry</span>
      </button>
    );
  }

  // State: available (or any unhandled actionable state)
  return (
    <button
      className="update-btn available"
      onClick={() => handleAction("download")}
      disabled={busy}
      title={`Update to v${version}`}
    >
      <Download size={14} />
      <span>Update</span>
    </button>
  );
}
import { Avatar } from "./components/Avatar.jsx";
import { BrandMark } from "./components/BrandMark.jsx";
import { RobotAvatar, AvatarActivityContext } from "./components/RobotAvatar.jsx";
import { employeeAvatarStates, parseAvatarConfig } from "./lib/avatar-config.js";
import { bubbleStyle } from "./lib/bubbles.js";
import { WorkingIndicator } from "./components/WorkingIndicator.jsx";
import { ChatMessage, LiveRun } from "./components/chat/ChatMessage.jsx";
import { Composer } from "./components/chat/Composer.jsx";
import { ThreadPanel, ThreadSummary } from "./components/chat/ThreadPanel.jsx";
import { threadIndex } from "./components/chat/threads.js";
import "./components/chat/chat.css";
import { ApprovalBar } from "./components/ApprovalBar.jsx";
import { Status } from "./components/Status.jsx";
import { Empty } from "./components/Empty.jsx";
import { Modal } from "./components/Modal.jsx";
import { PageTitle } from "./components/PageTitle.jsx";
import { MobileAccess } from "./components/MobileAccess.jsx";
import { EmployeeForm } from "./components/EmployeeForm.jsx";
import { ConversationForm } from "./components/ConversationForm.jsx";
import { ConversationMembersForm } from "./components/ConversationMembersForm.jsx";
import { RoutineForm } from "./components/RoutineForm.jsx";
import { MessageContent } from "./components/MessageContent.jsx";
import { ContextRail } from "./components/ContextRail.jsx";
import { HtmlPreviewModal } from "./components/HtmlPreviewModal.jsx";
import { ProjectSettingsForm } from "./components/ProjectSettingsForm.jsx";
import { ProjectBoard } from "./components/board/ProjectBoard.jsx";
import { TaskPeek } from "./components/board/TaskPeek.jsx";
import { ProjectDoc } from "./components/doc/ProjectDoc.jsx";
// The Organization page (org chart, knowledge graph, d3) loads on first visit.
const OrgPage = React.lazy(() => import("./components/org/OrgPage.jsx").then((m) => ({ default: m.OrgPage })));
import { DiagnosticsPanel } from "./components/DiagnosticsPanel.jsx";
import { FloatingMenu } from "./components/FloatingMenu.jsx";
import { AppearancePanel } from "./components/theme/AppearancePanel.jsx";
import { PhoneLinkPanel } from "./components/PhoneLinkPanel.jsx";
import { AttentionIcon } from "./components/AttentionIcon.jsx";
import { botAttention } from "./lib/attention.js";
import { plainNotes } from "./lib/update-notes.js";
import { statusLabel } from "./components/board/meta.js";

// A task being started posts its brief into the project chat. Render it as a
// compact card that links back to the board rather than a wall of text.
function TaskStartMessage({ message, tasks, employees, onOpen }) {
  const ref = message.body.match(/^Task ([0-9a-f]{8})/)?.[1];
  const task = ref && tasks.find((item) => item.id.startsWith(ref));
  const title = message.body.split("\n")[0].replace(/^Task [0-9a-f]{8}: /, "");
  const people = (task?.assignees || []).map((id) => employees.find((e) => e.id === id)).filter(Boolean);
  return (
    <div className="message task-start">
      <div className="task-start-card">
        <Columns3 size={15} />
        <div>
          <span className="task-start-kicker">
            {message.author === "system" ? "Autopilot started" : "You started"} · {time(message.created)}
          </span>
          <strong>{title}</strong>
          {people.length > 0 && <span className="task-start-people">{people.map((p) => p.name).join(", ")}</span>}
        </div>
        {task && (
          <button type="button" className="secondary" onClick={() => onOpen(task.id)}>
            {statusLabel(task.status)}
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

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
  // Each bot's chat bubble tint, as CSS custom properties for its messages.
  const bubbles = useMemo(
    () =>
      new Map(
        data.employees.map((e) => {
          const avatar = parseAvatarConfig(e.avatar, e.name, e.harness);
          return [e.id, bubbleStyle(avatar.bubble, avatar.color)];
        }),
      ),
    [data.employees],
  );
  const [draft, setDraft] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [dictating, setDictating] = useState(false),
    [voiceAgent, setVoiceAgent] = useState(null);
  const recognition = useRef(null);
  const [showArchived, setShowArchived] = useState(false);
  const [lastSeenMessages, setLastSeenMessages] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("anybot-last-seen") || "{}") || {};
    } catch { return {}; }
  });
  const [openBotMenu, setOpenBotMenu] = useState(null);
  const botMenuAnchor = useRef(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState(null);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem("anybot-left-sidebar");
      return saved !== null ? JSON.parse(saved) : true;
    } catch { return true; }
  });
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem("anybot-right-sidebar");
      return saved !== null ? JSON.parse(saved) : true;
    } catch { return true; }
  });
  const [activeToolsPanel, setActiveToolsPanel] = useState(null);
  const [htmlPreview, setHtmlPreview] = useState(null);
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserHtml, setBrowserHtml] = useState('');
  const [explorerPath, setExplorerPath] = useState('');
  const [projectTab, setProjectTab] = useState("chat");
  const [selectedTask, setSelectedTask] = useState(null);
  // The thread open beside the channel (its first message's id).
  const [openThread, setOpenThread] = useState(null);
  const [orgTab, setOrgTab] = useState("chart");
  const end = useRef(null);
  // Voice replies are awaited inside long-lived callbacks; read live data.
  const dataRef = useRef(data);
  dataRef.current = data;
  
  function toggleLeftSidebar() {
    setLeftSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("anybot-left-sidebar", JSON.stringify(next)); } catch {}
      return next;
    });
  }
  
  function toggleRightSidebar() {
    setRightSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("anybot-right-sidebar", JSON.stringify(next)); } catch {}
      return next;
    });
  }
  
  const openHtmlPreview = useCallback((html, type) => {
    setHtmlPreview({ html, type });
  }, []);
  
  const openInBrowser = useCallback((html) => {
    setBrowserHtml(html);
    setBrowserUrl("about:preview");
    setActiveToolsPanel('browser');
    setRightSidebarOpen(true);
    setHtmlPreview(null);
  }, []);
  
  const toggleToolsPanel = useCallback((panel) => {
    if (activeToolsPanel === panel) {
      setActiveToolsPanel(null);
    } else {
      setActiveToolsPanel(panel);
    }
  }, [activeToolsPanel]);
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
  const isProject = Boolean(conversation && conversation.members.length > 1);
  const openTaskCount = (data.tasks || []).filter(
    (task) => task.conversation === conversationId && task.status !== "done",
  ).length;
  // In a project, bots work in threads under the message that mentioned
  // them; the channel shows first messages, each with its thread summary.
  const bots = conversation
    ? data.employees.filter((e) => conversation.members.includes(e.id) && !e.archived)
    : [];
  const threads = threadIndex(messages, runs);
  const channel = isProject ? messages.filter((m) => !m.thread) : messages;
  const channelRuns = isProject ? activeRuns.filter((r) => !r.thread) : activeRuns;
  const thread = openThread && isProject ? messages.find((m) => m.id === openThread) : null;
  function openConversation(c) {
    setConversationId(c.id);
    if (c.id !== conversationId) setOpenThread(null);
    setView("chat");
    setDraft("");
    if (c.id !== conversationId) {
      setProjectTab("chat");
      setSelectedTask(null);
    }
    const convMessages = data.messages.filter((m) => m.conversation === c.id);
    const latestId = convMessages.length > 0 ? convMessages[convMessages.length - 1].id : null;
    if (latestId) {
      setLastSeenMessages((prev) => ({ ...prev, [c.id]: latestId }));
    }
  }
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversationId]);
  // Messages that arrive while a conversation is on screen are already read.
  const latestMessageId = view === "chat" ? messages.at(-1)?.id : null;
  useEffect(() => {
    if (!conversationId || !latestMessageId) return;
    setLastSeenMessages((prev) =>
      prev[conversationId] === latestMessageId ? prev : { ...prev, [conversationId]: latestMessageId },
    );
  }, [conversationId, latestMessageId]);
  useEffect(() => {
    try { localStorage.setItem("anybot-last-seen", JSON.stringify(lastSeenMessages)); } catch {}
  }, [lastSeenMessages]);
  useEffect(() => {
    if (!openBotMenu) return;
    const handleClickOutside = () => setOpenBotMenu(null);
    const handleEscape = (e) => {
      if (e.key === "Escape") setOpenBotMenu(null);
    };
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openBotMenu]);
  // @mentions in the text decide who works (runtime/mentions.mjs).
  async function send() {
    if (busy || !draft.trim()) return;
    const result = await act("messages.send", {
      conversation: conversationId,
      body: draft,
      requestId: crypto.randomUUID(),
    });
    if (!result) return;
    setDraft("");
    // Open the thread where the mentioned bots just started.
    const sent = result.messages.filter((m) => m.conversation === conversationId && m.author === "human" && !m.thread).at(-1);
    if (isProject && sent && result.runs.some((r) => r.thread === sent.id)) setOpenThread(sent.id);
  }
  async function sendInThread(body) {
    const result = await act("messages.send", {
      conversation: conversationId,
      body,
      thread: openThread,
      requestId: crypto.randomUUID(),
    });
    return Boolean(result);
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
      const before = new Set(dataRef.current.messages.filter((message) => message.conversation === conversationId).map((message) => message.id));
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
  const projectMatches = data.conversations.filter(
    (item) => item.members.length > 1 && (!sidebarTerm || item.title.toLowerCase().includes(sidebarTerm)),
  );
  const groupConversations = projectMatches.filter((item) => !item.archived);
  const archivedProjects = projectMatches.filter((item) => item.archived);
  // Deleting a project archives it (like deleting a bot); leave it if it's open.
  async function deleteProject(project) {
    const result = await act("conversations.setArchived", { conversation: project.id, archived: true });
    if (!result) return false;
    if (project.id === conversationId) {
      setConversationId(null);
      setOpenThread(null);
      setView("team");
    }
    return true;
  }
  function getConversationForEmployee(employeeId) {
    return data.conversations.find(
      (c) => c.members.length === 1 && c.members[0] === employeeId,
    );
  }
  function hasUnreadMessages(convId) {
    if (!convId) return false;
    // lastSeen can point at the owner's own message, so locate it among all
    // messages and only count replies that arrived after it.
    const convMessages = data.messages.filter((m) => m.conversation === convId);
    const lastSeenIndex = convMessages.findIndex((m) => m.id === lastSeenMessages[convId]);
    return convMessages.slice(lastSeenIndex + 1).some((m) => m.author !== "human");
  }
  async function dismissRun(runId) {
    await act("runs.dismiss", { id: runId });
  }
  const activeEmployees = data.employees.filter((e) => !e.archived);
  const archivedCount = data.employees.length - activeEmployees.length;
  const workingCount = data.runs.filter((r) => r.status === "running").length;
  const queuedCount = data.runs.filter((r) => r.status === "queued").length;
  function currentRun(employeeId) {
    return data.runs.findLast(
      (r) => r.employee === employeeId && ["running", "queued", "cancelling"].includes(r.status),
    );
  }
  function lastReply(employeeId) {
    return data.messages.findLast((m) => m.author === employeeId);
  }
  const every = (minutes) => {
    const units = [[10080, "week"], [1440, "day"], [60, "hour"]];
    for (const [size, name] of units)
      if (minutes % size === 0) {
        const n = minutes / size;
        return n === 1 ? `Every ${name}` : `Every ${n} ${name}s`;
      }
    return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
  };
  const lastLine = (text) =>
    (text || "").split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "";
  return (
    <AvatarActivityContext.Provider value={employeeAvatarStates(data, lastSeenMessages, view === "chat" ? conversationId : null)}>
    <div className="app-shell">
      <aside className={`sidebar ${leftSidebarOpen ? "" : "collapsed"}`}>
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Any Bot</span><span className="alpha">LOCAL</span>
        </div>
        <label className="sidebar-search">
          <Search size={15} />
          <input
            aria-label="Search bots and projects"
            placeholder="Search"
            value={sidebarSearch}
            onChange={(event) => setSidebarSearch(event.target.value)}
          />
        </label>
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
          <button
            className={view === "org" ? "selected" : ""}
            onClick={() => setView("org")}
          >
            <Network size={18} />
            Organization
            {data.reportsUnread > 0 && (
              <span className="nav-count" title="Unread reports">{data.reportsUnread}</span>
            )}
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
            const isMenuOpen = openBotMenu === employee.id;
            const run = currentRun(employee.id);
            const waiting = (data.approvals || []).some((a) => a.status === "pending" && a.employee === employee.id);
            // What this bot needs from you, shown right of its name.
            const attention = botAttention(employee.id, data, { unread });
            return (
              <div
                key={employee.id}
                className={`bot-row ${view === "chat" && conversation?.members.length === 1 && conversation.members[0] === employee.id ? "selected" : ""}`}
              >
                <button
                  className="bot-row-main"
                  onClick={() => directChat(employee)}
                >
                  <RobotAvatar size={60} employee={employee} working={run?.status === "running"} />
                  <span className="bot-row-text">
                    <span className="bot-row-name">
                      {employee.name}
                      <AttentionIcon attention={attention} />
                    </span>
                    <small className={attention || run?.status === "running" ? "live" : ""}>
                      {attention && attention.kind !== "done"
                        ? attention.short
                        : run
                          ? run.status === "running"
                            ? "Working…"
                            : "Queued"
                          : employee.role}
                    </small>
                  </span>
                  {unread && <i className="unread-dot" aria-label="Unread messages" />}
                </button>
                <button
                  className="bot-row-menu-trigger"
                  aria-label={`Actions for ${employee.name}`}
                  aria-expanded={isMenuOpen}
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    botMenuAnchor.current = e.currentTarget;
                    setOpenBotMenu(isMenuOpen ? null : employee.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setOpenBotMenu(null);
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
                {isMenuOpen && (
                  <FloatingMenu
                    className="bot-row-menu"
                    anchor={botMenuAnchor.current}
                    label={`Actions for ${employee.name}`}
                    onClose={() => setOpenBotMenu(null)}
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        setOpenBotMenu(null);
                        setModal({ type: "employee", preset: employee, editing: true });
                      }}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setOpenBotMenu(null);
                        setDeleteConfirm(employee);
                      }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </FloatingMenu>
                )}
              </div>
            );
          })}
          {!sidebarEmployees.length && (
            <p className="side-empty">
              {sidebarTerm ? "No bots match your search." : "No bots yet. Create one from Your team."}
            </p>
          )}
        </div>
        <div className="nav-label conversation-label">
          PROJECTS
          <button
            title="New project"
            aria-label="New project"
            onClick={() => setModal({ type: "conversation" })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="conversation-list">
          {groupConversations.length === 0 ? (
            <p className="side-empty">Your projects will live here.</p>
          ) : (
            groupConversations.map((c) => {
              const unread = hasUnreadMessages(c.id);
              const menuKey = `project:${c.id}`;
              const isMenuOpen = openBotMenu === menuKey;
              return (
                <div
                  key={c.id}
                  className={`bot-row project-row${view === "chat" && c.id === conversationId ? " selected" : ""}`}
                >
                  <button className="bot-row-main" onClick={() => openConversation(c)}>
                    <MessageSquare size={16} />
                    <span>{c.title}</span>
                    {unread && <i className="unread-dot" />}
                  </button>
                  <button
                    className="bot-row-menu-trigger"
                    aria-label={`Actions for ${c.title}`}
                    aria-expanded={isMenuOpen}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      botMenuAnchor.current = e.currentTarget;
                      setOpenBotMenu(isMenuOpen ? null : menuKey);
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {isMenuOpen && (
                    <FloatingMenu
                      className="bot-row-menu"
                      anchor={botMenuAnchor.current}
                      label={`Actions for ${c.title}`}
                      onClose={() => setOpenBotMenu(null)}
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          setOpenBotMenu(null);
                          setModal({ type: "project-settings", project: c.id });
                        }}
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                      <button
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          setOpenBotMenu(null);
                          setDeleteProjectConfirm(c);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </FloatingMenu>
                  )}
                </div>
              );
            })
          )}
          {archivedProjects.length > 0 && (
            <button
              type="button"
              className="archived-toggle"
              aria-expanded={showArchivedProjects}
              onClick={() => setShowArchivedProjects(!showArchivedProjects)}
            >
              <Archive size={14} />
              <span>Archived</span>
              <span className="archived-count">{archivedProjects.length}</span>
              <ChevronDown size={14} className={showArchivedProjects ? "chevron open" : "chevron"} />
            </button>
          )}
          {showArchivedProjects &&
            archivedProjects.map((c) => (
              <div
                key={c.id}
                className={`bot-row project-row is-archived${view === "chat" && c.id === conversationId ? " selected" : ""}`}
              >
                <button className="bot-row-main" onClick={() => openConversation(c)}>
                  <Archive size={16} />
                  <span>{c.title}</span>
                </button>
                <button
                  className="bot-row-menu-trigger"
                  aria-label={`Restore ${c.title}`}
                  title="Restore project"
                  disabled={busy}
                  onClick={() => act("conversations.setArchived", { conversation: c.id, archived: false })}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            ))}
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
          <p>
            {data.runtime.keepRunningInTray === false
              ? "Closing the window stops the local runtime cleanly."
              : "Closing the window keeps your team working from the tray."}
          </p>
          <button className="plain" onClick={() => setView("settings")}>
            <Monitor size={16} />
            Runtime & privacy
            {data.diagnostics?.unseen > 0 && (
              <span className="nav-count" title="New problems in Diagnostics">
                {data.diagnostics.unseen}
              </span>
            )}
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="owner">
          <span className="user-avatar">Y</span>
          <div>
            You<small>Workspace owner</small>
          </div>
          {shouldShowUpdateChrome(data.update) && (
            <UpdateButton 
              update={data.update} 
              onAction={async (action) => {
                try {
                  if (action === "download") {
                    await window.anybot.update.download();
                  } else if (action === "install") {
                    await window.anybot.update.install();
                  } else if (action === "retry") {
                    await window.anybot.update.retry();
                  } else if (action === "check") {
                    await window.anybot.update.check();
                  }
                } catch (e) {
                  setError(e.message);
                }
              }}
              onDismiss={async (version) => {
                await window.anybot.update.dismiss(version);
              }}
            />
          )}
          <button
            className="settings-cog"
            title="Settings"
            aria-label="Settings"
            onClick={() => setView("settings")}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="sidebar-toggle"
              onClick={toggleLeftSidebar}
              title={leftSidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-label={leftSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              {leftSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {
                {
                  team: "Your team",
                  work: "Activity",
                  routines: "Routines",
                  org: "Organization",
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
            {view === "chat" && conversation && (
              <button
                className="sidebar-toggle"
                onClick={toggleRightSidebar}
                title={rightSidebarOpen ? "Hide context rail" : "Show context rail"}
                aria-label={rightSidebarOpen ? "Hide context rail" : "Show context rail"}
              >
                {rightSidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            )}
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
            {activeEmployees.length || archivedCount ? (
              <>
                <header className="roster-heading">
                  <div>
                    <h1>Your team</h1>
                    <p className="roster-tally">
                      <span><b>{activeEmployees.length}</b> {activeEmployees.length === 1 ? "bot" : "bots"}</span>
                      <span className={workingCount ? "live" : ""}><b>{workingCount}</b> working</span>
                      <span><b>{queuedCount}</b> queued</span>
                    </p>
                  </div>
                  <div className="roster-actions">
                    <button
                      className="secondary"
                      disabled={!activeEmployees.length}
                      onClick={() => setModal({ type: "conversation" })}
                    >
                      <MessageSquare size={15} />
                      New project
                    </button>
                    <button
                      className="primary"
                      onClick={() => setModal({ type: "employee" })}
                    >
                      <Plus size={16} />
                      Create employee
                    </button>
                  </div>
                </header>
                <div className="roster-toolbar">
                  <div className="segmented" role="tablist" aria-label="Employee filter">
                    <button
                      role="tab"
                      aria-selected={!showArchived}
                      className={showArchived ? "" : "active"}
                      onClick={() => setShowArchived(false)}
                    >
                      Active
                    </button>
                    <button
                      role="tab"
                      aria-selected={showArchived}
                      className={showArchived ? "active" : ""}
                      onClick={() => setShowArchived(true)}
                    >
                      Archived
                      {archivedCount > 0 && <span className="segmented-count">{archivedCount}</span>}
                    </button>
                  </div>
                </div>
                <div className="roster">
                  {data.employees
                    .filter((e) => Boolean(e.archived) === showArchived)
                    .map((e) => {
                      const run = currentRun(e.id);
                      const working = run?.status === "running";
                      const last = !run && lastReply(e.id);
                      return (
                        <article
                          className={`roster-row${working ? " is-working" : ""}${e.archived ? " is-archived" : ""}`}
                          key={e.id}
                        >
                          <RobotAvatar size={88} employee={e} working={working} />
                          <div className="roster-who">
                            <h3>{e.name}</h3>
                            <span className="role">{e.role}</span>
                          </div>
                          <div className="roster-now">
                            <Status
                              status={
                                e.archived
                                  ? "archived"
                                  : run
                                    ? run.status === "running"
                                      ? "working"
                                      : run.status
                                    : "available"
                              }
                            />
                            <p>
                              {run
                                ? lastLine(run.output) ||
                                  data.messages.find((m) => m.id === run.message)?.body ||
                                  "Starting up…"
                                : last
                                  ? last.body
                                  : e.instructions}
                            </p>
                          </div>
                          <span className="harness-tag">
                            <Cpu size={13} />
                            {harnessName(e.harness)}
                          </span>
                          <div className="roster-row-actions">
                            {e.archived ? (
                              <button
                                className="icon-button"
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
                                <RefreshCw size={16} />
                              </button>
                            ) : (
                              <>
                                <button
                                  className="icon-button"
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
                                  className="icon-button"
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
                                  className="message-button"
                                  title={`Message ${e.name}`}
                                  aria-label={`Message ${e.name}`}
                                  onClick={() => directChat(e)}
                                >
                                  Message
                                  <ArrowUpRight size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  {showArchived && !archivedCount && (
                    <p className="roster-empty">No archived employees.</p>
                  )}
                  {!showArchived && !activeEmployees.length && (
                    <p className="roster-empty">Every employee is archived. Restore one or create a new one.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="hire">
                <header className="hire-heading">
                  <h1>Hire your first bot.</h1>
                  <p>
                    Each bot is a named employee with a role, running on a
                    harness you already use: Claude Code, Codex, Gemini,
                    Hermes, or Cursor. Put several in one project and they hand
                    work to each other.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setModal({ type: "employee" })}
                  >
                    <Plus size={16} />
                    Create employee
                  </button>
                </header>
                <ol className="hire-steps">
                  <li><b>Pick a role</b> from a template or write your own.</li>
                  <li><b>Choose a harness</b> installed on this computer.</li>
                  <li><b>Message it</b> directly, or add it to a project.</li>
                </ol>
                <div className="section-heading">
                  <h2>Start from a role</h2>
                  <span>Every field stays editable.</span>
                </div>
                <div className="template-list">
                  {presets.map((p) => (
                    <button
                      className="template-row"
                      key={p.harness}
                      onClick={() => setModal({ type: "employee", preset: p })}
                    >
                      <RobotAvatar size={76} employee={p} />
                      <span className="template-text">
                        <strong>{p.role}</strong>
                        <small>{p.summary}</small>
                      </span>
                      <span className="harness-tag">
                        <Cpu size={13} />
                        {harnessName(p.harness)}
                      </span>
                      <span className="template-cta">
                        <Plus size={14} />
                        Hire
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                      <RobotAvatar
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
                  {conversation.members.length > 1 && (
                    <button
                      type="button"
                      className="secondary"
                      title="Project settings"
                      aria-label="Project settings"
                      onClick={() => setModal({ type: "project-settings" })}
                    >
                      <Settings2 size={16} />
                      Settings
                    </button>
                  )}
                </div>
                {conversation.members.length === 1 && (
                  <button
                    type="button"
                    className={voiceAgent ? "secondary voice-active" : "secondary"}
                    aria-label={voiceAgent ? "Stop voice chat" : "Voice chat"}
                    title={voiceAgent ? "Stop voice chat" : "Voice chat"}
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
              {conversation && (
                <div className="project-tabs" role="tablist" aria-label="Conversation views">
                  <button
                    role="tab"
                    aria-selected={projectTab === "chat"}
                    className={projectTab === "chat" ? "active" : ""}
                    onClick={() => setProjectTab("chat")}
                  >
                    <MessageSquare size={15} />
                    Chat
                  </button>
                  {isProject && (
                    <button
                      role="tab"
                      aria-selected={projectTab === "board"}
                      className={projectTab === "board" ? "active" : ""}
                      onClick={() => setProjectTab("board")}
                    >
                      <Columns3 size={15} />
                      Board
                      {openTaskCount > 0 && <span className="project-tab-count">{openTaskCount}</span>}
                    </button>
                  )}
                  <button
                    role="tab"
                    aria-selected={projectTab === "canvas"}
                    className={projectTab === "canvas" ? "active" : ""}
                    onClick={() => setProjectTab("canvas")}
                  >
                    <FileText size={15} />
                    Canvas
                  </button>
                </div>
              )}
              {conversation && projectTab === "canvas" ? (
                <ProjectDoc
                  conversation={conversation}
                  data={data}
                  act={act}
                  onOpenTask={(taskId) => {
                    setSelectedTask(taskId);
                    setRightSidebarOpen(true);
                  }}
                  onOpenArtifact={openArtifact}
                  onRevealArtifact={revealArtifact}
                />
              ) : isProject && projectTab === "board" ? (
                <ProjectBoard
                  conversation={conversation}
                  tasks={data.tasks}
                  employees={data.employees}
                  runs={data.runs}
                  selectedId={selectedTask}
                  onOpen={(taskId) => {
                    setSelectedTask(taskId);
                    setRightSidebarOpen(true);
                  }}
                  act={act}
                />
              ) : (
              <>
              <div className="messages">
                {!messages.length && !conversation.archived && (
                  <div className="chat-empty">
                    <span className="empty-icon">
                      <MessageSquare size={28} />
                    </span>
                    <h2>What are we working on?</h2>
                    <p>
                      {isProject
                        ? "Mention a bot with @ to put it to work. It answers in a thread under your message, and bots can @mention each other to pull teammates in."
                        : "Give your team a clear objective. They’ll bring their progress and results back here."}
                    </p>
                  </div>
                )}
                {channel.map((m) => m.kind === "task" ? (
                  <TaskStartMessage
                    key={m.id}
                    message={m}
                    tasks={data.tasks}
                    employees={data.employees}
                    onOpen={(taskId) => {
                      setProjectTab("board");
                      setSelectedTask(taskId);
                    }}
                  />
                ) : (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    employees={data.employees}
                    bubbles={bubbles}
                    onOpenPreview={openHtmlPreview}
                    onOpenBrowser={(url) => {
                      setBrowserUrl(url);
                      setActiveToolsPanel("browser");
                      setRightSidebarOpen(true);
                    }}
                  >
                    {isProject && threads.has(m.id) && (
                      <ThreadSummary
                        entry={threads.get(m.id)}
                        employees={data.employees}
                        open={openThread === m.id}
                        onOpen={() => setOpenThread(openThread === m.id ? null : m.id)}
                      />
                    )}
                  </ChatMessage>
                ))}
                {channelRuns.map((r) => (
                  <LiveRun key={r.id} run={r} employees={data.employees} bubbles={bubbles} onStop={(id) => act("runs.cancel", { id })} />
                ))}
                {runs
                  .filter((r) =>
                    ["failed", "interrupted", "cancelled"].includes(r.status) &&
                    !r.dismissed &&
                    !(isProject && r.thread),
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
              <ApprovalBar
                approvals={(data.approvals || []).filter((a) => a.conversation === conversationId)}
                employees={data.employees}
                onDecide={(id, decision) => act("approvals.decide", { id, decision })}
              />
              <WorkingIndicator
                runs={activeRuns}
                employees={data.employees}
                onStopAll={activeRuns.length > 0 ? () => act("runtime.stopAll") : null}
              />
              {conversation.archived ? (
                <div className="archived-banner" role="status">
                  <Archive size={16} />
                  <span>This project is archived. Its history is kept. Restore it to send work again.</span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => act("conversations.setArchived", { conversation: conversation.id, archived: false })}
                  >
                    <RefreshCw size={14} />
                    Restore
                  </button>
                </div>
              ) : (
              <Composer
                bots={bots}
                draft={draft}
                setDraft={setDraft}
                onSend={send}
                mode={isProject ? "project" : "direct"}
                busy={busy}
                connected={connected}
                dictating={dictating}
                onDictate={() => startDictation((text) => setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${text}`))}
              />
              )}
              <div className="composer-note">
                Local harnesses use your configured accounts and permissions.
              </div>
              </>
              )}
            </section>
            {thread && projectTab === "chat" ? (
              <ThreadPanel
                key={thread.id}
                root={thread}
                entry={threads.get(thread.id) || { replies: [], participants: [], working: [], failed: [], last: null }}
                runs={runs.filter((r) => r.thread === thread.id)}
                employees={data.employees}
                bots={bots}
                bubbles={bubbles}
                busy={busy}
                connected={connected}
                onClose={() => setOpenThread(null)}
                onSend={sendInThread}
                onStop={(id) => act("runs.cancel", { id })}
                onDismiss={dismissRun}
                onOpenPreview={openHtmlPreview}
                onOpenBrowser={(url) => {
                  setBrowserUrl(url);
                  setActiveToolsPanel("browser");
                  setRightSidebarOpen(true);
                }}
              />
            ) : selectedTask && isProject && rightSidebarOpen && data.tasks.some((t) => t.id === selectedTask) ? (
              <TaskPeek
                taskId={selectedTask}
                data={data}
                conversation={conversation}
                act={act}
                onClose={() => setSelectedTask(null)}
                onOpenArtifact={openArtifact}
              />
            ) : (
            <ContextRail
              open={rightSidebarOpen && projectTab === "chat"}
              conversation={conversation}
              employees={data.employees}
              activeRuns={activeRuns}
              artifacts={data.artifacts}
              conversationId={conversationId}
              harnessName={harnessName}
              onOpenArtifact={openArtifact}
              onRevealArtifact={revealArtifact}
              data={data}
              act={act}
              onOpenTask={(taskId) => {
                setProjectTab(isProject ? "board" : "chat");
                setSelectedTask(taskId);
              }}
              onExpandCanvas={() => setProjectTab("canvas")}
              activeToolsTab={activeToolsPanel}
              onToolsTabChange={setActiveToolsPanel}
              browserUrl={browserUrl}
              browserHtml={browserHtml}
              explorerPath={explorerPath}
              onBrowserNavigate={(url) => setBrowserUrl(url)}
              onExplorerSelect={(path) => setExplorerPath(path)}
            />
            )}
          </div>
        )}
        {view === "work" && (
          <div className="page">
            <PageTitle
              eyebrow="FOLLOW THE WORK"
              title="Activity"
              description="Every assignment, handoff, and result in one place."
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
                    <RobotAvatar
                      size={52}
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
                  data directory. Restart Any Bot after changing this
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
            {shouldShowUpdateChrome(data.update) && (
              <div className="update-banner">
                <div className="update-banner-icon">
                  {data.update.state === "error" ? (
                    <AlertCircle size={20} />
                  ) : data.update.state === "downloaded" ? (
                    <Check size={20} />
                  ) : (
                    <Download size={20} />
                  )}
                </div>
                <div className="update-banner-content">
                  {data.update.state === "downloading" ? (
                    <>
                      <strong>Downloading update v{data.update.version}...</strong>
                      <p>
                        {data.update.progress?.percent || 0}% complete
                        {data.update.progress?.bytesPerSecond > 0 && 
                          ` · ${Math.round(data.update.progress.bytesPerSecond / 1024)} KB/s`}
                      </p>
                      <div className="update-progress-bar">
                        <div 
                          className="update-progress-fill" 
                          style={{ width: `${data.update.progress?.percent || 0}%` }} 
                        />
                      </div>
                    </>
                  ) : data.update.state === "downloaded" ? (
                    <>
                      <strong>Update ready: v{data.update.version}</strong>
                      <p>The update has been downloaded. Restart Any Bot to apply.</p>
                    </>
                  ) : data.update.state === "error" ? (
                    <>
                      <strong>Update failed</strong>
                      <p className="error-text">{data.update.error?.message || "An error occurred"}</p>
                    </>
                  ) : data.update.state === "checking" ? (
                    <>
                      <strong>Checking for updates...</strong>
                      <p>Looking for a newer version.</p>
                    </>
                  ) : (
                    <>
                      <strong>Update available: v{data.update.version}</strong>
                      <p>A new version is ready to download.</p>
                      {plainNotes(data.update.releaseNotes) && (
                        <p className="update-body">{plainNotes(data.update.releaseNotes)}</p>
                      )}
                    </>
                  )}
                </div>
                <div className="update-banner-actions">
                  {data.update.state === "available" && (
                    <>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await window.anybot.update.download();
                          } catch (e) {
                            setError(e.message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Download size={14} />
                        Download
                      </button>
                      <button
                        className="secondary"
                        onClick={() => window.anybot.update.dismiss(data.update.version)}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  {data.update.state === "downloaded" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await window.anybot.update.install();
                        } catch (e) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RefreshCw size={14} />
                      Restart & Install
                    </button>
                  )}
                  {data.update.state === "error" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await window.anybot.update.retry();
                        } catch (e) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RotateCcw size={14} />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="settings-card">
              <div>
                <h3>Check for updates</h3>
                <p>
                  Manually check for new versions of Any Bot.
                  {!data.update?.feedConfigured && (
                    <span className="update-feed-note">
                      {" "}Update feed not configured. Set ANYBOT_UPDATE_FEED_URL to enable automatic updates.
                    </span>
                  )}
                </p>
              </div>
              <button
                className="secondary"
                disabled={busy || data.update?.state === "downloading"}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await window.anybot.update.check();
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={15} />
                Check now
              </button>
            </div>
            <AppearancePanel />
            <PhoneLinkPanel />
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
            <DiagnosticsPanel
              data={data}
              onEditEmployee={(employee) => setModal({ type: "employee", preset: employee, editing: true })}
              onOpenHarnesses={() => setView("harnesses")}
            />
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
                  Start Any Bot with Windows so scheduled work and long-running
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
                <h3>Quit Any Bot</h3>
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
                    The normal profile directory is not writable. Any Bot is using an emergency temporary profile; repair the Windows profile permissions before relying on saved work.
                  </p>
                )}
              </div>
              <Folder size={22} />
            </div>
            <MobileAccess />
          </div>
        )}
        {view === "org" && (
          <React.Suspense fallback={null}>
            <OrgPage
              data={data}
              act={act}
              tab={orgTab}
              onTab={setOrgTab}
              onMessage={(employee) => directChat(employee)}
              onEdit={(employee) => setModal({ type: "employee", preset: employee, editing: true })}
            />
          </React.Suspense>
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
                        {every(r.minutes)} ·{" "}
                        {r.enabled
                          ? `Next: ${new Date(r.nextRun).toLocaleString()}`
                          : "Paused"}
                      </small>
                      {r.lastOccurrence && (
                        <small>Last run: {r.lastOccurrence}</small>
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
                  Your computer must be awake and Any Bot must be running.
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
                    : modal.type === "project-settings"
                      ? "Edit project"
                      : "Create a project"
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
              employees={data.employees}
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
          ) : modal.type === "project-settings" ? (
            <ProjectSettingsForm
              conversation={data.conversations.find((c) => c.id === (modal.project || conversationId))}
              busy={busy}
              onSave={async (settings) => {
                const next = await act("conversations.updateSettings", settings);
                if (next) setModal(null);
              }}
              onDelete={(project) => {
                setModal(null);
                setDeleteProjectConfirm(project);
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
      {htmlPreview && (
        <HtmlPreviewModal
          html={htmlPreview.html}
          onClose={() => setHtmlPreview(null)}
          onOpenInBrowser={openInBrowser}
        />
      )}
      {deleteConfirm && (
        <Modal
          title="Delete bot"
          onClose={() => setDeleteConfirm(null)}
        >
          <div className="delete-confirm-content">
            <div className="delete-confirm-avatar">
              <RobotAvatar size={104} employee={deleteConfirm} />
            </div>
            <p>
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
            </p>
            <p className="delete-confirm-note">
              This will archive the bot. Their conversations and work history will be preserved, but the bot will no longer appear in your team.
            </p>
            <div className="delete-confirm-actions">
              <button
                className="secondary"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  const result = await act("employees.setArchived", {
                    id: deleteConfirm.id,
                    revision: deleteConfirm.revision,
                    archived: true,
                  });
                  if (result) setDeleteConfirm(null);
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
      {deleteProjectConfirm && (
        <Modal title="Delete project" onClose={() => setDeleteProjectConfirm(null)}>
          {error && (
            <p role="alert" className="banner error">
              {error}
            </p>
          )}
          <div className="delete-confirm-content">
            <p>
              Are you sure you want to delete <strong>{deleteProjectConfirm.title}</strong>?
            </p>
            <p className="delete-confirm-note">
              This will archive the project and stop any work in progress. Its messages, board, canvas, and files are kept, and you can restore it from Archived under Projects.
            </p>
            <div className="delete-confirm-actions">
              <button className="secondary" onClick={() => setDeleteProjectConfirm(null)}>
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (await deleteProject(deleteProjectConfirm)) setDeleteProjectConfirm(null);
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
    </AvatarActivityContext.Provider>
  );
}
