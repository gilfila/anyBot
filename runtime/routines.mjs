import { id, now } from "./store.mjs";

function required(value, max, field) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${field} must contain 1–${max} characters`);
  return value.trim();
}

export class Routines {
  constructor(coordinator, clock = Date.now) {
    this.c = coordinator;
    this.store = coordinator.store;
    this.clock = clock;
  }
  list() {
    return this.store
      .all("SELECT * FROM routines ORDER BY created")
      .map((routine) => {
        const latest = this.store.one(
          "SELECT * FROM routine_occurrences WHERE routine=? ORDER BY rowid DESC LIMIT 1",
          routine.id,
        );
        const runs = latest?.root
          ? this.store.all("SELECT status FROM runs WHERE root=?", latest.root)
          : [];
        const status = runs.some((r) => r.status === "running")
          ? "running"
          : runs.some((r) => r.status === "queued")
            ? "queued"
            : runs.some((r) => ["failed", "interrupted"].includes(r.status))
              ? "failed"
              : runs.length
                ? runs.at(-1).status
                : latest?.status;
        return { ...routine, lastOccurrence: status || null };
      });
  }
  validateTarget(conversationId, employeeId) {
    const conversation = this.store.one(
      "SELECT members,archived FROM conversations WHERE id=?",
      required(conversationId, 100, "Conversation"),
    );
    if (!conversation || !JSON.parse(conversation.members).includes(employeeId))
      throw new Error("Routine employee must belong to its conversation");
    this.c.requireOpenProject(conversation);
    this.c.activeEmployee(employeeId);
  }
  create(payload) {
    const name = required(payload.name, 100, "Routine name");
    const prompt = required(payload.prompt, 12000, "Routine instructions");
    const minutes = Number(payload.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080)
      throw new Error("Interval must be 5–10080 whole minutes");
    this.validateTarget(payload.conversation, payload.employee);
    const routineId = id();
    this.store.run(
      "INSERT INTO routines(id,name,conversation,employee,prompt,minutes,nextRun,enabled,created) VALUES (?,?,?,?,?,?,?,?,?)",
      routineId,
      name,
      payload.conversation,
      payload.employee,
      prompt,
      minutes,
      this.clock() + minutes * 60000,
      1,
      now(),
    );
    this.store.event("routine.created", { routineId, actor: "local-owner" });
  }
  setEnabled(payload) {
    const routine = this.store.one(
      "SELECT * FROM routines WHERE id=?",
      required(payload.id, 100, "Routine ID"),
    );
    if (!routine) throw new Error("Routine not found");
    if (typeof payload.enabled !== "boolean")
      throw new Error("Enabled must be a boolean");
    if (payload.enabled)
      this.validateTarget(routine.conversation, routine.employee);
    // Resuming starts a fresh interval; paused occurrences are not replayed.
    this.store.run(
      "UPDATE routines SET enabled=?,nextRun=? WHERE id=?",
      payload.enabled ? 1 : 0,
      this.clock() + routine.minutes * 60000,
      routine.id,
    );
    this.store.event("routine.updated", {
      routineId: routine.id,
      enabled: payload.enabled,
    });
  }
  recover() {
    const current = this.clock();
    this.store.transaction(() => {
      for (const routine of this.store.all(
        "SELECT * FROM routines WHERE enabled=1 AND nextRun<=?",
        current,
      )) {
        this.record(routine, routine.nextRun, "missed", null);
        this.store.run(
          "UPDATE routines SET nextRun=? WHERE id=?",
          current + routine.minutes * 60000,
          routine.id,
        );
      }
    });
  }
  record(routine, scheduled, status, root) {
    this.store.run(
      "INSERT OR IGNORE INTO routine_occurrences(id,routine,scheduled,status,root,created) VALUES (?,?,?,?,?,?)",
      id(),
      routine.id,
      scheduled,
      status,
      root,
      now(),
    );
  }
  enqueue(routine, scheduled, manual = false) {
    this.validateTarget(routine.conversation, routine.employee);
    if (
      !manual &&
      this.store.one(
        "SELECT id FROM routine_occurrences WHERE routine=? AND scheduled=?",
        routine.id,
        scheduled,
      )
    )
      return;
    const overlap = this.store.one(
      `SELECT r.id FROM runs r JOIN routine_occurrences o ON o.root=r.root
      WHERE o.routine=? AND r.status IN ('queued','running','cancelling') LIMIT 1`,
      routine.id,
    );
    if (overlap) {
      if (manual)
        throw new Error("This routine already has active or queued work");
      this.record(routine, scheduled, "skipped-overlap", null);
      return;
    }
    const message = this.c.addMessage(
      routine.conversation,
      "system",
      "routine",
      `Routine: ${routine.name}\n\n${routine.prompt}`,
    );
    const root = this.c.addRun(routine.conversation, routine.employee, message);
    this.record(routine, scheduled, "queued", root);
    this.store.event("routine.queued", {
      routineId: routine.id,
      run: root,
      manual,
    });
  }
  runNow(payload) {
    const routine = this.store.one(
      "SELECT * FROM routines WHERE id=?",
      required(payload.id, 100, "Routine ID"),
    );
    if (!routine) throw new Error("Routine not found");
    this.store.transaction(() => {
      const last =
        this.store.one(
          "SELECT max(scheduled) AS value FROM routine_occurrences WHERE routine=?",
          routine.id,
        )?.value || 0;
      this.enqueue(routine, Math.max(this.clock(), last + 1), true);
    });
  }
  tick() {
    if (this.c.closed || this.c.paused) return;
    const current = this.clock();
    const due = this.store.all(
      "SELECT * FROM routines WHERE enabled=1 AND nextRun<=?",
      current,
    );
    if (!due.length) return;
    this.store.transaction(() => {
      for (const routine of due) {
        // An overdue interval (sleep/offline/paused) is recorded, never caught up
        // in a burst. A due tick admits one finite work item at most.
        if (current - routine.nextRun > 60000)
          this.record(routine, routine.nextRun, "missed", null);
        else this.enqueue(routine, routine.nextRun);
        this.store.run(
          "UPDATE routines SET nextRun=? WHERE id=?",
          current + routine.minutes * 60000,
          routine.id,
        );
      }
    });
    this.c.notify();
  }
}
