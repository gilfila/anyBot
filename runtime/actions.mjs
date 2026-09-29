// Structured actions an employee can end its reply with. Harness CLIs have no
// live channel back into the coordinator, so, like delegation, actions are
// parsed from the finished output and validated before anything is applied.
export const ACTION_LIMIT = 20;
export const ACTION_TYPES = new Set([
  "task.create",
  "task.update",
  "task.claim",
  "doc.append",
  "doc.section",
  "memory.save",
  "memory.forget",
  "report",
  "review",
  "kg.fact",
]);
const BLOCK = /```anybot-actions\s*\n([\s\S]*?)\n```/g;

export function actionsFrom(output) {
  const blocks = [...String(output).matchAll(BLOCK)];
  if (!blocks.length) return null;
  if (blocks.length !== 1) throw new Error("Only one anybot-actions block per reply is allowed");
  let value;
  try {
    value = JSON.parse(blocks[0][1]);
  } catch {
    throw new Error("Invalid anybot-actions JSON");
  }
  const actions = Array.isArray(value) ? value : value?.actions;
  if (!Array.isArray(actions)) throw new Error("anybot-actions must be a JSON array of actions");
  if (actions.length > ACTION_LIMIT) throw new Error(`At most ${ACTION_LIMIT} actions per reply`);
  return actions.map((action) => {
    if (!action || typeof action !== "object" || Array.isArray(action))
      throw new Error("Each action must be a JSON object");
    if (!ACTION_TYPES.has(action.type))
      throw new Error(`Unknown action type ${String(action.type).slice(0, 40)}`);
    return action;
  });
}

// Strip action blocks from text shown to people; the applied results are
// reported separately as a coordinator notice.
export function withoutActions(output) {
  return String(output).replace(BLOCK, "").trimEnd();
}

// The action guide in every prompt. Tasks live on project boards, so a
// direct chat (one bot) gets the guide without task actions, and board.mjs
// refuses them there with NO_BOARD.
export const NO_BOARD =
  "This direct chat has no task board, so task actions are refused here: to hand work to another bot, delegate it (to your reports), or ask the owner to set up a project with those bots.";
const DOC_TYPES = `doc.append (markdown added to the end of the canvas), doc.section (heading plus markdown that replaces the content under that heading, or adds the section; don't repeat the heading in the markdown; markdown tables become canvas tables and a line that is only a link becomes a link card)`;
const TASK_TYPES = `task.create (lands in Backlog; optional description, priority none|low|medium|high|urgent, labels, assignees (ids of project members only), checklist as strings, parent task), task.update (task id plus any of status backlog|in_progress|review|done, comment, checklist [{item or index, done}], addChecklist [strings]), task.claim (take an unassigned Backlog task). Only assignees move their own tasks; when a task has a reviewer, stop at review.`;
const MEMORY_TYPES = `memory.save (body, scope private|team|project, optional tags: durable facts worth recalling next time, not a work log), memory.forget (id of one of your memories), report (summary for your manager; task work is summarised automatically if you skip this)`;
const REVIEW_TYPE = `review (only as a task's reviewer: task id, decision approve|changes, comment)`;
const KG_TYPE = `kg.fact (add to the shared knowledge graph: subject, relation, object, optional note; subject and object are names, or {"type":"decision","label":"..."}; names of bots, projects, and tasks link to those nodes, e.g. {"type":"kg.fact","subject":"Checkout redesign","relation":"depends on","object":"Stripe API v3"})`;

export function actionGuide({ board = true } = {}) {
  if (!board)
    return `Actions: to update the canvas (this chat's shared page), your memory, or the knowledge graph, end your reply with one fenced anybot-actions block containing a JSON array, for example
\`\`\`anybot-actions
[{"type":"doc.section","heading":"Decisions","markdown":"- Launch at $12/seat"}]
\`\`\`
Types: ${DOC_TYPES}, ${MEMORY_TYPES}, ${KG_TYPE}. ${NO_BOARD} Use actions only for real changes.`;
  return `Project actions: to update the board or the canvas (this conversation's shared page), end your reply with one fenced anybot-actions block containing a JSON array, for example
\`\`\`anybot-actions
[{"type":"task.update","task":"1a2b3c4d","status":"review","comment":"Built the page; tests pass","checklist":[{"item":"Write copy","done":true}]},
 {"type":"task.create","title":"Add pricing FAQ","description":"...","priority":"medium","assignees":["<employee id>"]},
 {"type":"doc.section","heading":"Decisions","markdown":"- Launch at $12/seat"}]
\`\`\`
Types: ${DOC_TYPES}, ${TASK_TYPES} ${MEMORY_TYPES}, ${REVIEW_TYPE}, ${KG_TYPE}. Use actions only for real changes.`;
}
export const ACTION_GUIDE = actionGuide();
