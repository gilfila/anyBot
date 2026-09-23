import test from "node:test";
import assert from "node:assert/strict";
import {
  backspaceBlock,
  changeType,
  filterSlash,
  mergeBlocks,
  shortcutFor,
  splitBlock,
} from "../src/components/doc/blocks.js";

const b = (id, type, text = "") => ({ id, type, text });

test("markdown shortcuts map to block types", () => {
  assert.equal(shortcutFor("#"), "h1");
  assert.equal(shortcutFor("###"), "h3");
  assert.equal(shortcutFor("-"), "bullet");
  assert.equal(shortcutFor("1."), "number");
  assert.equal(shortcutFor("[]"), "todo");
  assert.equal(shortcutFor(">"), "quote");
  assert.equal(shortcutFor("---"), "divider");
  assert.equal(shortcutFor("hello"), null);
});

test("slash menu filters by label and keywords", () => {
  assert.equal(filterSlash("").length > 10, true);
  assert.deepEqual(filterSlash("head").map((i) => i.type), ["h1", "h2", "h3"]);
  assert.ok(filterSlash("checkbox").some((i) => i.type === "todo"));
  assert.equal(filterSlash("task")[0].type, "task");
  assert.equal(filterSlash("to")[0].type, "todo");
});

test("Enter splits text and continues lists; Enter on an empty item exits the list", () => {
  let result = splitBlock([b("a", "p", "Hello world")], 0, 5);
  assert.deepEqual(result.blocks.map((x) => x.text), ["Hello", " world"]);
  assert.equal(result.blocks[1].type, "p");
  result = splitBlock([b("a", "bullet", "item")], 0, 4);
  assert.equal(result.blocks[1].type, "bullet");
  result = splitBlock([b("a", "bullet", "")], 0, 0);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, "p");
});

test("Backspace turns styled blocks into text, then merges into the previous block", () => {
  let result = backspaceBlock([b("a", "p", "One"), b("b", "h2", "Two")], 1);
  assert.equal(result.blocks[1].type, "p");
  result = backspaceBlock(result.blocks, 1);
  assert.deepEqual(result.blocks.map((x) => x.text), ["OneTwo"]);
  assert.equal(result.caret, 3);
  assert.equal(backspaceBlock([b("a", "p", "x")], 0), null);
  result = backspaceBlock([b("d", "divider"), b("e", "p", "")], 1);
  assert.deepEqual(result.blocks.map((x) => x.id), ["d"]);
});

test("switching to an embed keeps a text block after it", () => {
  const next = changeType([b("a", "p", "/task")], 0, "task", { ref: "12345678" });
  assert.deepEqual(next.map((x) => x.type), ["task", "p"]);
  assert.equal(next[0].ref, "12345678");
});

test("conflict merge keeps remote order, local edits, local deletes, and local inserts", () => {
  const remote = [b("h", "h1", "Plan"), b("x", "p", "agent edit"), b("y", "p", "agent new"), b("z", "p", "remove me")];
  const local = [b("h", "h1", "Plan (owner)"), b("x", "p", "agent edit"), b("n", "p", "owner new")];
  const merged = mergeBlocks(remote, local, new Set(["h", "n"]), new Set(["z"]));
  assert.deepEqual(merged.map((x) => x.text), ["Plan (owner)", "agent edit", "owner new", "agent new"]);
});
