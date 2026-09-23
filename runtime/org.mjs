import { id, now } from "./store.mjs";

// Chain of command. employees.manager holds the manager's employee id, or
// "" when the employee reports to the owner. Reports roll finished work up
// the chain; reports addressed to "" land in the owner's feed.
export class Org {
  constructor(store) {
    this.store = store;
  }
  manager(employeeId) {
    return this.store.one("SELECT manager FROM employees WHERE id=?", employeeId)?.manager || "";
  }
  // Managers above `employeeId`, nearest first.
  chain(employeeId) {
    const chain = [];
    const seen = new Set([employeeId]);
    let current = this.manager(employeeId);
    while (current && !seen.has(current)) {
      chain.push(current);
      seen.add(current);
      current = this.manager(current);
    }
    return chain;
  }
  isBelow(employeeId, managerId) {
    return Boolean(managerId) && this.chain(employeeId).includes(managerId);
  }
  directReports(managerId) {
    return this.store
      .all("SELECT id,name,role FROM employees WHERE manager=? AND archived=0 ORDER BY created", managerId)
      .map((row) => ({ ...row }));
  }
  allReports(managerId) {
    const out = [];
    const queue = [managerId];
    const seen = new Set(queue);
    while (queue.length) {
      for (const report of this.directReports(queue.shift())) {
        if (seen.has(report.id)) continue;
        seen.add(report.id);
        out.push(report);
        queue.push(report.id);
      }
    }
    return out;
  }
  setManager(payload) {
    const employee = this.store.one("SELECT id FROM employees WHERE id=?", String(payload.id || ""));
    if (!employee) throw new Error("Employee not found");
    const manager = typeof payload.manager === "string" ? payload.manager : "";
    if (manager) {
      if (manager === employee.id) throw new Error("An employee cannot report to themselves");
      const row = this.store.one("SELECT id,archived FROM employees WHERE id=?", manager);
      if (!row) throw new Error("Manager not found");
      if (row.archived) throw new Error("Restore that manager before assigning reports to them");
      if (this.isBelow(manager, employee.id))
        throw new Error("That would create a reporting loop");
    }
    this.store.run("UPDATE employees SET manager=?,revision=revision+1 WHERE id=?", manager, employee.id);
    this.store.event("employee.manager", { employee: employee.id, manager });
  }
  report({ from, task = null, run = null, summary }) {
    const text = String(summary || "").trim().slice(0, 2000);
    if (!text) return null;
    const reportId = id();
    this.store.run(
      "INSERT INTO reports(id,fromEmployee,toEmployee,task,run,summary,read,created) VALUES (?,?,?,?,?,?,0,?)",
      reportId,
      from,
      this.manager(from),
      task,
      run,
      text,
      now(),
    );
    return reportId;
  }
  reports({ to, limit = 100 } = {}) {
    const rows =
      to === undefined
        ? this.store.all("SELECT * FROM reports ORDER BY created DESC, rowid DESC LIMIT ?", limit)
        : this.store.all("SELECT * FROM reports WHERE toEmployee=? ORDER BY created DESC, rowid DESC LIMIT ?", to, limit);
    return rows.map((row) => ({ ...row, read: Boolean(row.read) }));
  }
  unreadFor(employeeId, limit = 10) {
    return this.store
      .all("SELECT * FROM reports WHERE toEmployee=? AND read=0 ORDER BY created, rowid LIMIT ?", employeeId, limit)
      .map((row) => ({ ...row }));
  }
  markRead(ids) {
    for (const reportId of ids) this.store.run("UPDATE reports SET read=1 WHERE id=?", String(reportId));
  }
  // Per-employee counts for the org chart: tasks done in the last 7 days,
  // currently in progress, and waiting in review.
  stats() {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const tasks = this.store.all("SELECT status,assignees,updated FROM tasks");
    const out = {};
    for (const task of tasks) {
      for (const person of JSON.parse(task.assignees)) {
        const entry = (out[person] ||= { done: 0, inProgress: 0, review: 0 });
        if (task.status === "done" && task.updated >= weekAgo) entry.done += 1;
        if (task.status === "in_progress") entry.inProgress += 1;
        if (task.status === "review") entry.review += 1;
      }
    }
    return out;
  }
}
