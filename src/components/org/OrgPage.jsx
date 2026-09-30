import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import {
  ArrowUpRight,
  CheckCheck,
  Inbox,
  Maximize,
  Minus,
  Network,
  Pin,
  PinOff,
  Plus,
  Settings2,
  SquareTerminal,
  Trash2,
  User,
  UserCheck,
  Waypoints,
  X,
} from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { Status } from "../Status.jsx";
import { renderMarkdownInline } from "../../lib/markdown.js";
import { KnowledgeGraph } from "./KnowledgeGraph.jsx";
import { PeopleTab } from "./PeopleTab.jsx";
import { layoutOrg, linkPath } from "../../lib/org-layout.js";
import { anchoredScroll, clampZoom, fitZoom, stepZoom, wheelZoom } from "../../lib/zoom.js";
import "./org.css";

const ACTIVE = ["queued", "running", "cancelling"];
const ago = (value) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
};

function OrgCard({ node, employee, stats, working, selected, onSelect, zoom = 1 }) {
  const isOwner = node.data.id === "owner";
  const drag = useDraggable({ id: node.data.id, disabled: isOwner });
  const drop = useDroppable({ id: node.data.id });
  const setRef = (element) => {
    drag.setNodeRef(element);
    drop.setNodeRef(element);
  };
  const style = {
    left: node.x,
    top: node.y,
    // dnd-kit moves in screen pixels; the stage is scaled by the zoom.
    transform: drag.transform ? `translate(${drag.transform.x / zoom}px, ${drag.transform.y / zoom}px)` : undefined,
  };
  return (
    <div
      ref={setRef}
      style={style}
      className={`org-card${isOwner ? " is-owner" : ""}${selected ? " is-selected" : ""}${drop.isOver && !drag.isDragging ? " is-drop" : ""}${drag.isDragging ? " is-dragging" : ""}${working ? " is-working" : ""}`}
      {...drag.attributes}
      {...drag.listeners}
      role="button"
      tabIndex={0}
      aria-label={isOwner ? "You, the owner" : `${employee.name}, ${employee.role}`}
      onClick={() => !isOwner && onSelect(employee.id)}
      onKeyDown={(event) => event.key === "Enter" && !isOwner && onSelect(employee.id)}
    >
      {isOwner ? (
        <>
          <span className="org-owner-mark">
            <User size={20} />
          </span>
          <div className="org-card-text">
            <strong>You</strong>
            <span>Owner</span>
          </div>
        </>
      ) : (
        <>
          <div className="org-card-top">
            <RobotAvatar size={80} employee={employee} working={working} />
            <div className="org-card-text">
              <strong>{employee.name}</strong>
              <span>{employee.role}</span>
            </div>
          </div>
          <div className="org-card-stats">
            {working ? <Status status="working" /> : <span className="org-idle">Idle</span>}
            <span title="Done in the last 7 days">
              <b>{stats?.done || 0}</b> done
            </span>
            <span title="In progress and in review">
              <b>{(stats?.inProgress || 0) + (stats?.review || 0)}</b> open
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function OrgChart({ employees, stats, runs, selected, onSelect, onReparent }) {
  const layout = useMemo(() => {
    const active = employees.filter((e) => !e.archived);
    const ids = new Set(active.map((e) => e.id));
    const childrenOf = (id) =>
      active
        .filter((e) => (id === "owner" ? !e.manager || !ids.has(e.manager) : e.manager === id))
        .map((e) => ({ id: e.id, children: childrenOf(e.id) }));
    // Teams without sub-teams stack in columns (src/lib/org-layout.js).
    return layoutOrg({ id: "owner", children: childrenOf("owner") });
  }, [employees]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const zoomer = useChartZoom(layout);
  const { zoom } = zoomer;
  const workingIds = new Set(runs.filter((r) => ACTIVE.includes(r.status)).map((r) => r.employee));
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        if (!over || over.id === active.id) return;
        onReparent(active.id, over.id === "owner" ? "" : over.id);
      }}
    >
      <div className="org-chart-wrap">
      <div
        className={`org-canvas${zoomer.panning ? " is-panning" : ""}`}
        ref={zoomer.canvas}
        tabIndex={0}
        aria-label="Organization chart. Ctrl and scroll to zoom, drag the background to move around."
        onKeyDown={zoomer.onKeyDown}
        onPointerDown={zoomer.onPointerDown}
      >
        <div className="org-zoom-box" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div
          className="org-stage"
          style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
        >
          <svg className="org-links" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.links.map((link) => (
              <path key={`${link.source.data.id}-${link.target.data.id}`} d={linkPath(link)} />
            ))}
          </svg>
          {layout.nodes.map((node) => (
            <OrgCard
              key={node.data.id}
              node={node}
              employee={employees.find((e) => e.id === node.data.id)}
              stats={stats[node.data.id]}
              working={workingIds.has(node.data.id)}
              selected={selected === node.data.id}
              onSelect={onSelect}
              zoom={zoom}
            />
          ))}
        </div>
        </div>
      </div>
      <div className="org-zoom-controls" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" title="Zoom out (Ctrl −)" onClick={() => zoomer.step(-1)}>
          <Minus size={15} />
        </button>
        <button type="button" className="org-zoom-level" title="Reset to 100% (Ctrl 0)" onClick={() => zoomer.set(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => zoomer.step(1)}>
          <Plus size={15} />
        </button>
        <button type="button" className="org-zoom-fit" title="Fit the whole org" onClick={zoomer.fit}>
          <Maximize size={14} />
          Fit
        </button>
      </div>
      </div>
    </DndContext>
  );
}

// Zoom and pan for the chart canvas. The zoom is remembered per window; the
// first time, the chart is fitted to the view. Buttons and keys zoom around
// the view's center, Ctrl + wheel (and trackpad pinch) around the pointer.
function useChartZoom(layout) {
  const canvas = useRef(null);
  const [zoom, setZoom] = useState(() => {
    try {
      const saved = localStorage.getItem("anybot-org-zoom");
      return saved ? clampZoom(saved) : null;
    } catch {
      return null;
    }
  });
  const [panning, setPanning] = useState(false);
  const anchor = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const size = () => {
    const el = canvas.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: 0, height: 0 };
  };
  const apply = (next, offset) => {
    const from = zoomRef.current || 1;
    const to = clampZoom(next);
    const el = canvas.current;
    if (el) anchor.current = { from, to, scroll: { left: el.scrollLeft, top: el.scrollTop }, offset: offset || { x: el.clientWidth / 2, y: el.clientHeight / 2 } };
    zoomRef.current = to;
    setZoom(to);
    try { localStorage.setItem("anybot-org-zoom", String(to)); } catch {}
  };
  const fit = () => {
    const to = fitZoom(layout, size());
    anchor.current = null;
    zoomRef.current = to;
    setZoom(to);
    try { localStorage.setItem("anybot-org-zoom", String(to)); } catch {}
    requestAnimationFrame(() => canvas.current?.scrollTo({ left: 0, top: 0 }));
  };
  // First visit: fit the whole org.
  useLayoutEffect(() => {
    if (zoom === null) setZoom(fitZoom(layout, size()));
  }, [zoom]);
  // Keep the anchored point still after the new zoom renders.
  useLayoutEffect(() => {
    const el = canvas.current;
    const pending = anchor.current;
    if (!el || !pending) return;
    anchor.current = null;
    const next = anchoredScroll(pending.scroll, pending.offset, pending.from, pending.to);
    el.scrollLeft = next.left;
    el.scrollTop = next.top;
  }, [zoom]);
  // Ctrl + wheel zooms (a trackpad pinch arrives as one); needs a
  // non-passive listener to stop the page zooming instead.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = el.getBoundingClientRect();
      apply(wheelZoom(zoomRef.current || 1, event.deltaY), { x: event.clientX - box.left, y: event.clientY - box.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const onKeyDown = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === "=" || event.key === "+") apply(stepZoom(zoomRef.current || 1, 1));
    else if (event.key === "-") apply(stepZoom(zoomRef.current || 1, -1));
    else if (event.key === "0") apply(1);
    else return;
    event.preventDefault();
  };
  // Drag the empty background to move around (cards keep their own drag).
  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest(".org-card")) return;
    const el = canvas.current;
    const start = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    const move = (e) => {
      el.scrollLeft = start.left - (e.clientX - start.x);
      el.scrollTop = start.top - (e.clientY - start.y);
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    setPanning(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return {
    canvas,
    zoom: zoom || 1,
    panning,
    set: (value) => apply(value),
    step: (direction) => apply(stepZoom(zoomRef.current || 1, direction)),
    fit,
    onKeyDown,
    onPointerDown,
  };
}

function MemoryList({ employee }) {
  const [memories, setMemories] = useState([]);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState("private");
  const call = async (method, payload) => {
    const result = await window.anybot.request(method, { ...payload, employee: employee.id });
    setMemories(result.memories);
  };
  useEffect(() => {
    if (window.anybot) call("memory.list", {}).catch(() => {});
  }, [employee.id]);
  return (
    <section className="agent-section">
      <h4>
        Memory <span className="muted">{memories.length}</span>
      </h4>
      <ul className="memory-list">
        {memories.map((memory) => (
          <li key={memory.id} className={memory.pinned ? "is-pinned" : ""}>
            <p>{memory.body}</p>
            <div className="memory-meta">
              <span className={`memory-scope scope-${memory.scope}`}>{memory.scope}</span>
              <span>{memory.source === "agent" ? `saved by ${employee.name}` : "added by you"}</span>
              <span>{ago(memory.updated)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={memory.pinned ? "Unpin memory" : "Pin memory"}
                title={memory.pinned ? "Unpin" : "Pin: always recalled"}
                onClick={() => call("memory.update", { id: memory.id, pinned: !memory.pinned })}
              >
                {memory.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button type="button" className="icon-button" aria-label="Delete memory" onClick={() => call("memory.delete", { id: memory.id })}>
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
        {!memories.length && <li className="memory-empty">Nothing remembered yet. {employee.name} saves durable facts with memory actions; you can add some too.</li>}
      </ul>
      <form
        className="memory-add"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          await call("memory.create", { body: draft.trim(), scope });
          setDraft("");
        }}
      >
        <textarea
          aria-label={`Add a memory for ${employee.name}`}
          placeholder={`Something ${employee.name} should always know`}
          value={draft}
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div>
          <select aria-label="Memory scope" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="private">Private (and their managers)</option>
            <option value="team">Whole team</option>
          </select>
          <button type="submit" className="secondary" disabled={!draft.trim()}>
            <Plus size={14} />
            Remember
          </button>
        </div>
      </form>
    </section>
  );
}

// A report's link: the run it came from (its thread or terminal), else its task.
const reportTarget = (report, data) =>
  report.run && data.runs.some((r) => r.id === report.run)
    ? { run: report.run }
    : report.task && data.tasks.some((t) => t.id === report.task)
      ? { task: report.task }
      : null;

function AgentPanel({ employee, data, reports, act, onClose, onMessage, onEdit, onSelect, onOpenTarget, onOpenRun }) {
  const manager = data.employees.find((e) => e.id === employee.manager);
  const direct = data.employees.filter((e) => e.manager === employee.id && !e.archived);
  const running = data.runs.filter((r) => r.employee === employee.id && ACTIVE.includes(r.status));
  const done = data.tasks
    .filter((t) => t.status === "done" && t.assignees.includes(employee.id))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 5);
  const sent = reports.filter((r) => r.fromEmployee === employee.id).slice(0, 5);
  const invalid = (candidate) => {
    for (let current = candidate, hops = 0; current && hops < 50; current = data.employees.find((e) => e.id === current)?.manager, hops++)
      if (current === employee.id) return true;
    return false;
  };
  return (
    <aside className="task-peek agent-panel" aria-label={`${employee.name} details`}>
      <header className="task-peek-head">
        <span className="task-id">{employee.id.slice(0, 8)}</span>
        <div className="task-peek-head-actions">
          <button type="button" className="icon-button" aria-label={`Edit ${employee.name}`} title="Edit employee" onClick={onEdit}>
            <Settings2 size={15} />
          </button>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="task-peek-body">
        <div className="agent-hero">
          <RobotAvatar size={108} employee={employee} working={running.length > 0} />
          <div>
            <h2>{employee.name}</h2>
            <p>{employee.role}</p>
          </div>
        </div>
        <div className="task-peek-actions">
          <button type="button" className="primary" onClick={onMessage}>
            Message
            <ArrowUpRight size={14} />
          </button>
        </div>
        <dl className="task-props">
          <dt>Reports to</dt>
          <dd>
            <select
              aria-label="Reports to"
              value={employee.manager || ""}
              onChange={(event) => act("employees.setManager", { id: employee.id, manager: event.target.value })}
            >
              <option value="">You (the owner)</option>
              {data.employees
                .filter((e) => !e.archived && e.id !== employee.id && !invalid(e.id))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </dd>
          <dt>Direct reports</dt>
          <dd>
            <div className="agent-reports">
              {direct.map((person) => (
                <button type="button" key={person.id} className="person-chip" onClick={() => onSelect(person.id)}>
                  <RobotAvatar small employee={person} />
                  {person.name}
                </button>
              ))}
              {!direct.length && <span className="muted">None</span>}
            </div>
          </dd>
          <dt>Working on</dt>
          <dd>
            {running.length ? (
              running.map((run) => {
                const task = data.tasks.find((t) => t.id === run.task);
                const project = data.conversations.find((c) => c.id === run.conversation);
                return (
                  <span key={run.id} className="agent-now">
                    <Status status={run.status === "running" ? "working" : run.status} />
                    {onOpenTarget ? (
                      <button type="button" className="text-link" title="Open where this work is" onClick={() => onOpenTarget({ run: run.id })}>
                        {task ? task.title : project?.title || "Direct work"}
                      </button>
                    ) : task ? (
                      task.title
                    ) : (
                      project?.title
                    )}
                    {onOpenRun && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Watch ${employee.name}'s terminal`}
                        title="Watch the terminal"
                        onClick={() => onOpenRun(run.id)}
                      >
                        <SquareTerminal size={14} />
                      </button>
                    )}
                  </span>
                );
              })
            ) : (
              <span className="muted">Nothing right now</span>
            )}
          </dd>
        </dl>
        <section className="agent-section">
          <h4>Recently finished</h4>
          <ul className="agent-done">
            {done.map((task) => (
              <li key={task.id}>
                <CheckCheck size={14} />
                {onOpenTarget ? (
                  <button type="button" className="text-link" title="Open it on its board" onClick={() => onOpenTarget({ task: task.id })}>
                    {task.title}
                  </button>
                ) : (
                  <span>{task.title}</span>
                )}
                <time>{ago(task.updated)}</time>
              </li>
            ))}
            {sent.map((report) => {
              const target = onOpenTarget && reportTarget(report, data);
              return (
                <li key={report.id} className="is-report">
                  <Inbox size={14} />
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdownInline(report.summary.slice(0, 220)) }} />
                  {target && (
                    <button type="button" className="icon-button" aria-label="Open where this was done" title="Open where this was done" onClick={() => onOpenTarget(target)}>
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                  <time>{ago(report.created)}</time>
                </li>
              );
            })}
            {!done.length && !sent.length && <li className="muted">No finished work yet.</li>}
          </ul>
          {manager && <p className="agent-footnote">Finished work is reported to {manager.name}.</p>}
        </section>
        <MemoryList employee={employee} />
      </div>
    </aside>
  );
}

function ReportsFeed({ reports, data, act, onOpenTarget, onSelectBot }) {
  const [scope, setScope] = useState("owner");
  const visible = reports.filter((r) => scope === "all" || r.toEmployee === "");
  const unread = visible.filter((r) => !r.read && r.toEmployee === "");
  const name = (id) => (id ? data.employees.find((e) => e.id === id)?.name || "Former employee" : "You");
  return (
    <div className="reports-feed">
      <div className="reports-toolbar">
        <div className="segmented" role="tablist" aria-label="Reports shown">
          <button role="tab" aria-selected={scope === "owner"} className={scope === "owner" ? "active" : ""} onClick={() => setScope("owner")}>
            To you
          </button>
          <button role="tab" aria-selected={scope === "all"} className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>
            Whole org
          </button>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!unread.length}
          onClick={() => act("reports.markRead", { ids: unread.map((r) => r.id) })}
        >
          <CheckCheck size={14} />
          Mark all read
        </button>
      </div>
      {!visible.length && (
        <div className="reports-empty">
          <Inbox size={22} />
          <p>
            When bots that report to you finish task or delegated work, their summaries land here. Managers read
            their own team's reports at the start of their next run.
          </p>
        </div>
      )}
      <ol className="reports-list">
        {visible.map((report) => {
          const from = data.employees.find((e) => e.id === report.fromEmployee);
          const task = data.tasks.find((t) => t.id === report.task);
          const target = onOpenTarget && reportTarget(report, data);
          return (
            <li key={report.id} className={!report.read && report.toEmployee === "" ? "is-unread" : ""}>
              <RobotAvatar small employee={from} />
              <div>
                <p className="report-head">
                  {from && !from.archived && onSelectBot ? (
                    <button type="button" className="text-link" title={`See ${from.name} in the org chart`} onClick={() => onSelectBot(from.id)}>
                      <strong>{from.name}</strong>
                    </button>
                  ) : (
                    <strong>{from?.name || "Former employee"}</strong>
                  )}
                  <span>to {name(report.toEmployee)}</span>
                  {task &&
                    (onOpenTarget ? (
                      <button type="button" className="task-label" title="Open it on its board" onClick={() => onOpenTarget({ task: task.id })}>
                        {task.title}
                      </button>
                    ) : (
                      <span className="task-label">{task.title}</span>
                    ))}
                  <time>{ago(report.created)}</time>
                  {target && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Open where this was done"
                      title="Open where this was done"
                      onClick={() => {
                        if (!report.read && report.toEmployee === "") act("reports.markRead", { ids: [report.id] });
                        onOpenTarget(target);
                      }}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                </p>
                <p className="report-body" dangerouslySetInnerHTML={{ __html: renderMarkdownInline(report.summary) }} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// `selected`/`onSelect` let App open a bot's panel (the roster's names);
// without them the page keeps its own. onOpenTarget, onOpenRun,
// onOpenArtifact and onRevealArtifact link work to where it happened.
export function OrgPage({
  data,
  act,
  onMessage,
  onEdit,
  tab,
  onTab,
  selected: chosen,
  onSelect,
  onOpenTarget,
  onOpenRun,
  onOpenArtifact,
  onRevealArtifact,
}) {
  const [org, setOrg] = useState({ stats: {}, reports: [] });
  const [own, setOwn] = useState(null);
  const selected = onSelect ? chosen : own;
  const setSelected = onSelect || setOwn;
  const refreshKey = `${data.runs.length}:${data.tasks.map((t) => t.updated).join()}:${data.reportsUnread}:${data.employees.map((e) => e.manager).join()}`;
  useEffect(() => {
    if (!window.anybot) return;
    window.anybot.request("org.get").then(setOrg).catch(() => {});
  }, [refreshKey]);
  const employee = data.employees.find((e) => e.id === selected);
  const active = data.employees.filter((e) => !e.archived);
  return (
    <div className="org-page">
      <div className="org-main">
        <header className="org-heading">
          <div>
            <h1>Organization</h1>
            <p>Who reports to whom, what they've finished, what they remember, and what they know.</p>
          </div>
        </header>
        <div className="project-tabs org-tabs" role="tablist" aria-label="Organization views">
          <button role="tab" aria-selected={tab === "chart"} className={tab === "chart" ? "active" : ""} onClick={() => onTab("chart")}>
            <Network size={15} />
            Org chart
          </button>
          <button role="tab" aria-selected={tab === "graph"} className={tab === "graph" ? "active" : ""} onClick={() => onTab("graph")}>
            <Waypoints size={15} />
            Knowledge graph
          </button>
          <button role="tab" aria-selected={tab === "reports"} className={tab === "reports" ? "active" : ""} onClick={() => onTab("reports")}>
            <Inbox size={15} />
            Reports
            {data.reportsUnread > 0 && <span className="project-tab-count live">{data.reportsUnread}</span>}
          </button>
          <button role="tab" aria-selected={tab === "people"} className={tab === "people" ? "active" : ""} onClick={() => onTab("people")}>
            <UserCheck size={15} />
            People
          </button>
        </div>
        {tab === "chart" &&
          (active.length ? (
            <>
              <p className="org-hint">Drag a bot onto its new manager. Drop on You to report to you directly.</p>
              <OrgChart
                employees={data.employees}
                stats={org.stats}
                runs={data.runs}
                selected={selected}
                onSelect={setSelected}
                onReparent={(id, manager) => act("employees.setManager", { id, manager })}
              />
            </>
          ) : (
            <div className="reports-empty">
              <Network size={22} />
              <p>Create a few bots first. Then arrange who reports to whom here.</p>
            </div>
          ))}
        {tab === "reports" && (
          <ReportsFeed
            reports={org.reports}
            data={data}
            act={act}
            onOpenTarget={onOpenTarget}
            onSelectBot={(id) => {
              setSelected(id);
              onTab("chart");
            }}
          />
        )}
        {tab === "graph" && (
          <KnowledgeGraph
            data={data}
            act={act}
            onMessage={onMessage}
            onOpenTarget={onOpenTarget}
            onOpenArtifact={onOpenArtifact}
            onRevealArtifact={onRevealArtifact}
          />
        )}
        {tab === "people" && <PeopleTab data={data} selected={selected} onSelect={setSelected} />}
      </div>
      {employee && (tab === "chart" || tab === "people") && (
        <AgentPanel
          employee={employee}
          data={data}
          reports={org.reports}
          act={act}
          onClose={() => setSelected(null)}
          onMessage={() => onMessage(employee)}
          onEdit={() => onEdit(employee)}
          onSelect={setSelected}
          onOpenTarget={onOpenTarget}
          onOpenRun={onOpenRun}
        />
      )}
    </div>
  );
}
