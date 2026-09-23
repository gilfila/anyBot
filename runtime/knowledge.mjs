import { id, now } from "./store.mjs";

// Knowledge graph. Two layers share one id space:
//   auto: derived on read from workspace data, never stored. Ids are
//         "agent:<id>", "project:<id>", "task:<id>", "artifact:<id>".
//   written: entities and edges added by employees (kg.fact) or the owner,
//         with provenance. Written edges may point at auto nodes.
export const AUTO_TYPES = ["agent", "project", "task", "artifact"];
const ENTITY_TYPE = /^[a-z][a-z0-9_-]{0,23}$/;
const MAX_LABEL = 120;
const MAX_NOTE = 600;
const MAX_NODES = 300;
// Under the node cap, keep people and projects before the long tail.
const TYPE_RANK = { agent: 0, project: 1, task: 3, artifact: 4 };
const rank = (node) => TYPE_RANK[node.type] ?? 2;
const STOP = new Set(
  "the and for with that this from into onto about what which when where who how why are was were has have had not but you your our their its can will should would could please make need needs does did done task tasks project bot bots".split(
    " ",
  ),
);
export const words = (value) =>
  [...new Set(String(value).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter((w) => !STOP.has(w));

const clean = (value, name, max) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return trimmed;
};
const noteOf = (value) =>
  value === undefined || value === null ? "" : clean(String(value), "Note", MAX_NOTE);
const relationOf = (value) =>
  clean(value, "Relation", 60)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "") || "related_to";
const sourceOf = (author) => (author === "human" ? "owner" : "agent");

export class Knowledge {
  constructor(store) {
    this.store = store;
  }
  // Workspace-derived graph. Direct chats are not projects.
  auto() {
    const nodes = [];
    const edges = [];
    const employees = this.store.all("SELECT id,name,role,manager,archived FROM employees");
    const live = new Set(employees.filter((e) => !e.archived).map((e) => e.id));
    for (const e of employees) {
      if (!live.has(e.id)) continue;
      nodes.push({ id: `agent:${e.id}`, type: "agent", label: e.name, note: e.role, source: "auto", ref: e.id });
      if (e.manager && live.has(e.manager))
        edges.push({ id: `auto:rep:${e.id}`, src: `agent:${e.id}`, dst: `agent:${e.manager}`, relation: "reports_to", source: "auto" });
    }
    const projects = new Set();
    for (const c of this.store.all("SELECT id,title,members FROM conversations")) {
      const members = JSON.parse(c.members);
      if (members.length < 2) continue;
      projects.add(c.id);
      nodes.push({ id: `project:${c.id}`, type: "project", label: c.title, note: "", source: "auto", ref: c.id });
      for (const m of members)
        if (live.has(m))
          edges.push({ id: `auto:mem:${m}:${c.id}`, src: `agent:${m}`, dst: `project:${c.id}`, relation: "member_of", source: "auto" });
    }
    for (const t of this.store.all("SELECT id,conversation,title,status,assignees,parent FROM tasks")) {
      nodes.push({ id: `task:${t.id}`, type: "task", label: t.title, note: t.status, source: "auto", ref: t.id, conversation: t.conversation });
      if (projects.has(t.conversation))
        edges.push({ id: `auto:in:${t.id}`, src: `task:${t.id}`, dst: `project:${t.conversation}`, relation: "in", source: "auto" });
      if (t.parent) edges.push({ id: `auto:sub:${t.id}`, src: `task:${t.id}`, dst: `task:${t.parent}`, relation: "follows", source: "auto" });
      for (const a of JSON.parse(t.assignees))
        if (live.has(a))
          edges.push({
            id: `auto:asg:${a}:${t.id}`,
            src: `agent:${a}`,
            dst: `task:${t.id}`,
            relation: t.status === "done" ? "completed" : "assigned_to",
            source: "auto",
          });
    }
    for (const a of this.store.all(
      "SELECT a.id,a.name,a.conversation,r.employee,r.task FROM artifacts a JOIN runs r ON r.id=a.run",
    )) {
      nodes.push({ id: `artifact:${a.id}`, type: "artifact", label: a.name, note: "", source: "auto", ref: a.id, conversation: a.conversation });
      if (live.has(a.employee))
        edges.push({ id: `auto:prod:${a.id}`, src: `artifact:${a.id}`, dst: `agent:${a.employee}`, relation: "produced_by", source: "auto" });
      if (a.task) edges.push({ id: `auto:att:${a.id}`, src: `artifact:${a.id}`, dst: `task:${a.task}`, relation: "attached_to", source: "auto" });
    }
    return { nodes, edges };
  }
  full() {
    const auto = this.auto();
    const entities = this.store
      .all("SELECT id,type,label,note,source,createdBy,run,pinned,created,updated FROM kg_entities")
      .map((e) => ({ ...e, pinned: Boolean(e.pinned) }));
    const written = this.store
      .all("SELECT id,src,dst,relation,note,source,createdBy,run,pinned,created,updated FROM kg_edges")
      .map((e) => ({ ...e, pinned: Boolean(e.pinned) }));
    const nodes = [...auto.nodes, ...entities];
    const known = new Set(nodes.map((n) => n.id));
    // Written edges to a deleted task or archived bot stay stored but hidden.
    const edges = [...auto.edges, ...written].filter((e) => known.has(e.src) && known.has(e.dst));
    return { nodes, edges };
  }
  index(ref, text) {
    this.store.run("DELETE FROM kg_fts WHERE ref=?", ref);
    if (text) this.store.run("INSERT INTO kg_fts(text,ref) VALUES (?,?)", text, ref);
  }
  indexEdge(edgeId, nodes) {
    const edge = this.store.one("SELECT src,dst,relation,note FROM kg_edges WHERE id=?", edgeId);
    if (!edge) return;
    const label = (nodeId) => nodes.find((n) => n.id === nodeId)?.label || "";
    this.index(edgeId, `${label(edge.src)} ${edge.relation.replace(/_/g, " ")} ${label(edge.dst)} ${edge.note}`);
  }
  // Resolve a fact endpoint: an explicit node id, an existing node by name
  // (workspace nodes first, the run's own project preferred), or a new entity.
  resolve(value, author, run, nodes, conversation) {
    const spec = typeof value === "string" ? { label: value } : value && typeof value === "object" ? value : null;
    if (!spec) throw new Error("Fact subjects and objects are names or {type,label}");
    if (typeof spec.id === "string") {
      const hit = nodes.find((n) => n.id === spec.id);
      if (!hit) throw new Error(`Unknown node ${spec.id.slice(0, 60)}`);
      return hit.id;
    }
    const label = clean(spec.label, "Name", MAX_LABEL);
    const key = label.toLowerCase();
    const type = spec.type === undefined || spec.type === "" ? null : String(spec.type).toLowerCase();
    if (type !== null && !ENTITY_TYPE.test(type)) throw new Error("Types are short lowercase words");
    const named = nodes.filter((n) => n.label.toLowerCase() === key && (type === null || n.type === type));
    const match =
      named.find((n) => n.source === "auto" && conversation && n.conversation === conversation) ||
      named.find((n) => n.source === "auto") ||
      named[0];
    if (match) return match.id;
    const entityType = type && !AUTO_TYPES.includes(type) ? type : "concept";
    const existing = nodes.find((n) => n.type === entityType && n.source !== "auto" && n.label.toLowerCase() === key);
    if (existing) return existing.id;
    const entityId = id();
    const stamp = now();
    this.store.run(
      "INSERT INTO kg_entities(id,type,label,labelKey,source,createdBy,run,created,updated) VALUES (?,?,?,?,?,?,?,?,?)",
      entityId,
      entityType,
      label,
      key,
      sourceOf(author),
      author,
      run,
      stamp,
      stamp,
    );
    this.index(entityId, label);
    nodes.push({ id: entityId, type: entityType, label, source: sourceOf(author) });
    return entityId;
  }
  // Adds (or refreshes) a subject –relation→ object fact. Returns the edge.
  addFact(fact, author = "human", run = null, conversation = null) {
    const nodes = this.full().nodes;
    const src = this.resolve(fact.subject, author, run, nodes, conversation);
    const dst = this.resolve(fact.object, author, run, nodes, conversation);
    if (src === dst) throw new Error("A fact needs two different things");
    const relation = relationOf(fact.relation);
    const note = noteOf(fact.note);
    const stamp = now();
    const existing = this.store.one("SELECT id FROM kg_edges WHERE src=? AND dst=? AND relation=?", src, dst, relation);
    const edgeId = existing?.id || id();
    if (existing)
      this.store.run(
        "UPDATE kg_edges SET note=?,source=?,createdBy=?,run=?,updated=? WHERE id=?",
        note,
        sourceOf(author),
        author,
        run,
        stamp,
        edgeId,
      );
    else
      this.store.run(
        "INSERT INTO kg_edges(id,src,dst,relation,note,source,createdBy,run,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
        edgeId,
        src,
        dst,
        relation,
        note,
        sourceOf(author),
        author,
        run,
        stamp,
        stamp,
      );
    this.indexEdge(edgeId, nodes);
    this.store.event("kg.fact", { edge: edgeId, author, run });
    const label = (nodeId) => nodes.find((n) => n.id === nodeId)?.label;
    return { id: edgeId, src, dst, relation, subject: label(src), object: label(dst) };
  }
  // Seed nodes for a text query: FTS hits on written entities and facts,
  // plus workspace nodes whose names share a significant word with it.
  seeds(q, graph) {
    const seeds = new Set();
    const terms = words(q).slice(0, 16);
    if (!terms.length) return seeds;
    const edges = new Map(graph.edges.map((e) => [e.id, e]));
    const nodes = new Set(graph.nodes.map((n) => n.id));
    const match = terms.map((w) => `"${w}"*`).join(" OR ");
    for (const row of this.store.all(
      "SELECT ref FROM kg_fts WHERE kg_fts MATCH ? ORDER BY bm25(kg_fts) LIMIT 100",
      match,
    )) {
      if (nodes.has(row.ref)) seeds.add(row.ref);
      const edge = edges.get(row.ref);
      if (edge) {
        seeds.add(edge.src);
        seeds.add(edge.dst);
      }
    }
    const wanted = new Set(terms);
    for (const node of graph.nodes)
      if (node.source === "auto" && words(node.label).some((w) => wanted.has(w))) seeds.add(node.id);
    return seeds;
  }
  // Whole graph, or the neighborhood of a query or a focused node, capped
  // for the UI. `seeds` tells the caller which nodes matched directly.
  query({ q = "", focus = "", depth = 1, types = null } = {}) {
    const graph = this.full();
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const typed = (node) => !types || types.includes(node.type);
    let seeds = null;
    let keep;
    if (focus) seeds = new Set(byId.has(focus) ? [focus] : []);
    else if (String(q).trim()) seeds = this.seeds(q, graph);
    if (!seeds) keep = graph.nodes.filter(typed).map((n) => n.id);
    else {
      const reached = new Set(seeds);
      for (let hop = 0; hop < Math.min(2, Math.max(0, Math.floor(depth))); hop++) {
        const frontier = new Set(reached);
        for (const edge of graph.edges)
          if (frontier.has(edge.src) || frontier.has(edge.dst)) {
            reached.add(edge.src);
            reached.add(edge.dst);
          }
      }
      keep = [...reached].filter((nodeId) => seeds.has(nodeId) || typed(byId.get(nodeId)));
    }
    const ordered = keep
      .map((nodeId) => byId.get(nodeId))
      .sort((a, b) => (seeds?.has(b.id) ? 1 : 0) - (seeds?.has(a.id) ? 1 : 0) || rank(a) - rank(b));
    const nodes = ordered.slice(0, MAX_NODES);
    const present = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: graph.edges.filter((e) => present.has(e.src) && present.has(e.dst)),
      seeds: seeds ? [...seeds].filter((nodeId) => present.has(nodeId)) : [],
      truncated: ordered.length > MAX_NODES,
    };
  }
  // Facts for a prompt: pinned facts and facts about pinned entities, then
  // written facts near the text, then workspace edges that touch a node the
  // text names directly. Pinning a fact vouches for it, so it loses the
  // bot-written marker.
  recall(text, { budget = 2500, limit = 40 } = {}) {
    const graph = this.full();
    const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
    const pinnedNodes = new Set(graph.nodes.filter((n) => n.pinned).map((n) => n.id));
    const seeds = this.seeds(text, graph);
    const near = new Set(seeds);
    for (const edge of graph.edges)
      if (seeds.has(edge.src) || seeds.has(edge.dst)) {
        near.add(edge.src);
        near.add(edge.dst);
      }
    const written = graph.edges.filter((e) => e.source !== "auto");
    const always = (e) => e.pinned || pinnedNodes.has(e.src) || pinnedNodes.has(e.dst);
    const picked = [
      ...written.filter(always),
      ...written.filter((e) => !always(e) && (near.has(e.src) || near.has(e.dst))),
      ...graph.edges.filter((e) => e.source === "auto" && (seeds.has(e.src) || seeds.has(e.dst))),
    ];
    const out = [];
    let used = 0;
    for (const edge of picked) {
      if (out.length >= limit) break;
      const line = `${label.get(edge.src)} —${edge.relation}→ ${label.get(edge.dst)}${edge.note ? ` (${edge.note})` : ""}${edge.source === "agent" && !edge.pinned ? " [bot-written]" : ""}`;
      if (used + line.length > budget) break;
      used += line.length;
      out.push(line);
    }
    return out;
  }
  updateEntity(payload) {
    const entity = this.store.one("SELECT * FROM kg_entities WHERE id=?", String(payload.id || ""));
    if (!entity) throw new Error("Only written entities can be edited");
    const label = payload.label === undefined ? entity.label : clean(payload.label, "Name", MAX_LABEL);
    const type = payload.type === undefined ? entity.type : String(payload.type).trim().toLowerCase();
    if (!ENTITY_TYPE.test(type) || AUTO_TYPES.includes(type))
      throw new Error("Use a custom type such as concept, person, or decision");
    const pinned = payload.pinned === undefined ? entity.pinned : payload.pinned === true ? 1 : 0;
    const note = payload.note === undefined ? entity.note : typeof payload.note === "string" ? payload.note.trim().slice(0, MAX_NOTE) : "";
    try {
      this.store.run(
        "UPDATE kg_entities SET label=?,labelKey=?,type=?,pinned=?,note=?,updated=? WHERE id=?",
        label,
        label.toLowerCase(),
        type,
        pinned,
        note,
        now(),
        entity.id,
      );
    } catch {
      throw new Error(`Another ${type} is already named "${label}"`);
    }
    this.index(entity.id, `${label} ${note}`);
    if (label !== entity.label) {
      const nodes = this.full().nodes;
      for (const edge of this.store.all("SELECT id FROM kg_edges WHERE src=? OR dst=?", entity.id, entity.id))
        this.indexEdge(edge.id, nodes);
    }
  }
  deleteEntity(entityId) {
    const entity = this.store.one("SELECT id FROM kg_entities WHERE id=?", String(entityId || ""));
    if (!entity) throw new Error("Only written entities can be deleted");
    for (const edge of this.store.all("SELECT id FROM kg_edges WHERE src=? OR dst=?", entity.id, entity.id))
      this.deleteEdge(edge.id);
    this.index(entity.id, "");
    this.store.run("DELETE FROM kg_entities WHERE id=?", entity.id);
  }
  updateEdge(payload) {
    const edge = this.store.one("SELECT * FROM kg_edges WHERE id=?", String(payload.id || ""));
    if (!edge) throw new Error("Only written facts can be edited");
    const relation = payload.relation === undefined ? edge.relation : relationOf(payload.relation);
    const note = payload.note === undefined ? edge.note : typeof payload.note === "string" ? payload.note.trim().slice(0, MAX_NOTE) : "";
    const pinned = payload.pinned === undefined ? edge.pinned : payload.pinned === true ? 1 : 0;
    try {
      this.store.run("UPDATE kg_edges SET relation=?,note=?,pinned=?,updated=? WHERE id=?", relation, note, pinned, now(), edge.id);
    } catch {
      throw new Error("That fact already exists");
    }
    this.indexEdge(edge.id, this.full().nodes);
  }
  deleteEdge(edgeId) {
    this.index(String(edgeId), "");
    this.store.run("DELETE FROM kg_edges WHERE id=?", String(edgeId));
  }
  applyAgentAction(action, run) {
    const fact = this.addFact(
      { subject: action.subject, relation: action.relation, object: action.object, note: action.note },
      run.employee,
      run.id,
      run.conversation,
    );
    return `recorded "${fact.subject} ${fact.relation.replace(/_/g, " ")} ${fact.object}"`;
  }
}
