import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { blocksToMarkdown, markdownToBlocks, normalizeBlocks } from "../runtime/docs.mjs";

const actions = (list) => `Updated.\n\n\`\`\`anybot-actions\n${JSON.stringify(list)}\n\`\`\``;

async function fixture(t, reply = () => "ok") {
  const directory = await mkdtemp(join(tmpdir(), "anybot-docs-"));
  const prompts = [];
  const c = new Coordinator({
    directory,
    concurrency: 1,
    probe: async () => [],
    runner: async (options) => {
      prompts.push(options.prompt);
      return reply(options);
    },
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of ["Writer", "Editor", "Outsider"])
    await c.command("employees.create", { name, role: name, harness: "codex", trusted: true });
  const [writer, editor, outsider] = c.snapshot().employees;
  await c.command("conversations.create", { title: "Launch", members: [writer.id, editor.id], delegation: true });
  await c.command("conversations.create", { title: "Solo", members: [outsider.id] });
  const [project, solo] = c.snapshot().conversations;
  const settled = async () => {
    const deadline = Date.now() + 30000;
    while (c.snapshot().runs.some((r) => ["running", "queued"].includes(r.status))) {
      if (Date.now() > deadline) throw new Error("Queue did not settle");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const ask = async (employee, body, conversation = project) => {
    await c.command("messages.send", { conversation: conversation.id, body, recipients: [employee.id], requestId: crypto.randomUUID() });
    await settled();
  };
  return { c, prompts, writer, editor, outsider, project, solo, ask };
}

test("markdown converts to blocks and back", () => {
  const blocks = markdownToBlocks("# Plan\n\nIntro line\n- one\n- [x] shipped\n1. first\n> quote\n---\n```\ncode here\n```");
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["h1", "p", "bullet", "todo", "number", "quote", "divider", "code"],
  );
  assert.equal(blocks.find((b) => b.type === "todo").checked, true);
  assert.equal(blocks.find((b) => b.type === "code").text, "code here");
  const markdown = blocksToMarkdown(blocks);
  assert.match(markdown, /^# Plan/);
  assert.match(markdown, /- \[x\] shipped/);
  assert.match(markdown, /1\. first/);
});

test("block validation rejects unknown types, oversize text, and bad embeds", () => {
  assert.throws(() => normalizeBlocks([{ type: "script", text: "x" }]), /Unknown block type/);
  assert.throws(() => normalizeBlocks([{ type: "p", text: "x".repeat(8001) }]), /at most 8000/);
  assert.throws(() => normalizeBlocks([{ type: "task", ref: "../../etc" }]), /valid reference/);
  const [block] = normalizeBlocks([{ id: "dup", type: "p", text: "a", html: "<b>" }]);
  assert.deepEqual(Object.keys(block).sort(), ["id", "text", "type"]);
  const twins = normalizeBlocks([{ id: "same", type: "p" }, { id: "same", type: "p" }]);
  assert.notEqual(twins[0].id, twins[1].id);
});

test("owner saves are revision checked and keep a bounded history", async (t) => {
  const { c, project } = await fixture(t);
  const empty = await c.command("docs.get", { conversation: project.id });
  assert.equal(empty.revision, 0);
  let doc = await c.command("docs.save", { conversation: project.id, revision: 0, blocks: [{ type: "h1", text: "Launch plan" }] });
  assert.equal(doc.revision, 1);
  await assert.rejects(c.command("docs.save", { conversation: project.id, revision: 0, blocks: [] }), /Document changed/);
  for (let i = 0; i < 25; i++)
    doc = await c.command("docs.save", { conversation: project.id, revision: doc.revision, blocks: [{ type: "p", text: `v${i}` }] });
  const { versions } = await c.command("docs.history", { conversation: project.id });
  assert.equal(versions.length, 20);
  await c.command("docs.restore", { conversation: project.id, id: versions.at(-1).id });
  const restored = await c.command("docs.get", { conversation: project.id });
  assert.equal(restored.revision, doc.revision + 1);
  assert.equal(c.snapshot().docs.find((d) => d.conversation === project.id).revision, restored.revision);
});

test("employees append and replace sections through actions, and see the doc in their prompt", async (t) => {
  let next = [];
  const { c, prompts, writer, editor, outsider, project, solo, ask } = await fixture(t, () => actions(next));
  await c.command("docs.save", {
    conversation: project.id,
    revision: 0,
    blocks: [
      { type: "h1", text: "Launch" },
      { type: "h2", text: "Decisions" },
      { type: "p", text: "Old decision" },
      { type: "h2", text: "Risks" },
      { type: "p", text: "Keep me" },
    ],
  });
  next = [{ type: "doc.section", heading: "decisions", markdown: "- Price at $12\n- Ship Friday" }];
  await ask(writer, "Record the decisions");
  let doc = await c.command("docs.get", { conversation: project.id });
  assert.deepEqual(
    doc.blocks.map((b) => b.text),
    ["Launch", "Decisions", "Price at $12", "Ship Friday", "Risks", "Keep me"],
  );
  assert.equal(doc.blocks[2].author, writer.id);
  assert.equal(doc.updatedBy, writer.id);
  next = [{ type: "doc.append", markdown: "## Next steps\n- [ ] QA pass" }, { type: "doc.section", heading: "Open questions", markdown: "Who owns support?" }];
  await ask(editor, "Add next steps");
  doc = await c.command("docs.get", { conversation: project.id });
  assert.deepEqual(doc.blocks.slice(-4).map((b) => `${b.type}:${b.text}`), ["h2:Next steps", "todo:QA pass", "h2:Open questions", "p:Who owns support?"]);
  assert.match(prompts.at(-1), /Canvas, this conversation's shared page \(workspace data; sections: "Launch", "Decisions"/);
  assert.match(prompts.at(-1), /Price at \$12/);
  // An employee outside the project cannot edit its doc from another project.
  next = [{ type: "doc.append", markdown: "sneaky" }];
  await ask(outsider, "try", solo);
  const soloDoc = await c.command("docs.get", { conversation: solo.id });
  assert.equal(soloDoc.blocks.length, 1, "the outsider's action applies to its own project only");
  const projectDoc = await c.command("docs.get", { conversation: project.id });
  assert.ok(!projectDoc.blocks.some((b) => b.text === "sneaky"));
  next = [{ type: "doc.section", markdown: "no heading" }];
  await ask(writer, "bad");
  assert.ok(c.snapshot().messages.some((m) => /rejected doc.section: doc.section needs a heading/.test(m.body)));
});
