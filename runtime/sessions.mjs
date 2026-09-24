// Harness sessions (docs/plans/lean-runtime.md §3.2, as amended by the M2
// design checkpoint; docs/architecture/sessions.md). A bot keeps one native
// CLI session per (bot, conversation, thread); later turns resume it and are
// sent only what the session hasn't seen.
//
// Correctness rules:
// - A session is saved only in a successful run's transaction. Any failed,
//   cancelled, or timed-out turn drops it, so the next turn starts fresh.
// - Any change to what the bot is allowed to do or told (the policy hash)
//   starts a fresh session; old instructions would stay in native history.
// - Delivered messages are tracked by id, not a rowid cursor, so a message
//   that becomes eligible out of order is still delivered later.
import { createHash } from "node:crypto";

// Harnesses whose resume is on by default: none. Claude and Codex both resume
// correctly (live spikes, plan §3.2), but the M2 live gate found no token
// saving: every Claude Code process writes ~31k tokens of its own context to
// the provider cache whether it resumes or not (resumed and fresh turns both
// ~47.6k uncached over 3 runs), and a resumed Codex turn cost ~17,800 uncached
// against ~2,400 fresh. The path stays built and tested behind the
// Coordinator's `resumable` option (docs/architecture/sessions.md).
export const RESUMABLE = new Set();
// Rotation keeps harness-side compaction from ballooning.
export const MAX_TURNS = 40;

// `peers` and `reports` are {id, name, role}: the stable layers quote their
// names and roles, so renaming a teammate changes the policy too.
export function policyHash({ employee, conversation, members, peers = [], reports = [] }) {
  const roster = (list) => list.map((p) => [p.id, p.name, p.role]).sort();
  const policy = {
    peers: roster(peers),
    reports: roster(reports),
    harness: employee.harness,
    model: employee.model || "",
    workspace: employee.workspace,
    permissionMode: employee.permissionMode || "auto",
    instructions: employee.instructions || "",
    name: employee.name,
    allowedFolders: JSON.parse(conversation.allowedFolders || "[]"),
    members: [...members].sort(),
  };
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export class Sessions {
  constructor(store) {
    this.store = store;
    // Bumped by every "Start fresh" and archive. A run that started under an
    // older generation doesn't save its session, so it can't undo them.
    this.generation = 0;
  }
  static key(run) {
    return { employee: run.employee, conversation: run.conversation, thread: run.thread || "" };
  }
  // The live session for this run, or null. A stale one (other harness,
  // changed policy, too many turns) is dropped here.
  lookup(key, { harness, policy }) {
    const row = this.store.one(
      "SELECT * FROM harness_sessions WHERE employee=? AND conversation=? AND thread=?",
      key.employee,
      key.conversation,
      key.thread,
    );
    if (!row) return null;
    if (row.harness !== harness || row.policy_hash !== policy || row.turns >= MAX_TURNS) {
      this.drop(key);
      return null;
    }
    const delivered = new Set(
      this.store
        .all(
          "SELECT message FROM harness_session_messages WHERE employee=? AND conversation=? AND thread=?",
          key.employee,
          key.conversation,
          key.thread,
        )
        .map((r) => r.message),
    );
    return { ...row, delivered };
  }
  // Called inside the successful run's transaction.
  save(key, { harness, sessionId, policy, delivered, generation = this.generation }) {
    if (generation !== this.generation) return false;
    const at = new Date().toISOString();
    this.store.run(
      `INSERT INTO harness_sessions(employee,conversation,thread,harness,session_id,policy_hash,turns,created,updated)
       VALUES (?,?,?,?,?,?,1,?,?)
       ON CONFLICT(employee,conversation,thread) DO UPDATE SET
         session_id=excluded.session_id, harness=excluded.harness, policy_hash=excluded.policy_hash,
         turns=CASE WHEN harness_sessions.session_id=excluded.session_id THEN harness_sessions.turns+1 ELSE 1 END,
         updated=excluded.updated`,
      key.employee,
      key.conversation,
      key.thread,
      harness,
      sessionId,
      policy,
      at,
      at,
    );
    const insert = "INSERT OR IGNORE INTO harness_session_messages(employee,conversation,thread,message) VALUES (?,?,?,?)";
    for (const message of delivered) this.store.run(insert, key.employee, key.conversation, key.thread, message);
    return true;
  }
  // A failed turn drops only the session it used, never a newer one that
  // another run saved for the same key in the meantime.
  dropIf(key, sessionIds) {
    const row = this.store.one("SELECT session_id FROM harness_sessions WHERE employee=? AND conversation=? AND thread=?", key.employee, key.conversation, key.thread);
    if (row && sessionIds.includes(row.session_id)) this.drop(key);
  }
  drop(key) {
    for (const table of ["harness_session_messages", "harness_sessions"])
      this.store.run(`DELETE FROM ${table} WHERE employee=? AND conversation=? AND thread=?`, key.employee, key.conversation, key.thread);
  }
  // "Start fresh", archiving: drop every session matching the filter.
  dropWhere({ employee, conversation, thread }) {
    // `thread` may be "" (direct chats), so only `undefined` means "any".
    const used = [];
    if (employee) used.push(["employee", employee]);
    if (conversation) used.push(["conversation", conversation]);
    if (thread !== undefined) used.push(["thread", thread || ""]);
    if (!used.length) throw new Error("Say which sessions to drop");
    this.generation += 1;
    const clauses = used.map(([column]) => `${column}=?`);
    const args = used.map(([, value]) => value);
    let dropped = 0;
    for (const table of ["harness_session_messages", "harness_sessions"])
      dropped = this.store.run(`DELETE FROM ${table} WHERE ${clauses.join(" AND ")}`, ...args).changes;
    return dropped;
  }
}
