export const STATUSES = [
  { id: "backlog", label: "Backlog" },
  { id: "in_progress", label: "In progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;

export const PRIORITIES = [
  { id: "none", label: "No priority" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
];
export const priorityLabel = (id) => PRIORITIES.find((p) => p.id === id)?.label || id;
export const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export const ACTIVE = ["queued", "running", "cancelling"];

export function taskRuns(runs, taskId) {
  return runs.filter((run) => run.task === taskId);
}
export function isWorking(runs, taskId) {
  return runs.some((run) => run.task === taskId && ACTIVE.includes(run.status));
}

export function formatDue(due) {
  if (!due) return "";
  const date = new Date(`${due}T00:00:00`);
  if (Number.isNaN(date.getTime())) return due;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
export function isOverdue(due, status) {
  if (!due || status === "done") return false;
  const date = new Date(`${due}T23:59:59`);
  return !Number.isNaN(date.getTime()) && date < new Date();
}

export function authorName(author, employees) {
  if (author === "human") return "You";
  if (author === "system") return "anyBot";
  return employees.find((e) => e.id === author)?.name || "Former employee";
}
