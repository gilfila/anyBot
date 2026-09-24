import test from "node:test";
import assert from "node:assert/strict";
import { asksQuestion, botAttention, pullRequestIn } from "../src/lib/attention.js";

const at = (minute) => `2026-09-24T10:${String(minute).padStart(2, "0")}:00.000Z`;
const reply = (body, minute = 5, extra = {}) => ({ id: `m${minute}`, conversation: "c1", author: "e1", kind: "assistant", body, created: at(minute), ...extra });

test("a closing question needs an answer; one mid-report doesn't", () => {
  assert.equal(asksQuestion("Draft is in site/pricing.\n\nShould I ship it to production now?"), true);
  assert.equal(asksQuestion("Which tier should be the default: Pro or Team?\n"), true);
  assert.equal(asksQuestion("Why did sign-ups dip? Churn from the old plan.\n\nThe page is live."), false);
  assert.equal(asksQuestion("Done.\n```js\nconst ok = a ? b : c?.d;\n```"), false);
  assert.equal(asksQuestion('Want me to continue?\n```anybot-actions\n[{"type":"task.update"}]\n```'), true);
  assert.equal(asksQuestion("Plan is ready.\n\n@Morgan can you build the pricing page?"), false, "a question to a teammate");
  assert.equal(asksQuestion("@Morgan is building it. Should I also draft the email?"), true, "an earlier mention doesn't hide a question to you");
});

test("pull request links are recognised on the common hosts", () => {
  assert.equal(pullRequestIn("Opened https://github.com/acme/site/pull/42 for review."), "https://github.com/acme/site/pull/42");
  assert.equal(pullRequestIn("MR: https://gitlab.com/acme/site/-/merge_requests/7"), "https://gitlab.com/acme/site/-/merge_requests/7");
  assert.equal(pullRequestIn("See https://github.com/acme/site/issues/3"), null);
});

test("the most urgent state wins, and replying clears questions and PRs", () => {
  const base = { approvals: [], runs: [], messages: [] };
  assert.equal(botAttention("e1", base), null);
  // Approval beats everything.
  assert.equal(botAttention("e1", { ...base, approvals: [{ employee: "e1", status: "pending" }], runs: [{ employee: "e1", status: "failed", created: at(1) }] }).kind, "approval");
  // A failed run, until dismissed.
  assert.equal(botAttention("e1", { ...base, runs: [{ employee: "e1", status: "failed", error: "Usage limit", created: at(1) }] }).kind, "error");
  assert.equal(botAttention("e1", { ...base, runs: [{ employee: "e1", status: "failed", created: at(1), dismissed: true }] }), null);
  // Working: nothing to do yet.
  assert.equal(botAttention("e1", { ...base, runs: [{ employee: "e1", status: "running", created: at(2) }], messages: [reply("Ready?")] }), null);
  // Question, then answered.
  const asked = { ...base, messages: [reply("I drafted two options. Which one do you prefer?")] };
  assert.equal(botAttention("e1", asked).kind, "question");
  const answered = { ...asked, messages: [...asked.messages, { conversation: "c1", author: "human", body: "Option B", created: at(9) }] };
  assert.equal(botAttention("e1", answered), null);
  // PR.
  assert.equal(botAttention("e1", { ...base, messages: [reply("PR is up: https://github.com/acme/site/pull/42")] }).kind, "pr");
  // Plain finished reply: only while unread.
  assert.equal(botAttention("e1", { ...base, messages: [reply("All done.")] }), null);
  assert.equal(botAttention("e1", { ...base, messages: [reply("All done.")] }, { unread: true }).kind, "done");
  // Handoffs and notices aren't replies to you.
  assert.equal(botAttention("e1", { ...base, messages: [reply("Can you take this?", 5, { kind: "handoff" })] }), null);
});
