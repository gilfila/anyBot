// What a bot needs from you, shown as an icon beside its name in the
// sidebar. The first state that applies wins:
//   approval  a risky action is waiting for Approve or Decline
//   error     its latest run failed or was interrupted (until dismissed)
//   question  its latest reply ends by asking you something
//   pr        its latest reply links a pull request to review
//   done      it finished and you haven't read the reply yet
// A question or PR only counts while the bot has the last word in that
// conversation: once you reply, it's handled.
const PR_URL = /https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org)\/[^\s)>\]]+?\/(?:pull|merge_requests|pull-requests)\/\d+/i;
const ACTION_BLOCK = /```(?:anybot|anybot-actions|anybot-artifacts)[\s\S]*?```/g;
const CODE_BLOCK = /```[\s\S]*?```/g;

// Does the reply end by asking the owner something? Only the closing lines
// count: a question in the middle of a report doesn't need an answer.
export function asksQuestion(body) {
  const prose = String(body || "")
    .replace(ACTION_BLOCK, "")
    .replace(CODE_BLOCK, "")
    .trim();
  const tail = prose.split(/\n+/).filter((line) => line.trim()).slice(-2).join(" ").slice(-280);
  return /\?\s*["')\]*_]*\s*$/.test(tail) || /\?[^.!?]*$/.test(tail.slice(-120));
}
export const pullRequestIn = (body) => String(body || "").match(PR_URL)?.[0] || null;

// [full label for the tooltip and screen readers, short line for the sidebar]
const LABELS = {
  approval: ["Needs your approval", "Needs approval"],
  error: ["Last run failed", "Run failed"],
  question: ["Waiting for your answer", "Has a question"],
  pr: ["Pull request ready for review", "PR ready"],
  done: ["Finished: new reply", "Done"],
};

export function botAttention(employeeId, { approvals = [], runs = [], messages = [] } = {}, { unread = false } = {}) {
  const make = (kind, extra = {}) => ({ kind, label: LABELS[kind][0], short: LABELS[kind][1], ...extra });
  if (approvals.some((a) => a.status === "pending" && a.employee === employeeId)) return make("approval");
  const latest = (list) => list.reduce((best, item) => (!best || String(item.created) > String(best.created) ? item : best), null);
  const run = latest(runs.filter((r) => r.employee === employeeId));
  if (run && ["failed", "interrupted"].includes(run.status) && !run.dismissed) return make("error", { detail: run.error || "" });
  if (run && ["queued", "running", "cancelling"].includes(run.status)) return null;
  const reply = latest(messages.filter((m) => m.author === employeeId && (m.kind === "assistant" || !m.kind)));
  if (!reply) return null;
  const answered = messages.some((m) => m.conversation === reply.conversation && m.author === "human" && String(m.created) > String(reply.created));
  if (!answered) {
    if (asksQuestion(reply.body)) return make("question", { conversation: reply.conversation });
    const url = pullRequestIn(reply.body);
    if (url) return make("pr", { url, conversation: reply.conversation });
  }
  return unread ? make("done", { conversation: reply.conversation }) : null;
}
