// Renderer side of the diagnostics log (desktop/diagnostics.cjs). Reports are
// best-effort and rate limited; a failing report is dropped silently.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
let sent = [];

export function reportIssue({ code = "error", level = "error", message = "", detail, context } = {}) {
  try {
    const now = Date.now();
    sent = sent.filter((time) => now - time < WINDOW_MS);
    if (sent.length >= MAX_PER_WINDOW || !window.anybot?.request) return;
    sent.push(now);
    window.anybot
      .request("diagnostics.report", {
        code,
        level,
        message: String(message).slice(0, 600),
        detail: detail ? String(detail).slice(0, 4000) : undefined,
        context,
      })
      .catch(() => {});
  } catch {
    // Reporting must never throw into the code that noticed the problem.
  }
}

export function installErrorReporting() {
  window.addEventListener("error", (event) => {
    reportIssue({ code: "error", message: event.message || "Script error", detail: event.error?.stack });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportIssue({ code: "rejection", message: reason?.message || String(reason), detail: reason?.stack });
  });
}

const who = (context) => context?.employee || "A bot";
const tool = (context) => context?.harness || "its harness";
// Plain-language titles and next steps for each diagnostic code. `action`
// names a button the panel can offer; `bug` marks problems in anyBot itself.
export function describeIssue(issue) {
  const c = issue.context || {};
  const table = {
    "harness.usage_limit": {
      title: `${who(c)} hit a usage limit on ${tool(c)}`,
      hint: "Switch this bot to another model or harness, or add usage to that account.",
      action: "employee",
    },
    "harness.auth": {
      title: `${tool(c)} isn't signed in for ${who(c)}`,
      hint: "Sign in to the CLI once in a terminal, then send the message again.",
      action: "harnesses",
    },
    "harness.not_installed": {
      title: `${tool(c)} isn't installed`,
      hint: "Install it, or move the bot to a harness you have.",
      action: "harnesses",
    },
    "harness.timeout": {
      title: `${who(c)} ran past its time limit`,
      hint: "Raise the time limit in the bot's settings, or split the work into smaller tasks.",
      action: "employee",
    },
    "harness.model": {
      title: `${who(c)}'s model isn't available`,
      hint: "Pick another model in the bot's settings.",
      action: "employee",
    },
    "harness.no_response": {
      title: `${tool(c)} returned no answer`,
      hint: "Usually a sign-in or version problem. Run the CLI once in a terminal to check.",
      action: "harnesses",
    },
    "harness.launch": {
      title: `${tool(c)} could not start`,
      hint: "Check that it's installed and on your PATH.",
      action: "harnesses",
    },
    "harness.exit": {
      title: `${who(c)}'s run failed`,
      hint: "The harness exited with an error. The message below has the details.",
      action: "employee",
    },
    "actions.invalid_block": {
      title: `${who(c)} sent a board update anyBot couldn't read`,
      hint: "The bot's anybot-actions block wasn't valid. One-offs are harmless; repeats mean its instructions need tightening.",
    },
    "actions.rejected": {
      title: `${who(c)}'s board change was refused`,
      hint: "The coordinator rejected the action below, usually because the bot isn't an assignee or reviewer on that task.",
    },
    "delegation.rejected": {
      title: `A handoff from ${who(c)} was refused`,
      hint: "Bots can hand work to their reports, or to peers in a project with delegation on.",
    },
    "artifacts.not_collected": {
      title: `Files from ${who(c)} weren't collected`,
      hint: "The bot listed files anyBot couldn't accept (see below).",
    },
    "autopilot.start_failed": { title: "Autopilot couldn't start a task", hint: "The reason is below. The task stays in Backlog." },
    "task.settle_failed": { title: "A task didn't update after its run", hint: "This is a bug in anyBot.", bug: true },
    "update.failed": {
      title: "An update failed",
      hint: "Retry from Check for updates. If it keeps failing, copy the report.",
      action: "update",
    },
    "update.install_failed": {
      title: `The update to ${c.to || "a new version"} didn't install`,
      hint: "anyBot restarted on the old version. Try again, or run the installer from the update feed.",
      action: "update",
      bug: true,
    },
    "update.init_failed": { title: "Automatic updates are unavailable", hint: "The updater didn't start.", bug: true },
    "update.warning": { title: "The updater reported a warning", hint: "Usually harmless. Details are below." },
    "runtime.exited": {
      title: "The coordinator stopped unexpectedly",
      hint: "anyBot restarts it automatically. Repeats are a bug.",
      bug: true,
    },
    "runtime.stderr": { title: "The coordinator printed an error", hint: "Details are below.", bug: true },
    "command.failed": { title: "An action in the app failed unexpectedly", hint: "This is a bug in anyBot.", bug: true },
    "renderer.crash": { title: "A screen crashed", hint: "anyBot showed a recovery page. This is a bug.", bug: true },
    "renderer.error": { title: "A screen hit an error", hint: "This is a bug in anyBot.", bug: true },
    "renderer.rejection": { title: "A screen hit an error", hint: "This is a bug in anyBot.", bug: true },
    "renderer.markdown": {
      title: "A message couldn't be formatted",
      hint: "anyBot showed it as plain text instead. This is a bug.",
      bug: true,
    },
    "renderer.gone": { title: "The window's renderer stopped", hint: "anyBot reloaded the window.", bug: true },
    "renderer.load_failed": { title: "The window failed to load", hint: "This is a bug in anyBot.", bug: true },
    "main.exception": { title: "anyBot hit an internal error", hint: "This is a bug in anyBot.", bug: true },
    "main.rejection": { title: "anyBot hit an internal error", hint: "This is a bug in anyBot.", bug: true },
    "process.gone": { title: "A background process stopped", hint: "Details are below.", bug: true },
  };
  return table[issue.code] || { title: issue.code, hint: "" };
}

const ago = (value) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};
export { ago as issueAge };

// Plain-text report for pasting into a chat with Claude or a bug tracker.
export function issueReport(groups, { version = "" } = {}) {
  const lines = [`anyBot diagnostics (v${version}, ${new Date().toISOString()})`, ""];
  if (!groups.length) lines.push("No problems recorded.");
  for (const group of groups) {
    const { title } = describeIssue(group);
    lines.push(`- [${group.level}] ${group.code} x${group.count}, last ${group.last} (v${group.version}): ${title}`);
    if (group.message) lines.push(`  ${group.message}`);
    const context = Object.entries(group.context || {})
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    if (context) lines.push(`  ${context}`);
    if (group.detail) lines.push(...group.detail.split("\n").slice(0, 6).map((line) => `    ${line}`));
  }
  return lines.join("\n");
}
