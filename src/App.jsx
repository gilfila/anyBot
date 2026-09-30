import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  Archive,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Minimize2,
  Maximize2,
  ChevronRight,
  CirclePause,
  CircleHelp,
  Columns3,
  Clock,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  FileText,
  Hash,
  Hexagon,
  Keyboard,
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
  SquareTerminal,
  Trash2,
  Users,
  Workflow,
  Volume2,
  X,
} from "lucide-react";
import { presets, names } from "./constants.js";
import { empty, shouldShowUpdateChrome, workingBots } from "./lib/ui.js";
import { singleFlight } from "./lib/single-flight.js";
import { loadDrafts, saveDrafts, withDraft } from "./lib/drafts.js";
import { primaryChats, sidebarProjects } from "./lib/projects.js";

function UpdateButton({ update, working = 0, onAction, onDismiss }) {
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

  if (state === "downloaded" && update.installWhenIdle) {
    return (
      <button
        className="update-btn ready"
        onClick={() => handleAction("cancel")}
        disabled={busy}
        title={`v${version} installs once no bot is working. Click to cancel.`}
      >
        <Clock size={14} />
        <span>Waiting</span>
      </button>
    );
  }

  if (state === "downloaded") {
    return (
      <button
        className="update-btn ready"
        onClick={() => handleAction("install")}
        disabled={busy}
        title={`Install update v${version} and restart${working ? ` (${working} bot${working === 1 ? " is" : "s are"} working)` : ""}`}
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
import { ChatMessage, LiveRun, Stamp } from "./components/chat/ChatMessage.jsx";
import { Composer } from "./components/chat/Composer.jsx";
import { ThreadPanel, ThreadSummary } from "./components/chat/ThreadPanel.jsx";
import { threadIndex } from "./components/chat/threads.js";
import { ChatContext } from "./components/chat/ChatContext.js";
import { RunNotice } from "./components/chat/RunNotice.jsx";
import { runDetails } from "./lib/chat.js";
import "./components/chat/chat.css";
import { ApprovalBar } from "./components/ApprovalBar.jsx";
import { Status } from "./components/Status.jsx";
import { Empty } from "./components/Empty.jsx";
import { Modal } from "./components/Modal.jsx";
import { HarnessIssues } from "./components/HarnessIssues.jsx";
import { recentHarnessFailures } from "./lib/harnesses.js";
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
import { FileActions, FileLinkContext, runFileAction } from "./components/FileLinks.jsx";
import { FilePreview } from "./components/FilePreview.jsx";
import { fileSize } from "./lib/file-refs.js";
import { SectionToggle } from "./components/SectionToggle.jsx";
import { AppearancePanel } from "./components/theme/AppearancePanel.jsx";
import { PhoneLinkPanel } from "./components/PhoneLinkPanel.jsx";
import { TeamPanel } from "./components/TeamPanel.jsx";
import { PeopleReviewSettings } from "./components/PeopleReviewSettings.jsx";
import { VoicePanel } from "./components/VoicePanel.jsx";
import { VoiceBar } from "./components/VoiceBar.jsx";
import { useVoice } from "./lib/useVoice.js";
import { haltKey } from "./lib/voice.js";
import { findHq } from "../runtime/hq.mjs";
import { TeamBanner, TeamPulse } from "./components/TeamPulse.jsx";
import { occurrenceLabel } from "./lib/team.js";
import { SlackPanel } from "./components/SlackPanel.jsx";
import { BuzzPanel } from "./components/BuzzPanel.jsx";
import { AttentionIcon } from "./components/AttentionIcon.jsx";
import { botAttention } from "./lib/attention.js";
import { attentionTarget, resolveTarget } from "./lib/navigation.js";
import { SHORTCUTS, closeOnEscape, nextApproval, shortcutFor, shortcutKeys } from "./lib/shortcuts.js";
import { plainNotes } from "./lib/update-notes.js";
import { RunTerminal } from "./components/RunTerminal.jsx";
import { UsageToday } from "./components/UsageToday.jsx";
import { describeTokens, runTokens } from "./lib/usage.js";
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
            {message.author === "system" ? "Autopilot started" : "You started"} · <Stamp at={message.created} />
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
  // A short confirmation (a copied path, a file shown in its folder).
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  // File links in messages (components/FileLinks.jsx): errors use the banner,
  // Preview opens the file modal. onOwnerReveal is only for paths the owner
  // chose (attachments, the Files panel) that main won't link, such as a
  // network share: they show in their folder as they always did.
  const fileLinks = useMemo(
    () => ({
      onFileAction: (action, target) =>
        runFileAction(action, target, {
          setError,
          setNotice,
          openPreview: (preview, from) => setModal({ type: "file", preview, target: from }),
        }),
      onOwnerReveal: (path) => {
        setError("");
        setNotice("");
        return revealOwnerPath(path);
      },
    }),
    [],
  );
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
  // Unsent text per conversation (src/lib/drafts.js); `draft` is the open one's.
  const [drafts, setDrafts] = useState(loadDrafts);
  const draft = drafts[conversationId] || "";
  const setDraftFor = useCallback(
    (id, next) =>
      setDrafts((current) => {
        const updated = withDraft(current, id, typeof next === "function" ? next(current[id] || "") : next);
        if (updated !== current) saveDrafts(updated);
        return updated;
      }),
    [],
  );
  const setDraft = useCallback((next) => setDraftFor(conversationId, next), [conversationId, setDraftFor]);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [lastSeenMessages, setLastSeenMessages] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("anybot-last-seen") || "{}") || {};
    } catch { return {}; }
  });
  const [openBotMenu, setOpenBotMenu] = useState(null);
  // Harnesses: the harness whose problems are open in the details dialog.
  const [harnessDetail, setHarnessDetail] = useState(null);
  const botMenuAnchor = useRef(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteRoutineConfirm, setDeleteRoutineConfirm] = useState(null);
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState(null);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  // Sidebar sections the owner folded away (Workspace, Bots, Projects);
  // remembered in this window only.
  const [foldedSections, setFoldedSections] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("anybot-sidebar-folded") || "{}") || {};
    } catch {
      return {};
    }
  });
  // Compact bot list: small avatars, one line per bot (remembered here).
  const [compactBots, setCompactBots] = useState(() => {
    try {
      return localStorage.getItem("anybot-compact-bots") === "true";
    } catch {
      return false;
    }
  });
  const toggleCompactBots = () =>
    setCompactBots((current) => {
      try { localStorage.setItem("anybot-compact-bots", String(!current)); } catch {}
      return !current;
    });
  const toggleSection = (name) =>
    setFoldedSections((current) => {
      const next = { ...current, [name]: !current[name] };
      try { localStorage.setItem("anybot-sidebar-folded", JSON.stringify(next)); } catch {}
      return next;
    });
  const [openTerminal, setOpenTerminal] = useState(null);
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
  // Long-lived callbacks (a clicked notification) read live data.
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
  // One snapshot request at a time (plus one after it for whatever changed
  // meanwhile): while bots stream, change pushes come up to ten a second.
  // A window hidden in the tray skips them and catches up when shown.
  const refresh = useMemo(
    () =>
      singleFlight(async () => {
        if (!window.anybot) return;
        try {
          setData(await window.anybot.request("snapshot"));
          setConnected(true);
        } catch {
          setConnected(false);
        }
      }),
    [],
  );
  useEffect(() => {
    const visibleRefresh = () => {
      if (!document.hidden) refresh();
    };
    refresh();
    const off = window.anybot?.onChanged(visibleRefresh);
    const timer = setInterval(visibleRefresh, 4000);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      off?.();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh]);
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
  // Each bot's direct chat; any other conversation has project settings.
  const directChats = useMemo(() => primaryChats(data.conversations), [data.conversations]);
  const isDirectChat = Boolean(conversation && directChats.has(conversation.id));
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
  // A jump into the conversation already open (Ctrl+Shift+A, a notification)
  // keeps what you were typing.
  function openConversation(c) {
    setConversationId(c.id);
    setView("chat");
    // Each conversation keeps its own unsent text (drafts).
    if (c.id !== conversationId) {
      setOpenThread(null);
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
    // Marks Esc as used, so it closes the menu and not a voice chat too.
    const handleEscape = closeOnEscape(() => setOpenBotMenu(null));
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openBotMenu]);
  // @mentions in the text decide who works (runtime/mentions.mjs).
  // Attachments are paths the composer collected (dropped, pasted, picked).
  async function send(attachments = []) {
    if (busy || (!draft.trim() && !attachments.length)) return false;
    const sentFrom = conversationId;
    const result = await act("messages.send", {
      conversation: sentFrom,
      body: draft,
      attachments,
      requestId: crypto.randomUUID(),
    });
    if (!result) return false;
    setDraftFor(sentFrom, "");
    // Open the thread where the mentioned bots just started.
    const sent = result.messages.filter((m) => m.conversation === conversationId && m.author === "human" && !m.thread).at(-1);
    if (isProject && sent && result.runs.some((r) => r.thread === sent.id)) setOpenThread(sent.id);
    return true;
  }
  async function sendInThread(body, attachments = []) {
    const result = await act("messages.send", {
      conversation: conversationId,
      body,
      attachments,
      thread: openThread,
      requestId: crypto.randomUUID(),
    });
    return Boolean(result);
  }
  // Voice chat and dictation (src/lib/useVoice.js). A spoken turn is sent
  // like a typed message, from the owner at the desk.
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;
  const voice = useVoice({
    send: async (payload) => Boolean(await act("messages.send", payload)),
    onError: setError,
    // A voice chat in a project talks in one thread: open it when it starts.
    onThread: (conversation, thread) => {
      if (conversationRef.current === conversation) setOpenThread(thread);
    },
    // Why a voice chat ended on its own (3 quiet minutes, 20 turns).
    onNotice: setNotice,
  });
  // Stop the team, a Pause or Stop everything ends a voice chat too: pulling
  // a brake means no more work, and an open mic would keep making some.
  const halted = haltKey(data);
  const haltedBefore = useRef(halted);
  const stopVoice = voice.stop;
  useEffect(() => {
    const before = haltedBefore.current;
    haltedBefore.current = halted;
    if (halted && halted !== before) stopVoice();
  }, [halted, stopVoice]);
  // HQ (runtime/hq.mjs): the room where the chief of the org can be talked to.
  const hq = useMemo(() => findHq(data.employees, data.conversations), [data.employees, data.conversations]);
  const hqChief = hq?.conversation ? data.employees.find((employee) => employee.id === hq.employee) : null;
  async function directChat(employee) {
    const existing = data.conversations.find(
      (c) => directChats.has(c.id) && c.members[0] === employee.id,
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
  // Searching opens every folded section so matches are never hidden.
  const folded = (name) => !sidebarTerm && Boolean(foldedSections[name]);
  const sidebarEmployees = data.employees
    .filter((employee) => !employee.archived)
    .filter((employee) => !sidebarTerm || `${employee.name} ${employee.role}`.toLowerCase().includes(sidebarTerm));
  // Projects, plus one-bot conversations that aren't a bot's direct chat
  // (src/lib/projects.js), so none becomes unreachable.
  const projectMatches = sidebarProjects(data.conversations).filter(
    (item) => !sidebarTerm || item.title.toLowerCase().includes(sidebarTerm),
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
      (c) => directChats.has(c.id) && c.members[0] === employeeId,
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
  // Restarting for an update, or quitting, stops the bots that are working.
  // Ask first when any are, and offer to install once they finish.
  const [stopConfirm, setStopConfirm] = useState(null);
  async function installUpdate(when) {
    setError("");
    try {
      const result = await window.anybot.update.install(when === "idle" ? { when: "idle" } : undefined);
      if (result?.error) setError(result.error);
      else if (result?.update) setData((current) => ({ ...current, update: result.update }));
    } catch (e) {
      setError(e.message);
    }
  }
  function requestInstall() {
    const bots = workingBots(data);
    if (bots.length) setStopConfirm({ kind: "update", bots });
    else installUpdate("now");
  }
  function requestQuit() {
    const bots = workingBots(data);
    if (bots.length) setStopConfirm({ kind: "quit", bots });
    else window.anybot.request("app.quit").catch((e) => setError(e.message));
  }
  async function dismissRun(runId) {
    await act("runs.dismiss", { id: runId });
  }
  // "Details" on a stopped run: its harness's problems, or Settings →
  // Diagnostics (scrolled into view once the page is up).
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  function openRunDetails(run) {
    const target = runDetails(run, data);
    if (target.view === "harnesses") {
      setHarnessDetail(target.harness);
      setView("harnesses");
    } else {
      setShowDiagnostics(true);
      setView("settings");
    }
  }
  useEffect(() => {
    if (!showDiagnostics || view !== "settings") return;
    document.getElementById("diagnostics-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setShowDiagnostics(false);
  }, [showDiagnostics, view]);
  // Jumps from anywhere (notifications, the sidebar's attention, Activity,
  // the board, Organization, Diagnostics, Routines): the conversation, then
  // its thread or task, then the message (src/lib/navigation.js). A run whose
  // conversation is gone opens its terminal in Activity instead.
  const [focusMessage, setFocusMessage] = useState(null);
  const [focusRun, setFocusRun] = useState(null);
  function openRunTerminal(runId) {
    setView("work");
    setOpenTerminal(runId);
    setFocusRun({ id: runId });
  }
  function openTarget(target, source = data) {
    const place = resolveTarget(target, source);
    if (!place) {
      setError("That conversation isn't there any more.");
      return false;
    }
    if (place.view === "work") {
      openRunTerminal(place.run);
      return true;
    }
    openConversation(source.conversations.find((c) => c.id === place.conversation));
    setOpenThread(place.thread);
    setSelectedTask(place.task);
    setProjectTab(place.task ? "board" : "chat");
    if (place.task) setRightSidebarOpen(true);
    setFocusMessage(place.message ? { id: place.message } : null);
    return true;
  }
  // Scroll the jumped-to message into view (the thread panel's copy when
  // it's open) and mark it for a moment.
  useEffect(() => {
    if (!focusMessage || view !== "chat") return undefined;
    let clear, node;
    const timer = setTimeout(() => {
      node = [...document.querySelectorAll(`[data-message="${CSS.escape(focusMessage.id)}"]`)].at(-1);
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.classList.add("is-target");
      clear = setTimeout(() => node.classList.remove("is-target"), 2000);
    }, 150);
    // A second jump within the 2 s unmarks this message first.
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
      node?.classList.remove("is-target");
    };
  }, [focusMessage, view]);
  useEffect(() => {
    if (!focusRun || view !== "work") return undefined;
    const timer = setTimeout(
      () => document.getElementById(`run-${focusRun.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
    return () => clearTimeout(timer);
  }, [focusRun, view]);
  // A clicked notification (desktop/main.cjs): the approval it was about,
  // resolved against a fresh snapshot since it may be newer than ours.
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;
  useEffect(
    () =>
      window.anybot?.onNavigate?.(async (target) => {
        let source = dataRef.current;
        try {
          source = await window.anybot.request("snapshot");
          setData(source);
        } catch {
          // Resolve against what's on screen.
        }
        openTargetRef.current(target, source);
      }),
    [],
  );
  // Keyboard shortcuts (src/lib/shortcuts.js, listed in Settings). Not while
  // a dialog is open: it owns the keyboard.
  const searchInput = useRef(null);
  const shownApproval = useRef(null);
  const shortcut = useRef(null);
  shortcut.current = (action) => {
    if (action === "sidebar") toggleLeftSidebar();
    else if (action === "search") {
      if (!leftSidebarOpen) toggleLeftSidebar();
      setTimeout(() => {
        searchInput.current?.focus();
        searchInput.current?.select();
      }, 50);
    } else if (action === "approval") {
      const next = nextApproval(data.approvals, shownApproval.current);
      if (!next) setNotice("Nothing is waiting for your approval.");
      else {
        shownApproval.current = next.id;
        openTarget({ approval: next.id });
      }
    }
  };
  useEffect(() => {
    const onKey = (event) => {
      const action = shortcutFor(event);
      if (!action || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      shortcut.current(action);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Copies text the app shows (a command, a path) and says so.
  async function copyToClipboard(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`Copied ${what}.`);
    } catch {
      setError("Couldn't reach the clipboard. Select the text and copy it instead.");
    }
  }
  // A path this computer reported (a harness's program, from the probe);
  // never bot output, which only goes through files.*.
  async function revealOwnerPath(path) {
    try {
      await window.anybot.revealPath(path);
    } catch (error) {
      setError(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
    }
  }
  async function openDataFolder() {
    try {
      const result = await window.anybot.request("app.openDataFolder");
      if (result?.error) setError(`Couldn't open the data folder: ${result.error}`);
    } catch (error) {
      setError(error.message);
    }
  }
  // Organization: the bot whose panel is open (the roster's names open it).
  const [orgSelected, setOrgSelected] = useState(null);
  function openInOrg(employeeId) {
    setOrgTab("chart");
    setOrgSelected(employeeId);
    setView("org");
  }
  // What messages link out to (components/chat/ChatContext.js).
  const chatLinks = {
    employees: data.employees,
    runs: data.runs,
    artifacts: data.artifacts,
    paused: data.runtime.paused,
    // Why each queued run waits (runtime dispatch), and Interrupt.
    waits: data.team?.waits || {},
    harnessName,
    // `waiting`: the owner's queued run the interrupt makes way for.
    onInterrupt: (id, waiting) => act("runs.interrupt", { id, for: waiting }),
    onOpenBot: directChat,
    onOpenArtifact: openArtifact,
    onRevealArtifact: revealArtifact,
    onRetry: (id) => act("runs.retry", { id }),
    onDetails: openRunDetails,
  };
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
    <FileLinkContext.Provider value={fileLinks}>
    <ChatContext.Provider value={chatLinks}>
    <div className="app-shell">
      <VoiceBar state={voice.state} pushToTalk={voice.pushToTalk} onStop={voice.stop} onPress={voice.press} onRelease={voice.release} />
      <aside className={`sidebar ${leftSidebarOpen ? "" : "collapsed"}`}>
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Any Bot</span><span className="alpha">LOCAL</span>
        </div>
        <label className="sidebar-search">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label="Search bots and projects"
            placeholder="Search"
            title={`Search bots and projects (${shortcutKeys("search")}). Enter opens the first match.`}
            value={sidebarSearch}
            onChange={(event) => setSidebarSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && sidebarSearch) {
                event.preventDefault();
                setSidebarSearch("");
              } else if (event.key === "Enter" && sidebarTerm) {
                // A quick switcher: open the first match, then show every row again.
                event.preventDefault();
                const bot = sidebarEmployees[0];
                const project = groupConversations[0];
                if (bot) directChat(bot);
                else if (project) openConversation(project);
                if (bot || project) setSidebarSearch("");
              }
            }}
          />
        </label>
        <div className="sidebar-scroll">
        <div className="nav-label section-heading-row">
          <SectionToggle name="workspace" label="WORKSPACE" folded={folded("workspace")} onToggle={toggleSection} />
        </div>
        <nav hidden={folded("workspace")}>
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
        <div className="nav-label conversation-label section-heading-row">
          <SectionToggle name="bots" label="BOTS" count={sidebarEmployees.length} folded={folded("bots")} onToggle={toggleSection} />
          <button
            className="compact-toggle"
            title={compactBots ? "Show bots full size" : "Minimize bots to a compact list"}
            aria-label={compactBots ? "Show bots full size" : "Minimize bots"}
            aria-pressed={compactBots}
            onClick={toggleCompactBots}
          >
            {compactBots ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
          <button
            title="New bot"
            aria-label="New bot"
            onClick={() => setModal({ type: "employee" })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className={`conversation-list bot-list${compactBots ? " compact" : ""}`} hidden={folded("bots")}>
          {sidebarEmployees.map((employee) => {
            const botConv = getConversationForEmployee(employee.id);
            const unread = botConv && hasUnreadMessages(botConv.id);
            const isMenuOpen = openBotMenu === employee.id;
            const run = currentRun(employee.id);
            const waiting = (data.approvals || []).some((a) => a.status === "pending" && a.employee === employee.id);
            // What this bot needs from you, shown right of its name. The row
            // opens where that is (the approval, failed run, question or PR);
            // otherwise, and for a plain new reply, the direct chat.
            const attention = botAttention(employee.id, data, { unread });
            const jump = attentionTarget(attention);
            const jumpable = Boolean(jump && resolveTarget(jump, data));
            return (
              <div
                key={employee.id}
                className={`bot-row ${view === "chat" && isDirectChat && conversation.members[0] === employee.id ? "selected" : ""}`}
              >
                <button
                  className="bot-row-main"
                  title={jumpable ? `${attention.label}: open it` : undefined}
                  onClick={() => (jumpable ? openTarget(jump) : directChat(employee))}
                >
                  <RobotAvatar size={compactBots ? 28 : 60} employee={employee} working={run?.status === "running"} />
                  <span className="bot-row-text">
                    <span className="bot-row-name">
                      {employee.name}
                      <AttentionIcon attention={attention} />
                    </span>
                    {/* Compact rows drop the role line but keep live status. */}
                    {(!compactBots || (attention && attention.kind !== "done") || run) && (
                      <small className={attention || run?.status === "running" ? "live" : ""}>
                        {attention && attention.kind !== "done"
                          ? attention.short
                          : run
                            ? run.status === "running"
                              ? "Working…"
                              : "Queued"
                            : employee.role}
                      </small>
                    )}
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
                    {jumpable && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setOpenBotMenu(null);
                          directChat(employee);
                        }}
                      >
                        <MessageSquare size={14} />
                        Message directly
                      </button>
                    )}
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
                      onClick={() => {
                        setOpenBotMenu(null);
                        setModal({ type: "slack", employee });
                      }}
                    >
                      <Hash size={14} />
                      Connect to Slack
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setOpenBotMenu(null);
                        setModal({ type: "buzz", employee });
                      }}
                    >
                      <Hexagon size={14} />
                      Connect to Buzz
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
        <div className="nav-label conversation-label section-heading-row">
          <SectionToggle name="projects" label="PROJECTS" count={groupConversations.length} folded={folded("projects")} onToggle={toggleSection} />
          <button
            title="New project"
            aria-label="New project"
            onClick={() => setModal({ type: "conversation" })}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="conversation-list project-list" hidden={folded("projects")}>
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
        </div>
        <div className="sidebar-bottom">
          <TeamPulse
            team={connected ? data.team : null}
            harnessName={harnessName}
            busy={busy}
            onOpen={() => setView("settings")}
            onAct={act}
          />
          <div className="runtime-indicator">
            <i className={connected && !data.runtime.paused ? "online" : ""} />
            <span>
              {!connected
                ? "Connecting to runtime"
                : data.runtime.paused
                  ? "New work paused"
                  : "Local runtime online"}
            </span>
            {connected && data.runtime.paused && (
              <button type="button" className="resume-link" onClick={() => act("runtime.resume")}>
                Resume
              </button>
            )}
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
              working={workingBots(data).length}
              onAction={async (action) => {
                try {
                  if (action === "download") {
                    await window.anybot.update.download();
                  } else if (action === "install") {
                    requestInstall();
                  } else if (action === "cancel") {
                    await window.anybot.update.cancelInstall();
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
              title={`${leftSidebarOpen ? "Hide sidebar" : "Show sidebar"} (${shortcutKeys("sidebar")})`}
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
        {notice && (
          <div role="status" className="banner">
            {notice}
            <button aria-label="Dismiss" onClick={() => setNotice("")}>
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
                      const now = run
                        ? lastLine(run.output) || data.messages.find((m) => m.id === run.message)?.body || "Starting up…"
                        : last
                          ? last.body
                          : e.instructions;
                      // The now-line opens the live run's terminal, or the
                      // last reply where it was posted.
                      const openNow = run
                        ? () => openRunTerminal(run.id)
                        : last && resolveTarget({ message: last.id }, data)
                          ? () => openTarget({ message: last.id })
                          : null;
                      return (
                        <article
                          className={`roster-row${working ? " is-working" : ""}${e.archived ? " is-archived" : ""}`}
                          key={e.id}
                        >
                          <RobotAvatar size={88} employee={e} working={working} />
                          <div className="roster-who">
                            <h3>
                              {e.archived ? (
                                e.name
                              ) : (
                                <button
                                  type="button"
                                  className="text-link"
                                  title={`See ${e.name} in Organization`}
                                  onClick={() => openInOrg(e.id)}
                                >
                                  {e.name}
                                </button>
                              )}
                            </h3>
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
                            {openNow ? (
                              <button
                                type="button"
                                className="roster-now-link"
                                title={run ? `Watch ${e.name}'s terminal` : "Open this reply in its conversation"}
                                onClick={openNow}
                              >
                                <span className="roster-line">{now}</span>
                              </button>
                            ) : (
                              <p>{now}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            className="harness-tag"
                            title="Open Harnesses"
                            onClick={() => setView("harnesses")}
                          >
                            <Cpu size={13} />
                            {harnessName(e.harness)}
                          </button>
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
                    harness you already use: Claude Code, Codex, Antigravity,
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
                    {conversation.members.length === 1 ? "" : "s"}
                    {conversation.members.length > 1 ? " · Bots hand work to each other" : ""}
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
                  {!isDirectChat && (
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
                {(() => {
                  const target =
                    conversation.members.length === 1
                      ? data.employees.find((employee) => employee.id === conversation.members[0])
                      : hqChief && hq.conversation === conversation.id
                        ? hqChief
                        : null;
                  if (!target) return null;
                  const on = voice.state.mode === "chat" && voice.state.conversation === conversation.id;
                  const label = conversation.members.length === 1 ? "Voice chat" : `Talk to ${target.name}`;
                  return (
                    <button
                      type="button"
                      className={on ? "secondary voice-active" : "secondary"}
                      aria-label={on ? "Stop voice chat" : label}
                      title={on ? "Stop voice chat (Esc)" : `${label}: speak, and hear the answer`}
                      disabled={Boolean(conversation.archived)}
                      onClick={() =>
                        on
                          ? voice.stop()
                          : voice.startChat({
                              conversation: conversation.id,
                              employee: { id: target.id, name: target.name },
                              project: conversation.members.length > 1,
                            })
                      }
                    >
                      <Volume2 size={15} />
                      {on ? "Stop voice chat" : label}
                    </button>
                  );
                })()}
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
                    onReplyInThread={isProject && m.author !== "system" && !conversation.archived ? () => setOpenThread(m.id) : undefined}
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
                    <RunNotice key={r.id} run={r} employees={data.employees} onDismiss={dismissRun} />
                  ))}
                <div ref={end} />
              </div>
              <ApprovalBar
                approvals={(data.approvals || []).filter((a) => a.conversation === conversationId)}
                employees={data.employees}
                runs={runs}
                paused={data.runtime.paused}
                openThread={isProject ? openThread : null}
                onOpenThread={isProject ? setOpenThread : null}
                onDecide={(id, decision) => act("approvals.decide", { id, decision })}
              />
              <WorkingIndicator
                runs={activeRuns}
                employees={data.employees}
                onStopAll={activeRuns.length > 0 ? () => act("runs.stopConversation", { conversation: conversation.id }) : null}
              />
              {data.runtime.paused && !conversation.archived && (
                <div className="paused-banner" role="status">
                  <CirclePause size={18} />
                  <span>New work is paused, so bots won't start anything you send until you resume.</span>
                  <button type="button" className="secondary" disabled={busy} onClick={() => act("runtime.resume")}>
                    <Play size={14} />
                    Resume
                  </button>
                </div>
              )}
              {!conversation.archived && (
                <TeamBanner
                  team={data.team}
                  harnesses={data.employees.filter((e) => conversation.members.includes(e.id)).map((e) => e.harness)}
                  harnessName={harnessName}
                  busy={busy}
                  onAct={act}
                />
              )}
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
                key={conversationId}
                bots={bots}
                draft={draft}
                setDraft={setDraft}
                onSend={send}
                mode={isProject ? "project" : "direct"}
                busy={busy}
                connected={connected}
                dictating={voice.state.mode === "dictate"}
                onDictate={() => voice.dictate((text) => setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${text}`))}
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
                onRevealArtifact={revealArtifact}
                onOpenThread={(thread) => {
                  setProjectTab("chat");
                  setOpenThread(thread);
                }}
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
            {data.runtime.paused && (
              <div className="paused-banner" role="status">
                <CirclePause size={18} />
                <span>
                  New work is paused
                  {data.runs.some((r) => r.status === "queued")
                    ? `, so ${data.runs.filter((r) => r.status === "queued").length} queued assignment${data.runs.filter((r) => r.status === "queued").length === 1 ? " is" : "s are"} waiting.`
                    : ". Bots won't start new work until you resume."}
                </span>
                <button type="button" className="secondary" disabled={busy} onClick={() => act("runtime.resume")}>
                  <Play size={14} />
                  Resume
                </button>
              </div>
            )}
            <UsageToday runs={data.runs} employees={data.employees} />
            {!data.runs.length ? (
              <Empty
                title="A clear view of progress"
                text="Send your first assignment and follow it here, from the queue to the final result."
              />
            ) : (
              <div className="run-list">
                {[...data.runs].reverse().map((r) => {
                  const bot = data.employees.find((e) => e.id === r.employee);
                  const open = openTerminal === r.id;
                  const tokens = runTokens(r);
                  return (
                  <React.Fragment key={r.id}>
                  <article id={`run-${r.id}`} className={`run-row${open ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="run-open"
                      aria-expanded={open}
                      aria-controls={open ? `terminal-${r.id}` : undefined}
                      title={open ? "Hide the terminal" : `See ${bot?.name || "the bot"}'s terminal`}
                      onClick={() => setOpenTerminal(open ? null : r.id)}
                    >
                      <RobotAvatar size={52} employee={bot} working={r.status === "running"} />
                      <span className="run-description">
                        <strong>{bot?.name}</strong>
                        <span className="run-body">{data.messages.find((m) => m.id === r.message)?.body}</span>
                        {r.error && <small className="error-text">{r.error}</small>}
                        {tokens && (
                          <small className="run-usage" title="Tokens this run used, as its harness reported them">
                            {describeTokens(tokens)}
                          </small>
                        )}
                        <span className="terminal-hint">
                          <SquareTerminal size={13} aria-hidden="true" />
                          {open ? "Hide terminal" : r.status === "running" ? "Watch live in the terminal" : "Terminal"}
                        </span>
                      </span>
                    </button>
                    <Status status={r.status} />
                    {["running", "queued"].includes(r.status) && (
                      <button
                        className="secondary"
                        onClick={() => act("runs.cancel", { id: r.id })}
                      >
                        Stop
                      </button>
                    )}
                    {/* Where the work happened: its thread, else its task, else
                        the conversation, scrolled to the reply. */}
                    <button
                      aria-label="Open conversation"
                      title={
                        data.conversations.some((c) => c.id === r.conversation)
                          ? "Open where this happened"
                          : "Its conversation was deleted"
                      }
                      disabled={!data.conversations.some((c) => c.id === r.conversation)}
                      onClick={() => openTarget({ run: r.id })}
                    >
                      <ArrowUpRight size={19} />
                    </button>
                  </article>
                  {open && (
                    <div id={`terminal-${r.id}`}>
                      <RunTerminal run={r} paused={data.runtime.paused} name={bot?.name || "Bot"} />
                    </div>
                  )}
                  </React.Fragment>
                  );
                })}
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
              {data.harnesses.map((h) => {
                const failures = recentHarnessFailures(h.id, data.runs, data.employees);
                const problems = (h.issues?.length || 0) + failures.length;
                return (
                <article key={h.id}>
                  <div className="harness-icon">
                    <Cpu size={24} />
                  </div>
                  <div>
                    <h3>{h.name}</h3>
                    <p>{h.detail}</p>
                    {failures.length > 0 && (
                      <p className="harness-failures">
                        {failures.length} failed run{failures.length === 1 ? "" : "s"} in the last week.
                      </p>
                    )}
                    {h.login && (
                      <>
                        <span className="harness-copy-row">
                          <code>{h.login}</code>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Copy ${h.login}`}
                            title="Copy the sign-in command"
                            onClick={() => copyToClipboard(h.login, "the sign-in command")}
                          >
                            <Copy size={14} />
                          </button>
                        </span>
                        <small>
                          Run this in your terminal to authenticate.
                        </small>
                      </>
                    )}
                    {h.executable && (
                      <span className="harness-copy-row">
                        <small className="path">{h.executable}</small>
                        {/* The probe's own find on this computer, not bot output. */}
                        {/^(?:[A-Za-z]:[\\/]|\/)/.test(h.executable) && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Show ${h.name}'s program in its folder`}
                            title="Show in folder"
                            onClick={() => revealOwnerPath(h.executable)}
                          >
                            <FolderOpen size={14} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {problems > 0 ? (
                    <button
                      type="button"
                      className="status-button"
                      title="What's wrong, and how to fix it"
                      aria-label={`${h.name}: ${[
                        h.issues?.length && `${h.issues.length} problem${h.issues.length === 1 ? "" : "s"}`,
                        failures.length && `${failures.length} failed run${failures.length === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(", ")}. Show details`}
                      onClick={() => setHarnessDetail(h.id)}
                    >
                      <Status status={h.status === "detected" ? "warning" : h.status} />
                      <span>Details</span>
                    </button>
                  ) : (
                    <Status status={h.status} />
                  )}
                </article>
                );
              })}
            </div>
            {harnessDetail && data.harnesses.some((h) => h.id === harnessDetail) && (
              <HarnessIssues
                harness={data.harnesses.find((h) => h.id === harnessDetail)}
                failures={recentHarnessFailures(harnessDetail, data.runs, data.employees)}
                onClose={() => setHarnessDetail(null)}
                onOpenRun={(runId) => {
                  setHarnessDetail(null);
                  openRunTerminal(runId);
                }}
              />
            )}
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
                <button type="button" className="secondary" onClick={openDataFolder}>
                  <FolderOpen size={14} />
                  Open the app data folder
                </button>
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
                  ) : data.update.state === "downloaded" && data.update.installWhenIdle ? (
                    <>
                      <strong>Restarting when the team is idle: v{data.update.version}</strong>
                      <p>
                        The update installs once no bot is working
                        {workingBots(data).length ? ` (still working: ${workingBots(data).join(", ")})` : ""}. New work waits until after the restart.
                      </p>
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
                    <button className="primary" disabled={busy} onClick={requestInstall}>
                      <RefreshCw size={14} />
                      {data.update.installWhenIdle ? "Restart now" : "Restart & Install"}
                    </button>
                  )}
                  {data.update.state === "downloaded" && data.update.installWhenIdle && (
                    <button className="secondary" onClick={() => window.anybot.update.cancelInstall().catch((e) => setError(e.message))}>
                      Cancel
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
            {data.update?.supported === false ? (
            <div className="settings-card">
              <div>
                <h3>Updates</h3>
                <p>
                  This copy of Any Bot runs from source, so it doesn't update
                  itself. To get the latest version, quit Any Bot and run{" "}
                  <code>git pull && npm ci && npm start</code> in its folder.
                </p>
              </div>
            </div>
            ) : (
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
            )}
            <AppearancePanel />
            <PhoneLinkPanel />
            <VoicePanel />
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
              onOpenTarget={openTarget}
              onOpenRun={openRunTerminal}
              onOpenBot={directChat}
            />
            <TeamPanel data={data} act={act} busy={busy} harnessName={harnessName} />
            <PeopleReviewSettings stamp={JSON.stringify(data.people ?? null)} />
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
                <p>
                  Up to {data.runtime.concurrency || 8} bots work at the same time; each bot takes one assignment at a time.
                  {data.runtime.paused ? " New work is paused right now, so nothing new starts until you resume." : ""}
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
                <h3>Stop everything</h3>
                <p>
                  Cancel all running and queued work, yours included, and pause new work until you resume. To stop only
                  the work that starts on its own, use Stop the team above.
                </p>
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
              <button className="danger" onClick={requestQuit}>
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
              <div className="settings-actions">
                <button type="button" className="secondary" onClick={openDataFolder}>
                  <Folder size={15} />
                  Open folder
                </button>
                {data.runtime.directory && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => copyToClipboard(data.runtime.directory, "the data folder's path")}
                  >
                    <Copy size={15} />
                    Copy path
                  </button>
                )}
              </div>
            </div>
            <div className="settings-card">
              <div>
                <h3>Keyboard shortcuts</h3>
                <dl className="shortcut-list">
                  {SHORTCUTS.map((item) => (
                    <React.Fragment key={item.keys}>
                      <dt>
                        <kbd>{item.keys}</kbd>
                      </dt>
                      <dd>{item.label}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
              <Keyboard size={22} />
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
              selected={orgSelected}
              onSelect={setOrgSelected}
              onOpenTarget={openTarget}
              onOpenRun={openRunTerminal}
              onOpenArtifact={openArtifact}
              onRevealArtifact={revealArtifact}
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
                {data.routines.map((r) => {
                  const bot = data.employees.find((e) => e.id === r.employee);
                  const home = data.conversations.find((c) => c.id === r.conversation);
                  const lastRun = r.lastRun && data.runs.find((run) => run.id === r.lastRun);
                  return (
                  <article className="run-row" key={r.id}>
                    <Clock size={23} />
                    <div className="run-description">
                      <strong>{r.name}</strong>
                      <p>{r.prompt}</p>
                      <small>
                        {bot && !bot.archived ? (
                          <button type="button" className="text-link" title={`Message ${bot.name} directly`} onClick={() => directChat(bot)}>
                            {bot.name}
                          </button>
                        ) : (
                          bot?.name || "A former bot"
                        )}{" "}
                        in{" "}
                        {home ? (
                          <button type="button" className="text-link" title={`Open ${home.title}`} onClick={() => openConversation(home)}>
                            {home.title}
                          </button>
                        ) : (
                          "a deleted conversation"
                        )}{" "}
                        · {every(r.minutes)} ·{" "}
                        {r.enabled
                          ? `Next: ${new Date(r.nextRun).toLocaleString()}`
                          : "Paused"}
                      </small>
                      {r.lastOccurrence && (
                        <small>
                          Last run:{" "}
                          {lastRun ? (
                            <button
                              type="button"
                              className="text-link"
                              title="Open where it ran, or its terminal"
                              onClick={() => openTarget({ run: lastRun.id })}
                            >
                              {r.lastOccurrence}
                            </button>
                          ) : (
                            occurrenceLabel(r.lastOccurrence)
                          )}
                        </small>
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
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => setModal({ type: "routine", routine: r })}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                    <button
                      className="secondary routine-delete"
                      disabled={busy}
                      aria-label={`Delete ${r.name}`}
                      title="Delete routine"
                      onClick={() => setDeleteRoutineConfirm(r)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </article>
                  );
                })}
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
                : modal.type === "file"
                ? modal.preview.name
                : modal.type === "routine"
                  ? modal.routine
                    ? "Edit routine"
                    : "Create a routine"
                  : modal.type === "conversation-members"
                    ? "Manage conversation bots"
                    : modal.type === "project-settings"
                      ? "Edit project"
                      : modal.type === "slack"
                        ? `${modal.employee.name} on Slack`
                        : modal.type === "buzz"
                          ? `${modal.employee.name} on Buzz`
                        : "Create a project"
          }
          onClose={() => setModal(null)}
        >
          {error && (
            <p role="alert" className="banner error">
              {error}
            </p>
          )}
          {notice && modal.type === "file" && (
            <p role="status" className="banner">
              {notice}
            </p>
          )}
          {modal.type === "slack" ? (
            <SlackPanel employee={modal.employee} />
          ) : modal.type === "buzz" ? (
            <BuzzPanel employee={modal.employee} />
          ) : modal.type === "employee" ? (
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
          ) : modal.type === "file" ? (
            <FilePreview preview={modal.preview} name={modal.preview.name} fallback="Can't preview this file.">
              <p className="file-preview-path">
                {modal.preview.path}
                {Number.isFinite(modal.preview.size) ? ` · ${fileSize(modal.preview.size)}` : ""}
              </p>
              <FileActions preview={modal.preview} target={modal.target} />
            </FilePreview>
          ) : modal.type === "artifact" ? (
            <FilePreview
              preview={modal.preview}
              name={modal.artifact.name}
              fallback="This file is available in local storage. Open its folder to use it in your preferred application."
            >
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
            </FilePreview>
          ) : modal.type === "routine" ? (
            <RoutineForm
              data={data}
              busy={busy}
              routine={modal.routine || null}
              onSave={async (p) => {
                const saved = modal.routine
                  ? await act("routines.update", { ...p, id: modal.routine.id })
                  : await act("routines.create", p);
                if (saved) setModal(null);
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
      {deleteRoutineConfirm && (
        <Modal title="Delete routine" onClose={() => setDeleteRoutineConfirm(null)}>
          <div className="delete-confirm-content">
            <p>
              Delete the routine <strong>{deleteRoutineConfirm.name}</strong>?
            </p>
            <p className="delete-confirm-note">
              It stops repeating and its schedule history is removed. Work it already started finishes, and its past
              messages stay in the conversation. To stop it for a while instead, pause it.
            </p>
            <div className="delete-confirm-actions">
              <button className="secondary" onClick={() => setDeleteRoutineConfirm(null)}>
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (await act("routines.delete", { id: deleteRoutineConfirm.id })) setDeleteRoutineConfirm(null);
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
      {stopConfirm && (
        <Modal
          title={stopConfirm.kind === "update" ? "Restart to update?" : "Quit Any Bot?"}
          onClose={() => setStopConfirm(null)}
        >
          <div className="delete-confirm-content">
            <p>
              <strong>
                {stopConfirm.bots.length} bot{stopConfirm.bots.length === 1 ? " is" : "s are"} working
              </strong>
              : {stopConfirm.bots.join(", ")}.
            </p>
            <p className="delete-confirm-note">
              {stopConfirm.kind === "update"
                ? "Restarting now stops their work partway. Each conversation gets a note, and bots that handed that work off are told. Installing when they finish holds new work until the restart; queued work starts after it."
                : "Quitting stops their work partway. Each conversation gets a note, and bots that handed that work off are told. Queued work starts the next time Any Bot opens."}
            </p>
            <div className="delete-confirm-actions">
              <button className="secondary" onClick={() => setStopConfirm(null)}>
                Cancel
              </button>
              {stopConfirm.kind === "update" && (
                <button
                  className="primary"
                  onClick={() => {
                    setStopConfirm(null);
                    installUpdate("idle");
                  }}
                >
                  <Clock size={14} />
                  Install when they finish
                </button>
              )}
              <button
                className="danger"
                onClick={() => {
                  const kind = stopConfirm.kind;
                  setStopConfirm(null);
                  if (kind === "update") installUpdate("now");
                  else window.anybot.request("app.quit").catch((e) => setError(e.message));
                }}
              >
                <Square size={14} />
                {stopConfirm.kind === "update" ? "Stop and restart now" : "Stop and quit"}
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
    </ChatContext.Provider>
    </FileLinkContext.Provider>
    </AvatarActivityContext.Provider>
  );
}
