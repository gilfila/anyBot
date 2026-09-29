// Pure helpers for the chat's conveniences: returned-file cards, message
// actions, run notices, and timestamps. No React, so they run under
// node:test (tests/chat.test.mjs).
import { recentHarnessFailures } from "./harnesses.js";

// Runs that ended without a reply: their notices offer Retry and Details.
export const STOPPED = ["failed", "interrupted", "cancelled"];

// The machine-readable blocks bots end replies with (delegation, board
// actions, returned files). Nobody wants them on the clipboard.
const MACHINE_BLOCK = /```(?:anybot|anybot-actions|anybot-artifacts)[^\S\n]*\n[\s\S]*?```[^\S\n]*\n?/g;
export function copyText(body) {
  return String(body ?? "")
    .replace(MACHINE_BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The files a reply's ```anybot-artifacts block lists, or null when the block
// isn't a manifest the runtime would accept the shape of (the chat then shows
// it as code, next to the "Files were not collected" notice).
export function manifestPaths(code) {
  let value;
  try {
    value = JSON.parse(code);
  } catch {
    return null;
  }
  if (!value || !Array.isArray(value.paths) || !value.paths.length || value.paths.length > 8) return null;
  if (!value.paths.every((path) => typeof path === "string" && path && path.length <= 500)) return null;
  return [...new Set(value.paths)];
}

// Pairs each listed path with the artifact its run collected: stored under
// the file's name (runtime/artifacts.mjs), each artifact used once.
export function matchArtifacts(paths, artifacts = []) {
  const left = [...artifacts];
  return paths.map((path) => {
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
    const index = left.findIndex((artifact) => artifact.name === name);
    return { path, name, artifact: index >= 0 ? left.splice(index, 1)[0] : null };
  });
}

// A reply still streaming, with a ``` fence that hasn't closed yet, closed
// for display: the half-written code shows as code, not as markdown (a
// "# comment" as a heading) or live HTML.
export function closeOpenFence(text) {
  const value = String(text ?? "");
  return (value.match(/```/g) || []).length % 2 ? `${value}\n\`\`\`` : value;
}

// A reply's ```anybot delegation block ({type:"delegate", employeeId,
// objective}), or null.
export function delegationBlock(code) {
  try {
    const value = JSON.parse(code);
    if (value?.type === "delegate" && typeof value.employeeId === "string" && typeof value.objective === "string")
      return { employeeId: value.employeeId, objective: value.objective };
  } catch {
    // Not JSON: shown as code.
  }
  return null;
}

// The run this message is the reply of (runs[].response, from run_responses).
export function replyRun(message, runs = []) {
  return (message?.id && runs.find((run) => run.response === message.id)) || null;
}

// The runs a message handed work to (a handoff's delegate, a review request's
// reviewer), oldest first.
export function handedTo(message, runs = []) {
  return message?.id ? runs.filter((run) => run.message === message.id) : [];
}

// The bot an @mention names. Names are unique among active bots and case
// doesn't matter (runtime/mentions.mjs); an active bot wins over an archived one.
export function botNamed(name, employees = []) {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return null;
  const hits = employees.filter((employee) => String(employee.name ?? "").trim().toLowerCase() === key);
  return hits.find((employee) => !employee.archived) || hits[0] || null;
}

// Where "Details" on a stopped run goes: the harness's problems when it has
// any (config issues, or failed runs this week, which include this one),
// otherwise Settings → Diagnostics.
export function runDetails(run, { employees = [], harnesses = [], runs = [] } = {}, now = Date.now()) {
  const bot = employees.find((employee) => employee.id === run?.employee);
  const harness = bot && harnesses.find((item) => item.id === bot.harness);
  if (harness && (harness.issues?.length || recentHarnessFailures(harness.id, runs, employees, now).length))
    return { view: "harnesses", harness: harness.id };
  return { view: "diagnostics" };
}

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// A message's time: "14:02" today, "Yesterday 14:02", "Sep 26, 14:02" this
// year, "Sep 26, 2025, 14:02" before that. `title` is the full date and time.
export function stamp(value, now = new Date(), locale = undefined) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "", title: "" };
  const today = new Date(now);
  const clock = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const title = date.toLocaleString(locale, { dateStyle: "full", timeStyle: "short" });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return { label: clock, title };
  if (sameDay(date, yesterday)) return { label: `Yesterday ${clock}`, title };
  const day = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
  return { label: `${day}, ${clock}`, title };
}

// How long a run has been going: "8s", "2m 05s", "1h 04m".
export function elapsed(from, now = Date.now()) {
  const start = Date.parse(from);
  if (!Number.isFinite(start)) return "";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
