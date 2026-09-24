// Threads in a project conversation. A reply names its thread's first
// message (messages.thread); runs name the thread they answer in. Nothing
// here is stored: it is all derived from the snapshot.
const ACTIVE = ["queued", "running", "cancelling"];

export function threadIndex(messages, runs) {
  const index = new Map();
  const entry = (id) => {
    if (!index.has(id)) index.set(id, { replies: [], participants: [], working: [], failed: [], last: null });
    return index.get(id);
  };
  const join = (list, id) => list.includes(id) || list.push(id);
  for (const m of messages) {
    if (!m.thread) continue;
    const e = entry(m.thread);
    e.replies.push(m);
    if (m.author !== "human" && m.author !== "system") join(e.participants, m.author);
    if (!e.last || m.created > e.last) e.last = m.created;
  }
  for (const r of runs) {
    if (!r.thread) continue;
    const e = entry(r.thread);
    if (ACTIVE.includes(r.status)) {
      join(e.working, r.employee);
      join(e.participants, r.employee);
    } else if (["failed", "interrupted"].includes(r.status) && !r.dismissed) e.failed.push(r);
  }
  return index;
}

// The thread a message belongs to (itself, for a thread's first message).
export const threadOf = (message) => message?.thread || message?.id || null;
