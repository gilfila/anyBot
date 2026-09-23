import { id, now } from "./store.mjs";

export const STATUSES = ["backlog", "in_progress", "review", "done"];
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"];
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const ACTIVE_RUN = "('queued','running','cancelling')";
const SORT_STEP = 1024;

const str = (value, name, max, { required = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${name} is required`);
  if (trimmed.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return trimmed;
};
const list = (value, name, maxItems, maxLength) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems)
    throw new Error(`${name} must be a list of at most ${maxItems}`);
  return [...new Set(value.map((item) => str(item, name, maxLength, { required: true })))];
};
const checklistFrom = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50)
    throw new Error("Checklist must be a list of at most 50 items");
  return value.map((item) => ({
    text: str(item?.text, "Checklist item", 300, { required: true }),
    done: item?.done === true,
  }));
};
const parse = (task) =>
  task && {
    ...task,
    labels: JSON.parse(task.labels),
    assignees: JSON.parse(task.assignees),
    checklist: JSON.parse(task.checklist),
  };

// Project task board. Owner commands and agent action blocks share these
// validators; agent-specific permission rules live in applyAgentAction.
export class Board {
  constructor(store) {
    this.store = store;
  }
  list() {
    return this.store
      .all(
        "SELECT id,conversation,title,status,priority,due,labels,assignees,reviewer,checklist,parent,sortKey,createdBy,created,updated,revision FROM tasks ORDER BY conversation,status,sortKey",
      )
      .map(parse);
  }
  task(taskId) {
    const task = parse(this.store.one("SELECT * FROM tasks WHERE id=?", String(taskId)));
    if (!task) throw new Error("Task not found");
    return task;
  }
  // Agents see 8-character ids in their prompt; accept any unique prefix of 6+.
  resolve(conversation, ref) {
    const value = str(ref, "Task ID", 100, { required: true });
    const exact = this.store.one("SELECT id FROM tasks WHERE id=? AND conversation=?", value, conversation);
    if (exact) return exact.id;
    if (value.length < 6) throw new Error(`Unknown task ${value}`);
    const matches = this.store.all(
      "SELECT id FROM tasks WHERE conversation=? AND substr(id,1,?)=?",
      conversation,
      value.length,
      value,
    );
    if (matches.length !== 1) throw new Error(`Unknown task ${value}`);
    return matches[0].id;
  }
  detail(taskId) {
    const task = this.task(taskId);
    return {
      task: { ...task, description: task.description },
      activity: this.store.all(
        "SELECT * FROM task_activity WHERE task=? ORDER BY created, rowid",
        task.id,
      ),
      runs: this.store.all(
        "SELECT id,employee,status,error,created,started,ended FROM runs WHERE task=? ORDER BY rowid",
        task.id,
      ),
      artifacts: this.store.all(
        "SELECT a.id,a.name,a.bytes,a.created,a.run,a.conversation FROM artifacts a JOIN runs r ON r.id=a.run WHERE r.task=? ORDER BY a.created",
        task.id,
      ),
    };
  }
  members(conversation) {
    const row = this.store.one("SELECT members FROM conversations WHERE id=?", conversation);
    if (!row) throw new Error("Conversation not found");
    return JSON.parse(row.members);
  }
  validPeople(conversation, people, name) {
    const members = this.members(conversation);
    for (const person of people)
      if (!members.includes(person)) throw new Error(`${name} must be employees in this project`);
    return people;
  }
  nextSortKey(conversation, status) {
    const row = this.store.one(
      "SELECT max(sortKey) AS top FROM tasks WHERE conversation=? AND status=?",
      conversation,
      status,
    );
    return (row?.top ?? 0) + SORT_STEP;
  }
  activity(task, author, kind, body, run = null) {
    // Touching `updated` lets open task panels know to refresh their timeline.
    this.store.run("UPDATE tasks SET updated=? WHERE id=?", now(), task);
    this.store.run(
      "INSERT INTO task_activity(id,task,author,kind,body,run,created) VALUES (?,?,?,?,?,?,?)",
      id(),
      task,
      author,
      kind,
      String(body).slice(0, 4000),
      run,
      now(),
    );
  }
  create(payload, author = "human", run = null) {
    const conversation = str(payload.conversation, "Project", 100, { required: true });
    this.members(conversation);
    const status = payload.status ?? "backlog";
    if (!STATUSES.includes(status)) throw new Error("Unknown task status");
    const priority = payload.priority ?? "none";
    if (!PRIORITIES.includes(priority)) throw new Error("Unknown task priority");
    const assignees = this.validPeople(conversation, list(payload.assignees, "Assignees", 12, 100) ?? [], "Assignees");
    const reviewer = str(payload.reviewer, "Reviewer", 100) ?? "";
    if (reviewer) this.validPeople(conversation, [reviewer], "Reviewer");
    let parent = null;
    if (payload.parent) parent = this.resolve(conversation, payload.parent);
    const taskId = id();
    const stamp = now();
    this.store.run(
      "INSERT INTO tasks(id,conversation,title,description,status,priority,due,labels,assignees,reviewer,checklist,parent,sortKey,createdBy,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      taskId,
      conversation,
      str(payload.title, "Title", 200, { required: true }),
      str(payload.description, "Description", 20000) ?? "",
      status,
      priority,
      str(payload.due, "Due date", 40) ?? "",
      JSON.stringify(list(payload.labels, "Labels", 10, 40) ?? []),
      JSON.stringify(assignees),
      reviewer,
      JSON.stringify(checklistFrom(payload.checklist) ?? []),
      parent,
      this.nextSortKey(conversation, status),
      author,
      stamp,
      stamp,
    );
    this.activity(taskId, author, "created", "Created this task", run);
    this.store.event("task.created", { task: taskId, conversation, author });
    return taskId;
  }
  update(payload, author = "human") {
    const task = this.task(payload.id);
    if (payload.revision !== undefined && payload.revision !== task.revision)
      throw new Error("Task changed. Reload it before saving.");
    const next = {};
    const title = str(payload.title, "Title", 200);
    if (title !== undefined) {
      if (!title) throw new Error("Title is required");
      next.title = title;
    }
    const description = str(payload.description, "Description", 20000);
    if (description !== undefined) next.description = description;
    if (payload.priority !== undefined) {
      if (!PRIORITIES.includes(payload.priority)) throw new Error("Unknown task priority");
      next.priority = payload.priority;
    }
    const due = str(payload.due, "Due date", 40);
    if (due !== undefined) next.due = due;
    const labels = list(payload.labels, "Labels", 10, 40);
    if (labels) next.labels = JSON.stringify(labels);
    const assignees = list(payload.assignees, "Assignees", 12, 100);
    if (assignees) next.assignees = JSON.stringify(this.validPeople(task.conversation, assignees, "Assignees"));
    if (payload.reviewer !== undefined) {
      const reviewer = str(payload.reviewer, "Reviewer", 100) ?? "";
      if (reviewer) this.validPeople(task.conversation, [reviewer], "Reviewer");
      next.reviewer = reviewer;
    }
    const checklist = checklistFrom(payload.checklist);
    if (checklist) next.checklist = JSON.stringify(checklist);
    const keys = Object.keys(next);
    if (!keys.length) return task.id;
    this.store.run(
      `UPDATE tasks SET ${keys.map((key) => `${key}=?`).join(",")},updated=?,revision=revision+1 WHERE id=?`,
      ...keys.map((key) => next[key]),
      now(),
      task.id,
    );
    if (next.assignees) this.activity(task.id, author, "assigned", `Assignees: ${JSON.parse(next.assignees).join(", ") || "none"}`);
    return task.id;
  }
  // Moves a card to a column and position. before/after are neighbour ids in
  // the destination column; the card lands between them.
  move(payload, author = "human", run = null) {
    const task = this.task(payload.id);
    const status = payload.status ?? task.status;
    if (!STATUSES.includes(status)) throw new Error("Unknown task status");
    const neighbour = (ref) => {
      if (!ref) return null;
      const row = this.store.one("SELECT sortKey FROM tasks WHERE id=? AND conversation=? AND status=?", ref, task.conversation, status);
      return row ? row.sortKey : null;
    };
    const before = neighbour(payload.before); // card that will sit above
    const after = neighbour(payload.after); // card that will sit below
    let sortKey;
    if (before !== null && after !== null) sortKey = (before + after) / 2;
    else if (before !== null) sortKey = before + SORT_STEP;
    else if (after !== null) sortKey = after - SORT_STEP;
    else sortKey = status === task.status ? task.sortKey : this.nextSortKey(task.conversation, status);
    this.store.run(
      "UPDATE tasks SET status=?,sortKey=?,updated=?,revision=revision+1 WHERE id=?",
      status,
      sortKey,
      now(),
      task.id,
    );
    if (before !== null && after !== null && Math.abs(after - before) < 1e-6) this.renumber(task.conversation, status);
    if (status !== task.status) {
      this.activity(task.id, author, "status", `${task.status} → ${status}`, run);
      this.store.event("task.moved", { task: task.id, from: task.status, to: status, author });
    }
    return task.id;
  }
  renumber(conversation, status) {
    this.store
      .all("SELECT id FROM tasks WHERE conversation=? AND status=? ORDER BY sortKey", conversation, status)
      .forEach((row, index) => this.store.run("UPDATE tasks SET sortKey=? WHERE id=?", (index + 1) * SORT_STEP, row.id));
  }
  remove(taskId) {
    const task = this.task(taskId);
    if (this.store.one(`SELECT id FROM runs WHERE task=? AND status IN ${ACTIVE_RUN} LIMIT 1`, task.id))
      throw new Error("Stop this task's work before deleting it");
    this.store.transaction(() => {
      this.store.run("UPDATE runs SET task=NULL WHERE task=?", task.id);
      this.store.run("UPDATE tasks SET parent=NULL WHERE parent=?", task.id);
      this.store.run("DELETE FROM task_activity WHERE task=?", task.id);
      this.store.run("DELETE FROM tasks WHERE id=?", task.id);
      this.store.event("task.deleted", { task: task.id });
    });
  }
  comment(payload, author = "human", run = null) {
    const task = this.task(payload.id);
    this.activity(task.id, author, "comment", str(payload.body, "Comment", 4000, { required: true }), run);
    return task.id;
  }
  activeRuns(taskId) {
    return this.store.all(`SELECT id FROM runs WHERE task=? AND status IN ${ACTIVE_RUN}`, taskId);
  }
  // The coordinator starts at most one piece of autopilot work per idle agent.
  nextBacklogFor(conversation, employee) {
    const candidates = this.store
      .all("SELECT * FROM tasks WHERE conversation=? AND status='backlog' ORDER BY sortKey", conversation)
      .map(parse)
      .filter((task) => task.assignees.includes(employee))
      .filter((task) => !this.activeRuns(task.id).length);
    candidates.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sortKey - b.sortKey);
    return candidates[0] || null;
  }
  // Agent actions are validated here, never trusted. `run` is the run whose
  // output carried the action; the task must live in that run's project.
  applyAgentAction(action, run) {
    const agent = run.employee;
    const members = this.members(run.conversation);
    if (!members.includes(agent)) throw new Error("Only project members can change this board");
    switch (action.type) {
      case "task.create": {
        const status = action.status ?? "backlog";
        if (status !== "backlog") throw new Error("Agents can only add tasks to Backlog");
        const taskId = this.create(
          {
            conversation: run.conversation,
            title: action.title,
            description: action.description,
            priority: action.priority,
            labels: action.labels,
            assignees: action.assignees,
            checklist: action.checklist?.map((text) => ({ text, done: false })),
            parent: action.parent,
          },
          agent,
          run.id,
        );
        return `created "${this.task(taskId).title}"`;
      }
      case "task.claim": {
        const task = this.task(this.resolve(run.conversation, action.task));
        if (task.status !== "backlog" || task.assignees.length)
          throw new Error("Only unassigned Backlog tasks can be claimed");
        this.store.run(
          "UPDATE tasks SET assignees=?,updated=?,revision=revision+1 WHERE id=?",
          JSON.stringify([agent]),
          now(),
          task.id,
        );
        this.activity(task.id, agent, "assigned", "Claimed this task", run.id);
        return `claimed "${task.title}"`;
      }
      case "task.update": {
        const task = this.task(this.resolve(run.conversation, action.task));
        const isAssignee = task.assignees.includes(agent);
        const isReviewer = task.reviewer === agent;
        if (!isAssignee && !isReviewer) throw new Error("Only a task's assignees or reviewer can update it");
        const done = [];
        if (action.comment !== undefined) {
          this.activity(task.id, agent, "progress", str(action.comment, "Progress note", 4000, { required: true }), run.id);
          done.push("noted progress");
        }
        if (action.checklist !== undefined || action.addChecklist !== undefined) {
          const checklist = [...task.checklist];
          for (const item of action.addChecklist ?? []) {
            if (checklist.length >= 50) break;
            checklist.push({ text: str(item, "Checklist item", 300, { required: true }), done: false });
          }
          for (const change of action.checklist ?? []) {
            const index = Number.isInteger(change?.index)
              ? change.index
              : checklist.findIndex((item) => item.text.toLowerCase() === String(change?.item || "").trim().toLowerCase());
            if (!checklist[index]) throw new Error("Unknown checklist item");
            checklist[index] = { ...checklist[index], done: change.done !== false };
          }
          this.store.run(
            "UPDATE tasks SET checklist=?,updated=?,revision=revision+1 WHERE id=?",
            JSON.stringify(checklist),
            now(),
            task.id,
          );
          done.push("updated checklist");
        }
        if (action.status !== undefined && action.status !== task.status) {
          if (!STATUSES.includes(action.status)) throw new Error("Unknown task status");
          if (!this.agentMayMove(task, action.status, { isAssignee, isReviewer }))
            throw new Error(`You cannot move this task from ${task.status} to ${action.status}`);
          // Finishing a task while collaborators are still working would pull
          // the card out from under them; apply it once the round settles.
          const finishing = action.status === "review" || action.status === "done";
          if (finishing && this.activeRuns(task.id).some((other) => other.id !== run.id)) {
            this.activity(task.id, agent, "pending-status", action.status, run.id);
            done.push(`will move to ${action.status} when the other assignees finish`);
          } else {
            this.move({ id: task.id, status: action.status }, agent, run.id);
            done.push(`moved to ${action.status}`);
          }
        }
        if (!done.length) throw new Error("task.update needs a status, comment, or checklist change");
        return `"${task.title}": ${done.join(", ")}`;
      }
      default:
        throw new Error(`Unknown action type ${String(action.type).slice(0, 40)}`);
    }
  }
  // Assignees move work forward up to Review. Done (and sending work back
  // from Review) belongs to the reviewer; with no reviewer, assignees may
  // finish the task themselves.
  agentMayMove(task, status, { isAssignee, isReviewer }) {
    const from = task.status;
    if (isReviewer && from === "review" && (status === "done" || status === "in_progress")) return true;
    if (!isAssignee) return false;
    if (from === "backlog" && status === "in_progress") return true;
    if (from === "in_progress" && status === "review") return true;
    if (!task.reviewer && (from === "in_progress" || from === "review") && status === "done") return true;
    if (from === "in_progress" && status === "backlog") return true;
    return false;
  }
}
