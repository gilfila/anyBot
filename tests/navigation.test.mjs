import test from "node:test";
import assert from "node:assert/strict";
import { attentionTarget, resolveTarget } from "../src/lib/navigation.js";
import { botAttention } from "../src/lib/attention.js";

const at = (minute) => `2026-09-24T10:${String(minute).padStart(2, "0")}:00.000Z`;
const data = {
  conversations: [
    { id: "dm", members: ["e1"] },
    { id: "proj", members: ["e1", "e2"] },
  ],
  messages: [
    { id: "ask", conversation: "proj", author: "human", body: "@Nova do it", created: at(1) },
    { id: "reply", conversation: "proj", author: "e1", thread: "ask", body: "Done.", created: at(3) },
    { id: "top", conversation: "proj", author: "e2", body: "Channel note", created: at(4) },
    { id: "hello", conversation: "dm", author: "e1", body: "Hi", created: at(2) },
  ],
  tasks: [{ id: "t1", conversation: "proj", title: "Ship" }],
  runs: [
    { id: "r-thread", employee: "e1", conversation: "proj", thread: "ask", task: "t1", message: "ask", response: "reply" },
    { id: "r-task", employee: "e2", conversation: "proj", thread: null, task: "t1", message: "ask" },
    { id: "r-dm", employee: "e1", conversation: "dm", thread: null, task: null, message: "hello" },
    { id: "r-orphan", employee: "e1", conversation: "deleted", message: "gone" },
  ],
  approvals: [{ id: "a1", run: "r-thread", conversation: "proj", employee: "e1", status: "pending" }],
};

test("a run opens its thread (over its task) and its reply", () => {
  assert.deepEqual(resolveTarget({ run: "r-thread" }, data), {
    view: "chat",
    conversation: "proj",
    thread: "ask",
    task: null,
    message: "reply",
  });
  // No thread: the task on the board, with the message it was started from.
  assert.deepEqual(resolveTarget({ run: "r-task" }, data), { view: "chat", conversation: "proj", thread: null, task: "t1", message: "ask" });
});

test("direct chats have no threads or board; a run whose conversation is gone opens its terminal", () => {
  assert.deepEqual(resolveTarget({ run: "r-dm", task: "t1" }, data), { view: "chat", conversation: "dm", thread: null, task: null, message: "hello" });
  assert.deepEqual(resolveTarget({ run: "r-orphan" }, data), { view: "work", run: "r-orphan" });
  assert.equal(resolveTarget({ run: "nope" }, data), null);
  assert.equal(resolveTarget({ conversation: "deleted" }, data), null);
  assert.equal(resolveTarget(null, data), null);
});

test("an approval, a task, or a message alone finds its conversation", () => {
  assert.deepEqual(resolveTarget({ approval: "a1" }, data), { view: "chat", conversation: "proj", thread: "ask", task: null, message: "reply" });
  assert.deepEqual(resolveTarget({ task: "t1" }, data), { view: "chat", conversation: "proj", thread: null, task: "t1", message: null });
  // A reply inside a thread opens that thread; a channel message doesn't.
  assert.deepEqual(resolveTarget({ message: "reply" }, data), { view: "chat", conversation: "proj", thread: "ask", task: null, message: "reply" });
  assert.deepEqual(resolveTarget({ message: "top" }, data), { view: "chat", conversation: "proj", thread: null, task: null, message: "top" });
});

test("ids from another conversation are dropped, not followed", () => {
  assert.deepEqual(resolveTarget({ conversation: "dm", thread: "ask", message: "reply" }, data), {
    view: "chat",
    conversation: "dm",
    thread: null,
    task: null,
    message: null,
  });
  assert.deepEqual(resolveTarget({ conversation: "proj", thread: "hello", task: "missing" }, data), {
    view: "chat",
    conversation: "proj",
    thread: null,
    task: null,
    message: null,
  });
});

test("a sidebar bot's attention says where it is", () => {
  const approval = botAttention("e1", data);
  assert.equal(approval.kind, "approval");
  assert.deepEqual(attentionTarget(approval), { approval: "a1", run: "r-thread", conversation: "proj" });
  const failed = botAttention("e2", { runs: [{ id: "r9", employee: "e2", status: "failed", conversation: "proj", created: at(5) }] });
  assert.deepEqual(attentionTarget(failed), { run: "r9", conversation: "proj" });
  const question = botAttention("e1", {
    messages: [{ id: "q", conversation: "proj", thread: "ask", author: "e1", kind: "assistant", body: "Ship it now?", created: at(6) }],
  });
  assert.deepEqual(attentionTarget(question), { conversation: "proj", message: "q" });
  assert.deepEqual(resolveTarget(attentionTarget(question), { ...data, messages: [...data.messages, { id: "q", conversation: "proj", thread: "ask" }] }), {
    view: "chat",
    conversation: "proj",
    thread: "ask",
    task: null,
    message: "q",
  });
  // "Done" stays with the direct chat's unread reply.
  assert.equal(attentionTarget({ kind: "done", conversation: "proj", message: "q" }), null);
  assert.equal(attentionTarget(null), null);
});
