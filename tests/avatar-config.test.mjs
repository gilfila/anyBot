import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAvatarConfig,
  stringifyAvatarConfig,
  employeeAvatarStates,
  avatarPose,
} from "../src/lib/avatar-config.js";

test("saved legacy avatars migrate to the approved models and Pulse palette", () => {
  assert.deepEqual(
    parseAvatarConfig('{"color":"lavender","shape":"bubble","face":"oval"}'),
    { version: 2, color: "violet", shape: "orbit", face: "open" },
  );
  assert.deepEqual(
    parseAvatarConfig('{"color":"blue","shape":"square","face":"led"}'),
    { version: 2, color: "cobalt", shape: "tinker", face: "focused" },
  );
  for (const shape of ["scout", "orbit", "tinker"]) {
    const saved = stringifyAvatarConfig({
      color: "citron",
      shape,
      face: "bright",
    });
    assert.deepEqual(parseAvatarConfig(saved), {
      version: 2,
      color: "citron",
      shape,
      face: "bright",
    });
  }
});
test("malformed or unknown avatar settings have stable safe defaults", () => {
  for (const value of [
    null,
    "not json",
    "null",
    "[]",
    '{"color":"__proto__","shape":"bogus","face":"constructor"}',
  ]) {
    const config = parseAvatarConfig(value, "Sam", "codex");
    assert.equal(config.color, "cobalt");
    assert.ok(["scout", "orbit", "tinker"].includes(config.shape));
    assert.equal(config.face, "open");
  }
});
const employees = [
  { id: "a" },
  { id: "b" },
  { id: "archived", archived: true },
];
const messages = [
  { id: "human", conversation: "group", author: "human", kind: "user" },
  { id: "answer", conversation: "group", author: "a", kind: "assistant" },
  { id: "system", conversation: "group", author: "system", kind: "notice" },
  { id: "handoff", conversation: "group", author: "b", kind: "handoff" },
];
test("only the author of an unread final reply waves, including group conversations", () => {
  assert.deepEqual(
    employeeAvatarStates({ employees, messages }, { group: "human" }),
    { a: "unread", b: "idle", archived: "idle" },
  );
  assert.equal(
    employeeAvatarStates({ employees, messages }, { group: "answer" }).a,
    "idle",
  );
  assert.equal(
    employeeAvatarStates({ employees, messages }, {}, "group").a,
    "idle",
  );
  // A last-seen owner message must not be filtered out before finding the cursor.
  assert.equal(
    employeeAvatarStates(
      {
        employees,
        messages: [
          ...messages,
          {
            id: "owner-new",
            conversation: "group",
            author: "human",
            kind: "user",
          },
        ],
      },
      { group: "owner-new" },
    ).a,
    "idle",
  );
});
test("active work wins over queued work and unread replies; failures do not celebrate", () => {
  const snapshot = { employees, messages };
  for (const status of ["queued", "cancelling", "failed", "cancelled"]) {
    assert.equal(
      employeeAvatarStates({ ...snapshot, runs: [{ employee: "a", status }] })
        .a,
      "idle",
    );
  }
  assert.equal(
    employeeAvatarStates({
      ...snapshot,
      runs: [{ employee: "a", status: "succeeded" }],
    }).a,
    "unread",
  );
  assert.equal(
    employeeAvatarStates({
      ...snapshot,
      runs: [
        { employee: "a", status: "running" },
        { employee: "a", status: "queued" },
      ],
    }).a,
    "working",
  );
  assert.equal(
    employeeAvatarStates({
      ...snapshot,
      runs: [{ employee: "archived", status: "running" }],
    }).archived,
    "idle",
  );
});
test("activity poses use 30 degrees idle, an away-facing screen at work, and a front-facing wave", () => {
  assert.ok(Math.abs((avatarPose("idle").yaw * 180) / Math.PI + 30) < 1e-9);
  assert.ok(
    Math.abs(avatarPose("working").yaw) > Math.abs(avatarPose("idle").yaw),
  );
  assert.equal(avatarPose("working").hologram, 1);
  assert.deepEqual(avatarPose("unread"), { yaw: 0, hologram: 0, wave: true });
});
