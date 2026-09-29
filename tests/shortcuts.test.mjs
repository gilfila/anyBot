import test from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS, nextApproval, shortcutFor, shortcutKeys } from "../src/lib/shortcuts.js";

const key = (k, extra = {}) => ({ key: k, ctrlKey: true, ...extra });

test("Ctrl+K, Ctrl+B and Ctrl+Shift+A map to their actions; ⌘ works too", () => {
  assert.equal(shortcutFor(key("k")), "search");
  assert.equal(shortcutFor(key("K")), "search");
  assert.equal(shortcutFor({ key: "k", metaKey: true }), "search");
  assert.equal(shortcutFor(key("b")), "sidebar");
  assert.equal(shortcutFor(key("A", { shiftKey: true })), "approval");
});

test("editing keys, AltGr and bare letters are left alone", () => {
  for (const k of ["a", "c", "v", "x", "z", "r", "w", "Enter"]) assert.equal(shortcutFor(key(k)), null, k);
  assert.equal(shortcutFor(key("k", { altKey: true })), null, "AltGr+K");
  assert.equal(shortcutFor(key("K", { shiftKey: true })), null);
  assert.equal(shortcutFor({ key: "k" }), null);
  assert.equal(shortcutFor(null), null);
});

test("every listed shortcut has keys; the approval jump steps through the queue oldest first", () => {
  assert.ok(SHORTCUTS.every((item) => item.keys && item.label));
  assert.equal(shortcutKeys("search"), "Ctrl+K");
  const approvals = [
    { id: "b", status: "pending", created: "2026-09-29T10:02:00Z" },
    { id: "done", status: "allowed", created: "2026-09-29T09:00:00Z" },
    { id: "a", status: "pending", created: "2026-09-29T10:01:00Z" },
  ];
  assert.equal(nextApproval(approvals).id, "a");
  assert.equal(nextApproval(approvals, "a").id, "b");
  assert.equal(nextApproval(approvals, "b").id, "a");
  assert.equal(nextApproval([{ id: "x", status: "denied" }]), null);
});
