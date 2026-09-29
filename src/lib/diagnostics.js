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
// names a button the panel can offer; `bug` marks problems in Any Bot itself.
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
    "harness.output_limit": {
      title: `${who(c)}'s run printed too much and was stopped`,
      hint: "The harness printed more than 256 MB in one run, which usually means it was stuck in a loop. Open the run's terminal in Activity to see what it repeated, then send the task again in smaller steps.",
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
      title: `${who(c)} sent a board update Any Bot couldn't read`,
      hint: "The bot's anybot-actions block wasn't valid. One-offs are harmless; repeats mean its instructions need tightening.",
    },
    "actions.rejected": {
      title: `${who(c)}'s board change was refused`,
      hint: "The coordinator rejected the action below, usually because the bot isn't an assignee or reviewer on that task.",
    },
    "delegation.rejected": {
      title: `A handoff from ${who(c)} was refused`,
      hint: "Bots can hand work to their reports, or to teammates in the same project.",
    },
    "artifacts.not_collected": {
      title: `Files from ${who(c)} weren't collected`,
      hint: "The bot listed files Any Bot couldn't accept (see below).",
    },
    "artifacts.copy_failed": {
      title: "Files couldn't be copied to a project's Artifacts folder",
      hint: "The bot's files were collected and are in the chat, but Any Bot couldn't write them into the project's Artifacts folder, usually because the folder was moved or deleted or is read-only. Edit the project and pick the folder again.",
    },
    "autopilot.start_failed": {
      title: "Autopilot couldn't start a task",
      hint: "The reason is below and on the task. The task stays in Backlog, and Autopilot skips it (and goes on with the bot's other tasks) until the task changes; it tries again every 10 minutes without repeating this note.",
    },
    "autopilot.limit_reached": {
      title: "Autopilot turned itself off",
      hint: "The bots in this project started 20 tasks they created for themselves in 24 hours, so Autopilot stopped to keep them from running without end. Check the board, then turn Autopilot back on if the work should go on.",
    },
    "task.settle_failed": { title: "A task didn't update after its run", hint: "This is a bug in Any Bot.", bug: true },
    "update.failed": {
      title: "An update failed",
      hint: "Retry from Check for updates. If it keeps failing, copy the report.",
      action: "update",
    },
    "update.install_failed": {
      title: `The update to ${c.to || "a new version"} didn't install`,
      hint: "Any Bot restarted on the old version. Try again, or run the installer from the update feed.",
      action: "update",
      bug: true,
    },
    "update.init_failed": { title: "Automatic updates are unavailable", hint: "The updater didn't start.", bug: true },
    "update.warning": { title: "The updater reported a warning", hint: "Usually harmless. Details are below." },
    "update.offline": {
      title: "Couldn't check for updates while offline",
      hint: "Nothing to fix: the check runs again a few minutes later, and Check now works any time.",
    },
    "update.idle_install_failed": {
      title: "The update didn't install when the team finished",
      hint: "Any Bot was waiting for the bots to finish before restarting. Restart from the update button in Settings.",
      action: "update",
    },
    "mobile.audit_quarantined": {
      title: "The phone access log was damaged and set aside",
      hint: "Usually after a power cut. A new log started and phones connect as before; the old file is kept next to it (mobile-audit.jsonl.corrupt-…) in the data folder.",
    },
    "mobile.config_invalid": {
      title: "mobile-access.json couldn't be used",
      hint: "The HTTPS phone listener it sets up is off; phones paired by QR code still connect. Settings → Mobile companion shows why. Fix the file (docs/mobile.md) and restart Any Bot.",
    },
    "mobile.start_failed": {
      title: "Phones can't connect",
      hint: "The phone gateway didn't start. Settings → Your phone shows why. This is a bug in Any Bot if it keeps happening.",
      bug: true,
    },
    "harness.stuck_cancel": {
      title: `${tool(c)} didn't stop cleanly for ${who(c)}`,
      hint: "Any Bot marked the run stopped and freed the bot. A helper process the harness started may still be running; it ends when you restart the computer.",
    },
    "run.interrupted": {
      title: "Work was cut off when Any Bot stopped",
      hint: "Bots were working when Any Bot quit, updated, or crashed. Each conversation has a notice, bots that handed off that work were told, and tasks got a note. Check for half-finished changes before starting the work again.",
    },
    "run.reconcile_failed": {
      title: "Cut-off work couldn't be followed up",
      hint: "Any Bot marked the runs that were cut off when it stopped, but couldn't post notices or tell the bots that handed them the work. Check recent conversations by hand. This is a bug in Any Bot.",
      bug: true,
    },
    "runtime.exited": {
      title: "The coordinator stopped unexpectedly",
      hint: "Any Bot restarts it automatically. Repeats are a bug.",
      bug: true,
    },
    "runtime.stderr": { title: "The coordinator printed an error", hint: "Details are below.", bug: true },
    "command.failed": { title: "An action in the app failed unexpectedly", hint: "This is a bug in Any Bot.", bug: true },
    "renderer.crash": { title: "A screen crashed", hint: "Any Bot showed a recovery page. This is a bug.", bug: true },
    "renderer.error": { title: "A screen hit an error", hint: "This is a bug in Any Bot.", bug: true },
    "renderer.rejection": { title: "A screen hit an error", hint: "This is a bug in Any Bot.", bug: true },
    "renderer.markdown": {
      title: "A message couldn't be formatted",
      hint: "Any Bot showed it as plain text instead. This is a bug.",
      bug: true,
    },
    "avatar.render_failed": {
      title: "The 3D bots stopped drawing",
      hint: "They showed as icons for a moment and redraw by themselves. If they stay icons, restart Any Bot.",
    },
    "attachment.missing": {
      title: "An attachment couldn't be delivered",
      hint: "A file or folder you attached was moved or deleted before the bot started. The bot was told which one; attach it again if it still needs it.",
    },
    "project.folder_missing": {
      title: "A project's allowed folder can't be found",
      hint: "One or more of the project's Allowed folders doesn't exist (or isn't a full path), so bots weren't given access to it. Edit the project and pick the folder again, or remove it.",
    },
    "artifact.stage_failed": {
      title: `Earlier files couldn't be handed to ${who(c)}`,
      hint: "Any Bot couldn't copy some of this conversation's earlier artifacts into the bot's inbox (.anybot-inbox), usually because a stored copy was removed. The bot ran anyway and was told which files are missing.",
    },
    "attachment.copy_failed": {
      title: "Attachments couldn't be copied to a bot",
      hint: "Any Bot couldn't write into the bot's workspace inbox (.anybot-inbox). Check the bot's workspace folder exists and isn't read-only.",
    },
    "files.refused": {
      title: "A file link was blocked",
      hint: "Any Bot refused to open, show, or preview a path from a message (the reason is below). Network paths, devices, files that can run programs, and folders whose shortcuts point to a network location are never opened from a link.",
    },
    "files.request_blocked": {
      title: "The window was stopped from loading a file",
      hint: "Something shown in the app (usually HTML a bot wrote) tried to load a file from outside Any Bot, or from a network location, which could send your Windows sign-in to another computer. Any Bot blocked it; nothing was loaded.",
    },
    "files.open_failed": {
      title: "A file from chat couldn't be opened",
      hint: "Windows couldn't open it with its default app. Check that an app is installed for this type of file, or use Show in folder.",
    },
    "renderer.gone": {
      title: "The window's renderer stopped",
      hint: c.reloaded === false
        ? "It kept stopping, so Any Bot stopped reloading it. Your bots kept working; restart Any Bot to reopen the window."
        : "Any Bot reloaded the window. Your bots, Slack and the phone link kept working.",
      bug: true,
    },
    "renderer.load_failed": { title: "The window failed to load", hint: "This is a bug in Any Bot.", bug: true },
    "main.exception": { title: "Any Bot hit an internal error", hint: "This is a bug in Any Bot.", bug: true },
    "main.rejection": { title: "Any Bot hit an internal error", hint: "This is a bug in Any Bot.", bug: true },
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

// What an issue's context points at that still exists, for the panel's
// jump buttons: its run (terminal and conversation), else its conversation,
// its task, and its bot (a direct chat). Ids come from the log; only rows in
// the snapshot count.
export function issueTargets(context = {}, { runs = [], conversations = [], tasks = [], employees = [] } = {}) {
  const run = context.run && runs.find((r) => r.id === context.run);
  const conversationId = run?.conversation || context.conversation;
  const conversation = conversationId && conversations.find((c) => c.id === conversationId);
  const task = context.task && tasks.find((t) => t.id === context.task);
  const bot = context.employeeId && employees.find((e) => e.id === context.employeeId && !e.archived);
  return {
    run: run?.id || null,
    conversation: conversation ? { id: conversation.id, title: conversation.title } : null,
    task: task ? { id: task.id, title: task.title } : null,
    bot: bot || null,
  };
}

// Plain-text report for pasting into a chat with Claude or a bug tracker.
export function issueReport(groups, { version = "" } = {}) {
  const lines = [`Any Bot diagnostics (v${version}, ${new Date().toISOString()})`, ""];
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
