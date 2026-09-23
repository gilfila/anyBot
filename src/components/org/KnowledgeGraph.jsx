import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import {
  ArrowUpRight,
  Crosshair,
  Maximize2,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  Rows3,
  Search,
  Send,
  Trash2,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { statusLabel } from "../board/meta.js";
import "./knowledge.css";

// Node kinds. Workspace kinds carry a categorical color; everything bots or
// the owner write is neutral ink and told apart by its ring shape.
const KINDS = {
  agent: { label: "Bots", one: "Bot", size: 11 },
  project: { label: "Projects", one: "Project", size: 11 },
  task: { label: "Tasks", one: "Task", size: 8 },
  artifact: { label: "Files", one: "File", size: 6.5 },
  written: { label: "Written", one: "Entity", size: 9 },
};
const FILTERS = ["agent", "project", "task", "artifact", "written"];
const ENTITY_TYPES = ["concept", "decision", "person", "customer", "tool", "risk", "goal"];
const kindOf = (node) => (node.source === "auto" ? node.type : "written");
const sizeOf = (node) => KINDS[kindOf(node)].size;
const typeName = (node) =>
  node.source === "auto" ? KINDS[node.type].one : node.type.charAt(0).toUpperCase() + node.type.slice(1);
const relationText = (relation) => relation.replace(/_/g, " ");
const short = (text, max = 28) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const ago = (value) => {
  if (!value) return "";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};
const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};
const stillMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const readView = () => {
  try {
    return localStorage.getItem("anybot-graph-view") === "table" ? "table" : "graph";
  } catch {
    return "graph";
  }
};

export function Shape({ node, kind = kindOf(node), r = sizeOf(node) }) {
  if (kind === "project") return <rect className="kg-shape" x={-r} y={-r} width={r * 2} height={r * 2} rx={3} />;
  if (kind === "task")
    return <rect className="kg-shape" x={-r * 0.78} y={-r * 0.78} width={r * 1.56} height={r * 1.56} rx={1.5} transform="rotate(45)" />;
  if (kind === "artifact")
    return <path className="kg-shape" d={`M${-r} ${-r * 1.2}h${r * 1.1}l${r * 0.9} ${r * 0.9}v${r * 1.5}h${-r * 2}z`} />;
  return <circle className="kg-shape" r={r} />;
}

function Swatch({ kind }) {
  return (
    <svg className={`kg-swatch kg-${kind}`} width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
      <Shape node={{ source: kind === "written" ? "agent" : "auto", type: kind }} kind={kind} r={kind === "artifact" ? 4.5 : 5} />
    </svg>
  );
}

// Force layout in SVG. Positions persist across refreshes so the graph does
// not reshuffle every time a bot adds a fact.
const GraphCanvas = memo(function GraphCanvas({ graph, seeds, selected, onSelect, onFocus }) {
  const wrap = useRef(null);
  const svg = useRef(null);
  const size = useRef({ width: 800, height: 560 });
  const [, setSize] = useState(size.current);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hover, setHover] = useState(null);
  const [, setFrame] = useState(0);
  const positions = useRef(new Map());
  const sim = useRef(null);
  const gesture = useRef(null);
  const lastCount = useRef(0);

  const fit = () => {
    const nodes = sim.current ? [...sim.current.byId.values()] : [];
    if (!nodes.length) return;
    const { width, height } = size.current;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 150;
    const maxX = Math.max(...xs) + 150;
    const minY = Math.min(...ys) - 50;
    const maxY = Math.max(...ys) + 50;
    const k = Math.max(0.3, Math.min(1.2, Math.min(width / (maxX - minX), height / (maxY - minY))));
    setView({ k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k });
  };

  useEffect(() => {
    const element = wrap.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      size.current = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize(size.current);
    });
    observer.observe(element);
    // Wheel zoom around the cursor; a native listener so it can preventDefault.
    const wheel = (event) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const current = viewRef.current;
      const k = Math.max(0.25, Math.min(3, current.k * Math.exp(-event.deltaY * 0.0015)));
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      const wx = (cx - current.x) / current.k;
      const wy = (cy - current.y) / current.k;
      setView({ k, x: cx - wx * k, y: cy - wy * k });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, []);

  const key = useMemo(
    () => `${graph.nodes.map((n) => n.id).join()}|${graph.edges.map((e) => e.id).join()}`,
    [graph],
  );
  useEffect(() => {
    const known = positions.current;
    const byId = new Map();
    const nodes = graph.nodes.map((node) => {
      const kept = known.get(node.id);
      const item = { id: node.id, node, x: kept?.x, y: kept?.y };
      byId.set(node.id, item);
      return item;
    });
    // New nodes start beside a placed neighbor, or on a ring seeded by id,
    // so the same graph always lays out the same way.
    let fresh = 0;
    for (const item of nodes) {
      if (item.x !== undefined) continue;
      fresh++;
      const h = hash(item.id);
      const edge = graph.edges.find(
        (e) =>
          (e.src === item.id && byId.get(e.dst)?.x !== undefined) ||
          (e.dst === item.id && byId.get(e.src)?.x !== undefined),
      );
      const anchor = edge && byId.get(edge.src === item.id ? edge.dst : edge.src);
      const angle = ((h % 360) * Math.PI) / 180;
      const radius = anchor ? 36 : 90 + (h % 220);
      item.x = (anchor?.x ?? 0) + Math.cos(angle) * radius;
      item.y = (anchor?.y ?? 0) + Math.sin(angle) * radius;
    }
    const links = graph.edges.map((e) => ({ source: e.src, target: e.dst, written: e.source !== "auto" }));
    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink(links)
          .id((d) => d.id)
          .distance((l) =>
            l.written ? 110 : kindOf(l.source.node) === "artifact" || kindOf(l.target.node) === "artifact" ? 40 : 80,
          )
          .strength((l) => (l.written ? 0.45 : 0.3)),
      )
      .force("charge", forceManyBody().strength((d) => (kindOf(d.node) === "artifact" ? -50 : -280)).distanceMax(560))
      // Labels sit to the right of each mark, so give longer names more room.
      .force(
        "collide",
        forceCollide((d) =>
          kindOf(d.node) === "artifact" ? sizeOf(d.node) + 6 : sizeOf(d.node) + 8 + Math.min(d.node.label.length, 28) * 1.7,
        ).strength(0.8),
      )
      // Pull harder vertically so the layout fills a landscape canvas.
      .force("x", forceX(0).strength(0.03))
      .force("y", forceY(0).strength(0.08))
      .stop();
    const still = stillMotion();
    const everything = fresh === nodes.length;
    simulation.alpha(everything ? 1 : fresh ? 0.5 : 0.08);
    // Settle most of the layout up front; let the tail animate unless the
    // viewer prefers reduced motion.
    const pre = still ? 320 : everything ? 160 : 40;
    for (let i = 0; i < pre; i++) simulation.tick();
    simulation.alphaDecay(0.045);
    const save = () => {
      for (const item of nodes) known.set(item.id, { x: item.x, y: item.y });
    };
    save();
    sim.current = { simulation, byId };
    simulation.on("tick", () => {
      save();
      setFrame((f) => f + 1);
    });
    if (!still && simulation.alpha() > simulation.alphaMin()) simulation.restart();
    if (everything || Math.abs(lastCount.current - nodes.length) > 3) fit();
    lastCount.current = nodes.length;
    setFrame((f) => f + 1);
    return () => simulation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Keep the selected node on screen when the side panel narrows the canvas.
  const { width: stageWidth, height: stageHeight } = size.current;
  useEffect(() => {
    const item = selected && sim.current?.byId.get(selected);
    if (!item) return;
    const x = stageWidth / 2 + view.x + item.x * view.k;
    const y = stageHeight / 2 + view.y + item.y * view.k;
    if (x < 40 || x > stageWidth - 160 || y < 30 || y > stageHeight - 60)
      setView((v) => ({ ...v, x: -item.x * v.k, y: -item.y * v.k }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, stageWidth, stageHeight]);

  const current = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const seedSet = useMemo(() => new Set(seeds), [seeds]);
  const active = hover ?? selected;
  const neighbors = useMemo(() => {
    const set = new Set();
    if (!active) return set;
    for (const edge of graph.edges) {
      if (edge.src === active) set.add(edge.dst);
      if (edge.dst === active) set.add(edge.src);
    }
    return set;
  }, [graph, active]);
  const degree = useMemo(() => {
    const counts = new Map();
    for (const edge of graph.edges) {
      counts.set(edge.src, (counts.get(edge.src) || 0) + 1);
      counts.set(edge.dst, (counts.get(edge.dst) || 0) + 1);
    }
    return counts;
  }, [graph]);
  const writtenCount = graph.edges.filter((e) => e.source !== "auto").length;
  const crowded = graph.nodes.length > 90;
  const items = sim.current ? [...sim.current.byId.values()] : [];
  // Labels point away from the middle so they run into open space.
  const middle = items.length ? items.reduce((sum, item) => sum + item.x, 0) / items.length : 0;

  const world = (event) => {
    const rect = wrap.current.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - rect.width / 2 - view.x) / view.k,
      y: (event.clientY - rect.top - rect.height / 2 - view.y) / view.k,
    };
  };
  const onPointerDown = (event, nodeId = null) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    svg.current.setPointerCapture(event.pointerId);
    gesture.current = { nodeId, x: event.clientX, y: event.clientY, view, moved: false };
  };
  const onPointerMove = (event) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    if (!g.nodeId) {
      setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
      return;
    }
    const item = sim.current?.byId.get(g.nodeId);
    if (!item) return;
    const point = world(event);
    item.fx = point.x;
    item.fy = point.y;
    if (stillMotion()) {
      item.x = point.x;
      item.y = point.y;
      positions.current.set(item.id, { x: item.x, y: item.y });
      setFrame((f) => f + 1);
    } else sim.current.simulation.alphaTarget(0.2).restart();
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.nodeId && g.moved) {
      const item = sim.current?.byId.get(g.nodeId);
      if (item) {
        item.fx = null;
        item.fy = null;
      }
      sim.current?.simulation.alphaTarget(0);
      return;
    }
    if (!g.moved) onSelect(g.nodeId);
  };
  const zoomBy = (factor) =>
    setView((v) => {
      const k = Math.max(0.25, Math.min(3, v.k * factor));
      return { k, x: (v.x / v.k) * k, y: (v.y / v.k) * k };
    });

  const { width, height } = size.current;
  const hovered = hover && sim.current?.byId.get(hover);
  const hoveredNode = hover && current.get(hover);
  return (
    <div className="kg-canvas" ref={wrap}>
      <svg
        ref={svg}
        width={width}
        height={height}
        className={active ? "has-focus" : ""}
        onPointerDown={(event) => onPointerDown(event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (gesture.current = null)}
        role="group"
        aria-label={`Knowledge graph with ${graph.nodes.length} things and ${graph.edges.length} links. The table view lists every fact.`}
      >
        <defs>
          {["agent", "owner", "hot"].map((kind) => (
            <marker key={kind} id={`kg-arrow-${kind}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0.5 L7.5 4 L0 7.5z" className={`kg-arrow kg-arrow-${kind}`} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${width / 2 + view.x} ${height / 2 + view.y}) scale(${view.k})`}>
          {graph.edges.map((edge) => {
            const a = sim.current?.byId.get(edge.src);
            const b = sim.current?.byId.get(edge.dst);
            if (!a || !b) return null;
            const hot = active && (edge.src === active || edge.dst === active);
            const dim = active && !hot;
            const written = edge.source !== "auto";
            const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const trim = sizeOf(b.node) + (written ? 4 : 1);
            const x2 = b.x - ((b.x - a.x) / length) * trim;
            const y2 = b.y - ((b.y - a.y) / length) * trim;
            const showLabel = written && (hot || (!active && writtenCount <= 40));
            return (
              <g key={edge.id} className={`kg-edge kg-edge-${edge.source}${hot ? " is-hot" : ""}${dim ? " is-dim" : ""}`}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={x2}
                  y2={y2}
                  markerEnd={written ? `url(#kg-arrow-${hot ? "hot" : edge.source})` : undefined}
                />
                {(showLabel || (hot && !written && selected === active)) && (
                  <text className="kg-edge-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle">
                    {short(relationText(edge.relation), 24)}
                  </text>
                )}
              </g>
            );
          })}
          {items.map((item) => {
            const node = current.get(item.id) || item.node;
            const kind = kindOf(node);
            const isActive = item.id === active;
            const near = neighbors.has(item.id);
            const dim = active && !isActive && !near && item.id !== selected;
            const labelled =
              !crowded || kind === "agent" || kind === "project" || kind === "written" || isActive || near || seedSet.has(item.id);
            return (
              <g
                key={item.id}
                className={`kg-node kg-${kind}${item.id === selected ? " is-selected" : ""}${seedSet.has(item.id) ? " is-match" : ""}${dim ? " is-dim" : ""}${node.pinned ? " is-pinned" : ""}`}
                transform={`translate(${item.x} ${item.y})`}
                tabIndex={0}
                role="button"
                aria-label={`${typeName(node)}: ${node.label}`}
                onPointerDown={(event) => onPointerDown(event, item.id)}
                onPointerEnter={() => setHover(item.id)}
                onPointerLeave={() => setHover((h) => (h === item.id ? null : h))}
                onDoubleClick={() => onFocus(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(item.id);
                  }
                }}
              >
                <circle className="kg-halo" r={sizeOf(node) + 5} />
                <circle className="kg-hit" r={Math.max(14, sizeOf(node) + 4)} />
                <Shape node={node} />
                {node.pinned && <circle className="kg-pin" cx={sizeOf(node) * 0.8} cy={-sizeOf(node) * 0.8} r={2.6} />}
                {labelled && (
                  <text
                    className="kg-label"
                    x={item.x < middle - 20 ? -(sizeOf(node) + 6) : sizeOf(node) + 6}
                    y={4}
                    textAnchor={item.x < middle - 20 ? "end" : "start"}
                  >
                    {short(node.label)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hovered && hoveredNode && !gesture.current && (
        <div
          className="kg-tooltip"
          style={{
            left: Math.min(width - 220, width / 2 + view.x + hovered.x * view.k + 16),
            top: Math.max(8, height / 2 + view.y + hovered.y * view.k - 18),
          }}
        >
          <strong>{hoveredNode.label}</strong>
          <span>
            {typeName(hoveredNode)} · {degree.get(hover) || 0} {degree.get(hover) === 1 ? "link" : "links"}
            {hoveredNode.source === "agent" ? " · bot-written" : ""}
          </span>
        </div>
      )}
      <div className="kg-edge-legend" aria-label="Link styles">
        <span>
          <svg width="26" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="25" y2="4" className="kg-legend-auto" />
          </svg>
          From your workspace
        </span>
        <span>
          <svg width="26" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="25" y2="4" className="kg-legend-owner" />
          </svg>
          Added by you
        </span>
        <span>
          <svg width="26" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="25" y2="4" className="kg-legend-agent" />
          </svg>
          Added by a bot (unverified)
        </span>
      </div>
      <div className="kg-zoom">
        <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.25)}>
          <ZoomIn size={15} />
        </button>
        <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(0.8)}>
          <ZoomOut size={15} />
        </button>
        <button type="button" className="icon-button" aria-label="Fit graph to view" title="Fit to view" onClick={fit}>
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
});

// Endpoint for graph.fact: an existing node by exact name, else a new thing.
const endpoint = (value, nodes, type) => {
  const label = value.trim();
  const hit = nodes.find((n) => n.label.toLowerCase() === label.toLowerCase());
  return hit ? { id: hit.id } : type ? { label, type } : label;
};

function FactForm({ subject, nodes, act, onDone }) {
  const [form, setForm] = useState({ subject: "", relation: "", object: "", note: "", type: "concept" });
  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const ready = (subject || form.subject.trim()) && form.relation.trim() && form.object.trim();
  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    const saved = await act("graph.fact", {
      subject: subject ? { id: subject.id } : endpoint(form.subject, nodes, form.type),
      relation: form.relation,
      object: endpoint(form.object, nodes, form.type),
      note: form.note.trim() || undefined,
    });
    if (saved) {
      setForm((f) => ({ ...f, subject: "", relation: "", object: "", note: "" }));
      onDone?.();
    }
  };
  return (
    <form className="kg-form" onSubmit={submit}>
      <datalist id="kg-names">
        {nodes.slice(0, 300).map((n) => (
          <option key={n.id} value={n.label} />
        ))}
      </datalist>
      {!subject && (
        <label>
          Subject
          <input list="kg-names" value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Checkout redesign" maxLength={120} />
        </label>
      )}
      <label>
        Relation
        <input value={form.relation} onChange={(e) => set("relation", e.target.value)} placeholder="depends on" maxLength={60} />
      </label>
      <label>
        Object
        <input list="kg-names" value={form.object} onChange={(e) => set("object", e.target.value)} placeholder="Stripe API v3" maxLength={120} />
      </label>
      <label>
        Note <span className="muted">optional</span>
        <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Why this is true, or where it came from" maxLength={600} />
      </label>
      <div className="kg-form-row">
        <label className="kg-inline">
          New things are
          <select value={form.type} onChange={(e) => set("type", e.target.value)} aria-label="Type for new things">
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary" disabled={!ready}>
          <Plus size={14} />
          Add fact
        </button>
      </div>
    </form>
  );
}

function FactRow({ edge, node, byId, who, act, onSelect, reload }) {
  const outgoing = edge.src === node.id;
  const other = byId.get(outgoing ? edge.dst : edge.src);
  if (!other) return null;
  const written = edge.source !== "auto";
  const otherButton = (
    <button type="button" className="kg-link" onClick={() => onSelect(other.id)}>
      <Swatch kind={kindOf(other)} />
      {other.label}
    </button>
  );
  const change = async (method, payload) => (await act(method, payload)) && reload();
  return (
    <li className={`kg-fact${edge.pinned ? " is-pinned" : ""}`}>
      <p>
        {outgoing ? (
          <>
            <em>{relationText(edge.relation)}</em> {otherButton}
          </>
        ) : (
          <>
            {otherButton} <em>{relationText(edge.relation)}</em> this
          </>
        )}
      </p>
      {edge.note && <p className="kg-fact-note">{edge.note}</p>}
      <div className="kg-fact-meta">
        <span className={`kg-source kg-source-${edge.source}`}>{written ? who(edge.createdBy) : "workspace"}</span>
        {written && <time>{ago(edge.updated || edge.created)}</time>}
        {written && (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label={edge.pinned ? "Unpin fact" : "Pin fact"}
              title={edge.pinned ? "Unpin: recall only when relevant" : "Pin: vouch for this fact and recall it in every bot's prompt"}
              onClick={() => change("graph.edgeUpdate", { id: edge.id, pinned: !edge.pinned })}
            >
              {edge.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
            <button type="button" className="icon-button" aria-label="Delete fact" title="Delete fact" onClick={() => change("graph.edgeDelete", { id: edge.id })}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function NodePanel({ node, graph, data, who, act, onSelect, onFocus, onClose, onMessage, reload }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [note, setNote] = useState(node.note || "");
  useEffect(() => {
    setLabel(node.label);
    setNote(node.note || "");
    setConfirmDelete(false);
  }, [node.id, node.label, node.note]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const facts = graph.edges
    .filter((e) => e.src === node.id || e.dst === node.id)
    .sort((a, b) => (b.pinned === true) - (a.pinned === true) || (a.source === "auto") - (b.source === "auto"));
  const written = node.source !== "auto";
  const employee = node.type === "agent" && data.employees.find((e) => e.id === node.ref);
  const working = employee && data.runs.some((r) => r.employee === employee.id && ["queued", "running", "cancelling"].includes(r.status));
  const project = node.conversation && data.conversations.find((c) => c.id === node.conversation);
  const update = async (payload) => (await act("graph.entityUpdate", { id: node.id, ...payload })) && reload();
  return (
    <aside className="task-peek kg-panel" aria-label={`${node.label} details`}>
      <header className="task-peek-head">
        <span className={`kg-kind kg-${kindOf(node)}`}>
          <Swatch kind={kindOf(node)} />
          {typeName(node)}
        </span>
        <div className="task-peek-head-actions">
          {written &&
            (confirmDelete ? (
              <>
                <span className="muted">Delete it and its facts?</span>
                <button type="button" className="danger" onClick={async () => (await act("graph.entityDelete", { id: node.id })) && (reload(), onClose())}>
                  Delete
                </button>
                <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="icon-button" aria-label="Delete" title="Delete" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
              </button>
            ))}
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="task-peek-body">
        {employee ? (
          <div className="agent-hero">
            <RobotAvatar size={88} employee={employee} working={working} />
            <div>
              <h2>{employee.name}</h2>
              <p>{employee.role}</p>
            </div>
          </div>
        ) : written ? (
          <input
            className="task-peek-title"
            aria-label="Name"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() && label.trim() !== node.label && update({ label: label.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        ) : (
          <h2 className="kg-title">{node.label}</h2>
        )}
        <div className="task-peek-actions">
          <button type="button" className="secondary" onClick={() => onFocus(node.id)}>
            <Crosshair size={14} />
            Show neighborhood
          </button>
          {employee && (
            <button type="button" className="primary" onClick={() => onMessage(employee)}>
              Message
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
        <dl className="task-props">
          {written ? (
            <>
              <dt>Type</dt>
              <dd>
                <select aria-label="Type" value={node.type} onChange={(e) => update({ type: e.target.value })}>
                  {[...new Set([node.type, ...ENTITY_TYPES])].map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>Added by</dt>
              <dd>
                <span className={`kg-source kg-source-${node.source}`}>{who(node.createdBy)}</span>{" "}
                <span className="muted">{ago(node.created)}</span>
              </dd>
              <dt>Recall</dt>
              <dd>
                <button
                  type="button"
                  className="kg-toggle"
                  aria-pressed={node.pinned}
                  title={node.pinned ? "Its facts go into every bot's prompt" : "Its facts are recalled when a prompt mentions them"}
                  onClick={() => update({ pinned: !node.pinned })}
                >
                  {node.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                  {node.pinned ? "Every prompt" : "When relevant"}
                </button>
              </dd>
            </>
          ) : (
            <>
              <dt>Source</dt>
              <dd className="muted">Your workspace</dd>
              {node.type === "task" && (
                <>
                  <dt>Status</dt>
                  <dd>{statusLabel(node.note)}</dd>
                </>
              )}
              {project && (
                <>
                  <dt>Project</dt>
                  <dd>{project.title}</dd>
                </>
              )}
            </>
          )}
        </dl>
        {written && (
          <textarea
            className="kg-note"
            aria-label="Note"
            placeholder="Add a note"
            value={note}
            maxLength={600}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (node.note || "") && update({ note })}
          />
        )}
        {node.source === "agent" && (
          <p className="kg-caution">Written by a bot. Other bots see its facts marked as bot-written until you pin a fact to vouch for it.</p>
        )}
        <section className="agent-section">
          <h4>
            Facts <span className="muted">{facts.length}</span>
          </h4>
          {facts.length ? (
            <ul className="kg-facts">
              {facts.map((edge) => (
                <FactRow key={edge.id} edge={edge} node={node} byId={byId} who={who} act={act} onSelect={onSelect} reload={reload} />
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing links here yet.</p>
          )}
        </section>
        <section className="agent-section">
          <h4>Add a fact about {short(node.label, 22)}</h4>
          <FactForm subject={node} nodes={graph.nodes} act={act} onDone={reload} />
        </section>
      </div>
    </aside>
  );
}

function SidePanel({ title, onClose, children }) {
  return (
    <aside className="task-peek kg-panel" aria-label={title}>
      <header className="task-peek-head">
        <strong className="kg-panel-title">{title}</strong>
        <div className="task-peek-head-actions">
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="task-peek-body">{children}</div>
    </aside>
  );
}

function AskForm({ data, act, onAsked }) {
  const bots = data.employees.filter((e) => !e.archived);
  const [employee, setEmployee] = useState(bots[0]?.id || "");
  const [question, setQuestion] = useState("");
  const name = bots.find((e) => e.id === employee)?.name || "a bot";
  const submit = async (event) => {
    event.preventDefault();
    if (!employee || !question.trim()) return;
    if (await act("graph.ask", { employee, question: question.trim() })) onAsked(employee);
  };
  if (!bots.length) return <p className="muted">Hire a bot first.</p>;
  return (
    <form className="kg-form" onSubmit={submit}>
      <p className="kg-help">
        Your question and the facts that match it go to {name} as a direct message. The answer shows up in that chat.
      </p>
      <label>
        Question
        <textarea
          value={question}
          maxLength={2000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit(e)}
          placeholder="What is blocking the checkout launch?"
        />
      </label>
      <div className="kg-form-row">
        <label className="kg-inline">
          Ask
          <select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="Bot to ask">
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary" disabled={!question.trim()}>
          <Send size={14} />
          Ask {short(name, 16)}
        </button>
      </div>
    </form>
  );
}

function FactsTable({ graph, who, onSelect, selected }) {
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const rows = [...graph.edges].sort(
    (a, b) =>
      (b.pinned === true) - (a.pinned === true) ||
      (a.source === "auto") - (b.source === "auto") ||
      String(b.updated || "").localeCompare(String(a.updated || "")),
  );
  const cell = (nodeId) => {
    const node = byId.get(nodeId);
    return (
      <button type="button" className={`kg-link${nodeId === selected ? " is-selected" : ""}`} onClick={() => onSelect(nodeId)}>
        <Swatch kind={kindOf(node)} />
        {node.label}
      </button>
    );
  };
  if (!rows.length) return <p className="kg-table-empty">Nothing links these things yet.</p>;
  return (
    <div className="kg-table-wrap">
      <table className="kg-table">
        <thead>
          <tr>
            <th scope="col">Subject</th>
            <th scope="col">Relation</th>
            <th scope="col">Object</th>
            <th scope="col">Source</th>
            <th scope="col">Added</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((edge) => (
            <tr key={edge.id} className={edge.pinned ? "is-pinned" : ""}>
              <td>{cell(edge.src)}</td>
              <td>
                <em>{relationText(edge.relation)}</em>
                {edge.note && <span className="kg-table-note">{edge.note}</span>}
              </td>
              <td>{cell(edge.dst)}</td>
              <td>
                <span className={`kg-source kg-source-${edge.source}`}>{edge.source === "auto" ? "workspace" : who(edge.createdBy)}</span>
                {edge.pinned && <Pin size={12} className="kg-table-pin" aria-label="Pinned" />}
              </td>
              <td className="kg-table-time">{edge.source === "auto" ? "" : ago(edge.updated || edge.created)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 && <p className="org-hint">Showing 500 of {rows.length} facts. Search to narrow.</p>}
    </div>
  );
}

export function KnowledgeGraph({ data, act, onMessage }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState(null);
  const [depth, setDepth] = useState(1);
  const [hidden, setHidden] = useState(() => new Set(["artifact"]));
  const [factsOnly, setFactsOnly] = useState(false);
  const [mode, setMode] = useState(readView);
  const [selected, setSelected] = useState(null);
  const [panel, setPanel] = useState(null);
  const [graph, setGraph] = useState({ nodes: [], edges: [], seeds: [], truncated: false });
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [pendingChat, setPendingChat] = useState(null);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const lastRun = data.runs.reduce((latest, r) => (r.ended && r.ended > latest ? r.ended : latest), "");
  const refreshKey = `${lastRun}|${data.tasks.map((t) => t.updated).join()}|${data.employees
    .map((e) => `${e.name}${e.manager}${e.archived}`)
    .join()}|${data.conversations.map((c) => c.title).join()}`;
  useEffect(() => {
    if (!window.anybot) return undefined;
    let live = true;
    window.anybot
      .request("graph.get", focus ? { focus, depth } : search ? { q: search, depth } : {})
      .then((result) => {
        if (!live) return;
        setGraph(result);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [search, focus, depth, refreshKey, nonce]);

  // "Ask" hands off to the direct chat once the new message is in the snapshot.
  useEffect(() => {
    if (!pendingChat) return;
    const employee = data.employees.find((e) => e.id === pendingChat);
    const chat = data.conversations.find((c) => c.members.length === 1 && c.members[0] === pendingChat);
    if (employee && chat) {
      setPendingChat(null);
      onMessage(employee);
    }
  }, [pendingChat, data, onMessage]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(FILTERS.map((kind) => [kind, 0]));
    for (const node of graph.nodes) result[kindOf(node)]++;
    return result;
  }, [graph]);
  const visible = useMemo(() => {
    const seeds = new Set(graph.seeds);
    let edges = factsOnly ? graph.edges.filter((e) => e.source !== "auto") : graph.edges;
    let nodes = graph.nodes.filter((n) => !hidden.has(kindOf(n)) || seeds.has(n.id) || n.id === focus);
    if (factsOnly) {
      const touched = new Set(edges.flatMap((e) => [e.src, e.dst]));
      nodes = nodes.filter((n) => touched.has(n.id) || n.id === focus);
    }
    const ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.src) && ids.has(e.dst));
    return { nodes, edges };
  }, [graph, hidden, factsOnly, focus]);
  const node = selected && graph.nodes.find((n) => n.id === selected);
  useEffect(() => {
    if (selected && loaded && !graph.nodes.some((n) => n.id === selected)) setSelected(null);
  }, [graph, selected, loaded]);
  const focusNode = focus && graph.nodes.find((n) => n.id === focus);
  const names = useMemo(() => new Map(data.employees.map((e) => [e.id, e.name])), [data.employees]);
  const who = (author) => (author === "human" ? "you" : names.get(author) || "a former bot");
  const written = graph.edges.filter((e) => e.source !== "auto").length;

  const chooseMode = (next) => {
    setMode(next);
    try {
      localStorage.setItem("anybot-graph-view", next);
    } catch {
      // Private storage is a convenience only.
    }
  };
  const toggle = (kind) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const select = (nodeId) => {
    setSelected(nodeId);
    if (nodeId) setPanel(null);
  };
  const focusOn = (nodeId) => {
    setFocus(nodeId);
    setQuery("");
    setSearch("");
    setSelected(nodeId);
    setPanel(null);
  };

  const empty = loaded && !visible.nodes.length;
  return (
    <div className="kg-page">
      <div className="kg-main">
        <div className="board-toolbar kg-toolbar">
          <div className="segmented" role="tablist" aria-label="Graph view">
            <button role="tab" aria-selected={mode === "graph"} className={mode === "graph" ? "active" : ""} onClick={() => chooseMode("graph")}>
              <Waypoints size={14} />
              Graph
            </button>
            <button role="tab" aria-selected={mode === "table"} className={mode === "table" ? "active" : ""} onClick={() => chooseMode("table")}>
              <Rows3 size={14} />
              Facts
            </button>
          </div>
          <label className="board-search">
            <Search size={14} />
            <input
              aria-label="Search the graph"
              placeholder="Search the graph"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value) setFocus(null);
              }}
            />
          </label>
          <div className="kg-toolbar-end">
            <button type="button" className={`secondary${panel === "add" ? " is-active" : ""}`} onClick={() => (setPanel("add"), setSelected(null))}>
              <Plus size={14} />
              Add fact
            </button>
            <button type="button" className={`primary${panel === "ask" ? " is-active" : ""}`} onClick={() => (setPanel("ask"), setSelected(null))}>
              <MessageSquare size={14} />
              Ask the graph
            </button>
          </div>
        </div>
        <div className="kg-filters">
          <div className="kg-chips" role="group" aria-label="Show node types">
            {FILTERS.map((kind) => (
              <button
                type="button"
                key={kind}
                className={`kg-chip${hidden.has(kind) ? "" : " is-on"}`}
                aria-pressed={!hidden.has(kind)}
                onClick={() => toggle(kind)}
                title={kind === "written" ? "Things bots and you have written: concepts, decisions, people…" : undefined}
              >
                <Swatch kind={kind} />
                {KINDS[kind].label}
                <span className="segmented-count">{counts[kind]}</span>
              </button>
            ))}
          </div>
          <div className="segmented" role="tablist" aria-label="Which links">
            <button role="tab" aria-selected={!factsOnly} className={!factsOnly ? "active" : ""} onClick={() => setFactsOnly(false)}>
              Everything
            </button>
            <button role="tab" aria-selected={factsOnly} className={factsOnly ? "active" : ""} onClick={() => setFactsOnly(true)}>
              Written facts
              <span className="segmented-count">{written}</span>
            </button>
          </div>
        </div>
        {(focusNode || graph.truncated) && (
          <div className="kg-scope">
            {focusNode && (
              <>
                <span>
                  Around <strong>{focusNode.label}</strong>
                </span>
                <div className="segmented" role="tablist" aria-label="Neighborhood depth">
                  {[1, 2].map((hops) => (
                    <button role="tab" key={hops} aria-selected={depth === hops} className={depth === hops ? "active" : ""} onClick={() => setDepth(hops)}>
                      {hops} {hops === 1 ? "hop" : "hops"}
                    </button>
                  ))}
                </div>
                <button type="button" className="secondary" onClick={() => setFocus(null)}>
                  <X size={13} />
                  Show everything
                </button>
              </>
            )}
            {graph.truncated && <span className="muted">Showing the first 300 things. Search or focus to narrow it down.</span>}
          </div>
        )}
        {empty ? (
          <div className="reports-empty">
            <Waypoints size={22} />
            {search ? (
              <>
                <p>Nothing in the graph matches “{search}”.</p>
                <button type="button" className="secondary" onClick={() => setQuery("")}>
                  Clear search
                </button>
              </>
            ) : factsOnly ? (
              <>
                <p>No written facts yet. Bots add them as they work, or you can add one.</p>
                <button type="button" className="secondary" onClick={() => setPanel("add")}>
                  <Plus size={14} />
                  Add fact
                </button>
              </>
            ) : !data.employees.some((e) => !e.archived) ? (
              <p>Hire a bot and start a project. The graph fills in from your org, boards, and files.</p>
            ) : (
              <p>Every node type is hidden. Turn one back on above.</p>
            )}
          </div>
        ) : mode === "graph" ? (
          <GraphCanvas graph={visible} seeds={graph.seeds} selected={selected} onSelect={select} onFocus={focusOn} />
        ) : (
          <FactsTable graph={visible} who={who} onSelect={select} selected={selected} />
        )}
      </div>
      {node ? (
        <NodePanel
          node={node}
          graph={graph}
          data={data}
          who={who}
          act={act}
          onSelect={select}
          onFocus={focusOn}
          onClose={() => setSelected(null)}
          onMessage={onMessage}
          reload={reload}
        />
      ) : panel === "add" ? (
        <SidePanel title="Add a fact" onClose={() => setPanel(null)}>
          <p className="kg-help">
            Facts link two things with a relation. Names that match a bot, project, task, or existing entity link to it; new names become new entities.
          </p>
          <FactForm nodes={graph.nodes} act={act} onDone={reload} />
        </SidePanel>
      ) : panel === "ask" ? (
        <SidePanel title="Ask the graph" onClose={() => setPanel(null)}>
          <AskForm data={data} act={act} onAsked={setPendingChat} />
        </SidePanel>
      ) : null}
    </div>
  );
}
