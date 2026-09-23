import { id, now } from "./store.mjs";

export const SCOPES = ["private", "team", "project"];
const MAX_BODY = 2000;

// Employee memory. Scopes:
//   private: the employee, everyone above it in the chain, and the owner
//   team:    every employee
//   project: members of that project
// Retrieval ranks with SQLite FTS5 bm25 over body and tags; pinned first.
export class Memory {
  constructor(store, org) {
    this.store = store;
    this.org = org;
  }
  sanitize(payload, { partial = false } = {}) {
    const out = {};
    if (payload.body !== undefined || !partial) {
      if (typeof payload.body !== "string" || !payload.body.trim()) throw new Error("Memory needs text");
      if (payload.body.length > MAX_BODY) throw new Error(`A memory holds at most ${MAX_BODY} characters`);
      out.body = payload.body.trim();
    }
    if (payload.scope !== undefined || !partial) {
      const scope = payload.scope ?? "private";
      if (!SCOPES.includes(scope)) throw new Error("Scope must be private, team, or project");
      out.scope = scope;
    }
    if (payload.tags !== undefined) {
      if (!Array.isArray(payload.tags) || payload.tags.length > 8) throw new Error("Tags must be a list of at most 8");
      out.tags = payload.tags.map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean);
    }
    if (payload.pinned !== undefined) out.pinned = payload.pinned === true ? 1 : 0;
    return out;
  }
  index(memoryId) {
    const row = this.store.one("SELECT rowid,body,tags FROM memories WHERE id=?", memoryId);
    this.store.run("DELETE FROM memories_fts WHERE memory=?", memoryId);
    if (row) this.store.run("INSERT INTO memories_fts(body,tags,memory) VALUES (?,?,?)", row.body, JSON.parse(row.tags).join(" "), memoryId);
  }
  create({ employee, conversation = "", source = "owner", run = null, ...rest }) {
    if (!this.store.one("SELECT id FROM employees WHERE id=?", String(employee || ""))) throw new Error("Employee not found");
    const clean = this.sanitize(rest);
    if (clean.scope === "project" && !conversation) throw new Error("Project memories need a project");
    const memoryId = id();
    const stamp = now();
    this.store.run(
      "INSERT INTO memories(id,employee,scope,conversation,body,tags,pinned,source,run,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      memoryId,
      employee,
      clean.scope,
      clean.scope === "project" ? conversation : "",
      clean.body,
      JSON.stringify(clean.tags || []),
      clean.pinned || 0,
      source,
      run,
      stamp,
      stamp,
    );
    this.index(memoryId);
    return memoryId;
  }
  update(payload) {
    const memory = this.store.one("SELECT * FROM memories WHERE id=?", String(payload.id || ""));
    if (!memory) throw new Error("Memory not found");
    const clean = this.sanitize(payload, { partial: true });
    const fields = Object.keys(clean);
    if (!fields.length) return;
    this.store.run(
      `UPDATE memories SET ${fields.map((f) => `${f}=?`).join(",")},updated=? WHERE id=?`,
      ...fields.map((f) => (f === "tags" ? JSON.stringify(clean[f]) : clean[f])),
      now(),
      memory.id,
    );
    this.index(memory.id);
  }
  remove(memoryId) {
    this.store.run("DELETE FROM memories_fts WHERE memory=?", String(memoryId));
    this.store.run("DELETE FROM memories WHERE id=?", String(memoryId));
  }
  list({ employee } = {}) {
    const rows = employee
      ? this.store.all("SELECT * FROM memories WHERE employee=? ORDER BY pinned DESC, updated DESC", employee)
      : this.store.all("SELECT * FROM memories ORDER BY pinned DESC, updated DESC");
    return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags), pinned: Boolean(row.pinned) }));
  }
  // What `employee` may read while working in `conversation`.
  visibleClause(employee, conversation) {
    const own = [employee, ...this.org.allReports(employee).map((r) => r.id)];
    return {
      sql: `(m.scope='team' OR (m.scope='project' AND m.conversation=?) OR (m.scope='private' AND m.employee IN (${own.map(() => "?").join(",")})))`,
      args: [conversation, ...own],
    };
  }
  recall(employee, conversation, query, { limit = 8, budget = 2000 } = {}) {
    const visible = this.visibleClause(employee, conversation);
    const pinned = this.store.all(
      `SELECT m.* FROM memories m WHERE m.pinned=1 AND ${visible.sql} ORDER BY m.updated DESC LIMIT 5`,
      ...visible.args,
    );
    const words = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].slice(0, 24);
    let ranked = [];
    if (words.length) {
      const match = words.map((word) => `"${word.replace(/"/g, "")}"`).join(" OR ");
      ranked = this.store.all(
        `SELECT m.*, bm25(memories_fts) AS score FROM memories_fts JOIN memories m ON m.id=memories_fts.memory
         WHERE memories_fts MATCH ? AND m.pinned=0 AND ${visible.sql} ORDER BY score, m.updated DESC LIMIT ?`,
        match,
        ...visible.args,
        limit,
      );
    }
    if (!ranked.length && !pinned.length)
      ranked = this.store.all(
        `SELECT m.* FROM memories m WHERE m.employee=? AND ${visible.sql} ORDER BY m.updated DESC LIMIT 3`,
        employee,
        ...visible.args,
      );
    const out = [];
    let used = 0;
    for (const memory of [...pinned, ...ranked]) {
      if (out.some((m) => m.id === memory.id)) continue;
      used += memory.body.length;
      if (used > budget && out.length) break;
      out.push(memory);
    }
    return out;
  }
  applyAgentAction(action, run) {
    if (action.type === "memory.save") {
      const scope = action.scope ?? "private";
      const memoryId = this.create({
        employee: run.employee,
        body: action.body,
        scope,
        tags: action.tags,
        conversation: scope === "project" ? run.conversation : "",
        source: "agent",
        run: run.id,
      });
      return `remembered (${scope}) ${memoryId.slice(0, 8)}`;
    }
    const memory = this.store.all("SELECT id,employee FROM memories WHERE employee=?", run.employee).find(
      (m) => m.id === action.id || (typeof action.id === "string" && action.id.length >= 6 && m.id.startsWith(action.id)),
    );
    if (!memory) throw new Error("You can only forget your own memories");
    this.remove(memory.id);
    return `forgot ${memory.id.slice(0, 8)}`;
  }
}
