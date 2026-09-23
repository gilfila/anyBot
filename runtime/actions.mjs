// Structured actions an employee can end its reply with. Harness CLIs have no
// live channel back into the coordinator, so, like delegation, actions are
// parsed from the finished output and validated before anything is applied.
export const ACTION_LIMIT = 20;
export const ACTION_TYPES = new Set(["task.create", "task.update", "task.claim", "doc.append", "doc.section"]);
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

export const ACTION_GUIDE = `Project actions: to update the project board or doc, end your reply with one fenced anybot-actions block containing a JSON array, for example
\`\`\`anybot-actions
[{"type":"task.update","task":"1a2b3c4d","status":"review","comment":"Built the page; tests pass","checklist":[{"item":"Write copy","done":true}]},
 {"type":"task.create","title":"Add pricing FAQ","description":"...","priority":"medium","assignees":["<employee id>"]},
 {"type":"doc.section","heading":"Decisions","markdown":"- Launch at $12/seat"}]
\`\`\`
Types: doc.append (markdown added to the end of the project doc), doc.section (heading plus markdown that replaces the content under that heading, or adds the section), task.create (lands in Backlog; optional description, priority none|low|medium|high|urgent, labels, assignees from the project, checklist as strings, parent task), task.update (task id plus any of status backlog|in_progress|review|done, comment, checklist [{item or index, done}], addChecklist [strings]), task.claim (take an unassigned Backlog task). Only assignees move their own tasks; when a task has a reviewer, stop at review. Use actions only for real changes.`;
