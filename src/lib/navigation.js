// Where a jump inside the app lands. Pages hand App a target of ids
// ({ conversation, thread, task, run, approval, message }, any subset) and
// App opens what this resolves from its snapshot. Pure, so node:test can run
// it (tests/navigation.test.mjs).
//
// Returns { view: "chat", conversation, thread, task, message } with at most
// one of thread and task (a run's thread wins over its task, and a message
// inside a thread opens that thread), { view: "work", run } when a run's
// conversation is gone (its terminal in Activity is all that's left), or
// null when nothing in the target still exists.
export function resolveTarget(target, { conversations = [], runs = [], tasks = [], messages = [], approvals = [] } = {}) {
  if (!target || typeof target !== "object") return null;
  const approval = target.approval ? approvals.find((a) => a.id === target.approval) : null;
  const runId = target.run || approval?.run;
  const run = runId ? runs.find((r) => r.id === runId) : null;
  const explicitTask = target.task ? tasks.find((t) => t.id === target.task) : null;
  const explicitMessage = target.message ? messages.find((m) => m.id === target.message) : null;
  const conversationId =
    target.conversation || approval?.conversation || run?.conversation || explicitTask?.conversation || explicitMessage?.conversation;
  const conversation = conversationId && conversations.find((c) => c.id === conversationId);
  if (!conversation) return run ? { view: "work", run: run.id } : null;
  const project = conversation.members.length > 1;
  const inHere = (id, list) => (id ? list.find((item) => item.id === id && item.conversation === conversation.id) || null : null);
  const message = inHere(target.message || run?.response || run?.message, messages);
  // Direct chats are one linear thread and have no board.
  let thread = project ? inHere(target.thread || run?.thread, messages)?.id || null : null;
  if (project && !thread && message?.thread) thread = message.thread;
  const task = project && !thread ? inHere(target.task || run?.task, tasks)?.id || null : null;
  return { view: "chat", conversation: conversation.id, thread, task, message: message?.id || null };
}

// A sidebar bot's attention (src/lib/attention.js) as a target: where the
// approval, failed run, question or pull request is.
export function attentionTarget(attention) {
  if (!attention || attention.kind === "done") return null;
  const { approval, run, conversation, message } = attention;
  const target = Object.fromEntries(Object.entries({ approval, run, conversation, message }).filter(([, value]) => value));
  return Object.keys(target).length ? target : null;
}
