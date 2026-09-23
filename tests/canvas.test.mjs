import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blocksToMarkdown, markdownToBlocks, normalizeBlocks, tableCells as runtimeCells } from "../runtime/docs.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";
import {
  CANVAS_TEMPLATES,
  blankBlock,
  changeType,
  fromTemplate,
  hostOf,
  linksFromMessages,
  savable,
  tableOps,
} from "../src/components/doc/blocks.js";
import { TABLE_ROW, TABLE_RULE, tableCells } from "../src/lib/markdown.js";

test("markdown tables and link-only lines become table and link blocks, and round-trip", () => {
  const markdown = [
    "## Tracker",
    "| Item | Owner | Link |",
    "|---|:---:|---|",
    String.raw`| Pricing \| FAQ | Sol | [spec](https://x.dev/spec) |`,
    "| Launch | Mira |",
    "",
    "[Pricing research](https://example.com/research)",
    "https://linear.app/team/issue/1",
    "Inline https://a.example/b stays a paragraph",
  ].join("\n");
  const blocks = normalizeBlocks(markdownToBlocks(markdown, "e1"));
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["h2", "table", "link", "link", "p"],
  );
  assert.deepEqual(blocks[1].rows, [
    ["Item", "Owner", "Link"],
    ["Pricing | FAQ", "Sol", "[spec](https://x.dev/spec)"],
    ["Launch", "Mira", ""],
  ]);
  assert.equal(blocks[1].author, "e1");
  assert.deepEqual([blocks[2].text, blocks[2].url], ["Pricing research", "https://example.com/research"]);
  assert.deepEqual([blocks[3].text, blocks[3].url], ["", "https://linear.app/team/issue/1"]);
  const back = blocksToMarkdown(blocks);
  assert.match(back, /\| Pricing \\\| FAQ \| Sol \|/);
  assert.match(back, /\| --- \| --- \| --- \|/);
  assert.match(back, /^\[Pricing research\]\(https:\/\/example\.com\/research\)$/m);
  // Re-parsing the markdown gives the same table.
  assert.deepEqual(markdownToBlocks(back).find((b) => b.type === "table").rows, blocks[1].rows);
  assert.deepEqual(runtimeCells(String.raw`| a \| b | c |`), ["a | b", "c"]);
});

test("table and link blocks are validated", () => {
  assert.throws(() => normalizeBlocks([{ type: "table", rows: [] }]), /at least one row/);
  assert.throws(() => normalizeBlocks([{ type: "table", rows: ["nope"] }]), /lists of cells/);
  assert.throws(() => normalizeBlocks([{ type: "table", rows: Array(101).fill(["x"]) }]), /at most 100 rows/);
  assert.throws(() => normalizeBlocks([{ type: "table", rows: [["x".repeat(501)]] }]), /at most 500/);
  const [wide] = normalizeBlocks([{ type: "table", rows: [Array(20).fill("h"), ["a"]], text: "ignored" }]);
  assert.equal(wide.rows[0].length, 12, "capped at 12 columns");
  assert.deepEqual(wide.rows[1], ["a", ...Array(11).fill("")], "short rows are padded");
  assert.equal(wide.text, "");
  assert.throws(() => normalizeBlocks([{ type: "link", url: "javascript:alert(1)" }]), /http\(s\)/);
  assert.throws(() => normalizeBlocks([{ type: "link", url: "" }]), /http\(s\)/);
  const [link] = normalizeBlocks([{ type: "link", url: " https://example.com/a ", text: "A" }]);
  assert.deepEqual([link.url, link.text], ["https://example.com/a", "A"]);
});

test("table editing keeps a rectangular grid with at least one cell", () => {
  let rows = blankBlock("table").rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].length, 3);
  rows = tableOps.set(rows, 0, 1, "Owner");
  rows = tableOps.addRow(rows, 1);
  rows = tableOps.addColumn(rows, 3);
  assert.deepEqual(rows[0], ["", "Owner", "", ""]);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.length === 4));
  rows = tableOps.removeColumn(rows, 0);
  assert.deepEqual(rows[0], ["Owner", "", ""]);
  let one = [["only"]];
  one = tableOps.removeRow(one, 0);
  one = tableOps.removeColumn(one, 0);
  assert.deepEqual(one, [["only"]], "the last cell stays");
  const converted = changeType([{ id: "a", type: "p", text: "x" }], 0, "table");
  assert.equal(converted[0].rows.length, 3);
  assert.equal(converted[1].type, "p", "a text block follows so typing can continue");
  assert.equal(savable({ type: "link", url: "" }), false);
  assert.equal(savable({ type: "link", url: "https://ok.dev" }), true);
  assert.equal(savable({ type: "p", text: "" }), true);
});

test("chat links are collected newest first, one per URL, outside code blocks", () => {
  const messages = [
    { conversation: "c", author: "e1", kind: "assistant", created: "2026-09-23T10:00:00Z", body: "See [the spec](https://x.dev/spec) and https://example.com/a." },
    { conversation: "c", author: "human", kind: "user", created: "2026-09-23T11:00:00Z", body: "Also https://example.com/a and ```\nhttps://in-code.dev\n```" },
    { conversation: "c", author: "system", kind: "notice", created: "2026-09-23T12:00:00Z", body: "https://notice.dev" },
    { conversation: "c", author: "e2", kind: "assistant", created: "2026-09-23T09:00:00Z", body: "javascript:alert(1) is not a link" },
  ];
  const links = linksFromMessages(messages);
  assert.deepEqual(
    links.map((l) => [l.url, l.author, l.label]),
    [
      ["https://example.com/a", "human", ""],
      ["https://x.dev/spec", "e1", "the spec"],
    ],
  );
  assert.equal(hostOf("https://www.linear.app/x"), "linear.app");
  assert.equal(hostOf("not a url"), "not a url");
});

test("templates produce fresh, savable blocks", () => {
  assert.deepEqual(
    CANVAS_TEMPLATES.map((t) => t.id),
    ["brief", "meeting", "tracker"],
  );
  const tracker = fromTemplate("tracker");
  assert.deepEqual(tracker[1].rows[0], ["Item", "Owner", "Status", "Due"]);
  assert.equal(new Set(tracker.map((b) => b.id)).size, tracker.length);
  assert.notEqual(fromTemplate("tracker")[0].id, tracker[0].id);
  assert.doesNotThrow(() => normalizeBlocks(tracker));
  assert.equal(fromTemplate("nope").length, 1);
});

test("the chat renderer's table helpers match GFM", () => {
  assert.ok(TABLE_ROW.test("| a | b |"));
  assert.ok(TABLE_RULE.test("|---|:--:|"));
  assert.ok(TABLE_RULE.test("--- | ---"));
  assert.ok(!TABLE_RULE.test("| a | b |"));
  assert.deepEqual(tableCells(String.raw`| x \| y | z |`), ["x | y", "z"]);
});

test("bots write canvas tables through doc actions, including in a one-bot chat", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-canvas-"));
  let reply = () => "ok";
  const prompts = [];
  const c = new Coordinator({
    directory,
    concurrency: 1,
    probe: async () => [],
    runner: async (options) => {
      prompts.push(options.prompt);
      return reply();
    },
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Sol", role: "Writer", harness: "codex", trusted: true });
  const sol = c.snapshot().employees[0];
  await c.command("conversations.create", { title: "Sol", members: [sol.id] });
  const chat = c.snapshot().conversations[0];
  const table = "| Channel | Owner |\n|---|---|\n| Blog | Sol |";
  reply = () => `Added.\n\n\`\`\`anybot-actions\n${JSON.stringify([{ type: "doc.section", heading: "Launch plan", markdown: `${table}\n[Brief](https://example.com/brief)` }])}\n\`\`\``;
  await c.command("messages.send", { conversation: chat.id, body: "Plan the launch", recipients: [sol.id], requestId: crypto.randomUUID() });
  const deadline = Date.now() + 5000;
  while (c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status))) {
    if (Date.now() > deadline) throw new Error("Queue did not settle");
    await new Promise((r) => setTimeout(r, 10));
  }
  const doc = await c.command("docs.get", { conversation: chat.id });
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ["h2", "table", "link"],
  );
  assert.deepEqual(doc.blocks[1].rows, [["Channel", "Owner"], ["Blog", "Sol"]]);
  assert.ok(c.snapshot().messages.some((m) => /updated the "Launch plan" section/.test(m.body)));
  // The next run sees the canvas, table included, labelled as the canvas.
  reply = () => "ok";
  await c.command("messages.send", { conversation: chat.id, body: "What's in the plan?", recipients: [sol.id], requestId: crypto.randomUUID() });
  while (c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status))) await new Promise((r) => setTimeout(r, 10));
  assert.match(prompts.at(-1), /Canvas, this conversation's shared page[\s\S]*\| Channel \| Owner \|/);
});
