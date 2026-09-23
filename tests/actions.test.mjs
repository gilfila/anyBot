import test from "node:test";
import assert from "node:assert/strict";
import { ACTION_LIMIT, actionsFrom, withoutActions } from "../runtime/actions.mjs";

const block = (json) => `Done.\n\n\`\`\`anybot-actions\n${json}\n\`\`\``;

test("replies without an action block have no actions", () => {
  assert.equal(actionsFrom("Just prose, no block."), null);
});

test("an action block parses as a list of typed actions", () => {
  const actions = actionsFrom(block('[{"type":"task.update","task":"abc12345","status":"review"}]'));
  assert.deepEqual(actions, [{ type: "task.update", task: "abc12345", status: "review" }]);
  assert.equal(actionsFrom(block('{"actions":[{"type":"task.claim","task":"abc123"}]}')).length, 1);
});

test("malformed, oversized, duplicate, or unknown action blocks are rejected", () => {
  assert.throws(() => actionsFrom(block("{not json")), /Invalid anybot-actions JSON/);
  assert.throws(() => actionsFrom(block('{"type":"task.claim"}')), /JSON array/);
  assert.throws(() => actionsFrom(block('[{"type":"memory.wipe"}]')), /Unknown action type/);
  assert.throws(() => actionsFrom(block("[1]")), /JSON object/);
  const many = JSON.stringify(Array.from({ length: ACTION_LIMIT + 1 }, () => ({ type: "task.claim", task: "abcdef" })));
  assert.throws(() => actionsFrom(block(many)), /At most/);
  assert.throws(() => actionsFrom(block("[]") + "\n" + block("[]")), /Only one/);
});

test("action blocks are removed from the visible reply", () => {
  assert.equal(withoutActions(block("[]")), "Done.");
});
