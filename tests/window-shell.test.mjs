import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { contextMenuItems, navigationTarget } = require("../desktop/window-shell.cjs");
const isWebUrl = (url) => /^https?:\/\//.test(url);
const roles = (items) => items.map((item) => item.role || item.action || item.type || item.label);

test("a text field gets Cut, Copy, Paste and Select all, enabled by what the field allows", () => {
  const items = contextMenuItems(
    { isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } },
    isWebUrl,
  );
  assert.deepEqual(roles(items), ["cut", "copy", "paste", "separator", "selectAll"]);
  assert.deepEqual(
    items.filter((item) => item.role).map((item) => item.enabled),
    [false, false, true, true],
  );
});

test("selected text outside a field gets Copy; nothing selected gets no menu", () => {
  assert.deepEqual(roles(contextMenuItems({ selectionText: "hello", editFlags: { canCopy: true } }, isWebUrl)), ["copy"]);
  assert.deepEqual(contextMenuItems({ selectionText: "   " }, isWebUrl), []);
  assert.deepEqual(contextMenuItems({}, isWebUrl), []);
});

test("web links offer Open in browser and Copy link address; other links don't", () => {
  const items = contextMenuItems({ linkURL: "https://example.com/a", selectionText: "a" }, isWebUrl);
  assert.deepEqual(roles(items), ["openLink", "copyLink", "separator", "copy"]);
  assert.equal(items[0].value, "https://example.com/a");
  assert.deepEqual(roles(contextMenuItems({ linkURL: "file:///C:/Windows/system32/calc.exe" }, isWebUrl)), []);
  assert.deepEqual(roles(contextMenuItems({ linkURL: "javascript:alert(1)" }, isWebUrl)), []);
});

test("a misspelled word in a field lists up to five suggestions first", () => {
  const items = contextMenuItems(
    {
      isEditable: true,
      misspelledWord: "teh",
      dictionarySuggestions: ["the", "ten", "tea", "tech", "tee", "tent"],
      editFlags: { canPaste: true },
    },
    isWebUrl,
  );
  assert.deepEqual(
    items.slice(0, 5).map((item) => [item.action, item.value]),
    ["the", "ten", "tea", "tech", "tee"].map((word) => ["replace", word]),
  );
  assert.equal(items[5].type, "separator");
  const none = contextMenuItems({ isEditable: true, misspelledWord: "zzq", dictionarySuggestions: [] }, isWebUrl);
  assert.deepEqual(none[0], { label: "No spelling suggestions", enabled: false });
});

test("a notification's target keeps only well-formed ids", () => {
  assert.deepEqual(navigationTarget({ approval: "a-1", conversation: "c-1", run: "r-1", extra: "x" }), {
    approval: "a-1",
    conversation: "c-1",
    run: "r-1",
  });
  assert.deepEqual(navigationTarget({ conversation: "../../etc", run: 7, thread: "t".repeat(101) }), null);
  assert.equal(navigationTarget(null), null);
  assert.equal(navigationTarget("c-1"), null);
});
