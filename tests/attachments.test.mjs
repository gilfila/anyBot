import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { invocation } from "../runtime/adapters.mjs";
import { harnessInputs, materialize, MAX_ATTACHMENTS, preview, savePasted, summary, validate } from "../runtime/attachments.mjs";

// 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function fixtures(t) {
  const root = await mkdtemp(join(tmpdir(), "anybot-attach-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const image = join(root, "shot.png");
  const doc = join(root, "notes.md");
  const folder = join(root, "specs");
  await writeFile(image, PNG);
  await writeFile(doc, "# Notes\nhello");
  await mkdir(join(folder, "deep"), { recursive: true });
  await writeFile(join(folder, "a.txt"), "a");
  return { root, image, doc, folder };
}

test("validate records files and folders, dedupes, and refuses bad paths", async (t) => {
  const { image, doc, folder, root } = await fixtures(t);
  const records = validate([image, { path: doc }, folder, image]);
  assert.deepEqual(
    records.map((r) => [r.name, r.kind, r.mime]),
    [
      ["shot.png", "file", "image/png"],
      ["notes.md", "file", "text/markdown"],
      ["specs", "folder", ""],
    ],
  );
  assert.equal(records[0].size, PNG.length);
  assert.deepEqual(validate(undefined), []);
  assert.throws(() => validate(["relative/path.txt"]), /absolute/);
  assert.throws(() => validate([join(root, "missing.txt")]), /not found: missing.txt/);
  assert.throws(() => validate(Array(MAX_ATTACHMENTS + 1).fill(image)), /at most 20/);
});

test("materialize copies files into the inbox and lists folders in place", async (t) => {
  const { image, doc, folder, root } = await fixtures(t);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const list = validate([image, doc, folder]);
  const gone = join(root, "gone.txt");
  await writeFile(gone, "x");
  list.push(...validate([gone]));
  await rm(gone);
  const delivered = await materialize("m1", list, workspace);
  assert.equal(delivered[0].path, ".anybot-inbox/m1/shot.png");
  assert.deepEqual(await readFile(join(workspace, ".anybot-inbox", "m1", "shot.png")), PNG);
  assert.equal(delivered[1].path, ".anybot-inbox/m1/notes.md");
  assert.equal(delivered[2].path, folder);
  assert.deepEqual(delivered[2].contents.sort(), ["a.txt", "deep/"]);
  assert.equal(delivered[3].missing, true);
  // A retried run finds its copies and keeps going.
  assert.equal((await materialize("m1", list, workspace))[0].path, ".anybot-inbox/m1/shot.png");
  assert.deepEqual(harnessInputs(delivered, workspace), {
    addDirs: [folder],
    images: [join(workspace, ".anybot-inbox/m1/shot.png")],
  });
  assert.equal(summary(list.slice(0, 3)), "[attached: shot.png, notes.md, specs/]");
});

test("preview returns image data URLs; pasted images are saved under the app folder", async (t) => {
  const { image, doc, root } = await fixtures(t);
  const shown = await preview(image);
  assert.equal(shown.kind, "image");
  assert.ok(shown.url.startsWith("data:image/png;base64,"));
  assert.deepEqual(await preview(doc), { kind: "file" });
  const { path } = await savePasted(root, { data: PNG.toString("base64"), mime: "image/png" });
  assert.ok(path.startsWith(join(root, "attachments")));
  assert.deepEqual(await readFile(path), PNG);
  await assert.rejects(savePasted(root, { data: "eA==", mime: "text/plain" }), /Only pasted images/);
});

test("harness flags: Claude gets --add-dir, Codex gets --image and --add-dir before stdin", () => {
  const inputs = { addDirs: ["C:/specs"], images: ["C:/w/a.png", "C:/w/b.png"] };
  assert.deepEqual(invocation("claude", "", "auto", undefined, inputs).slice(-2), ["--add-dir", "C:/specs"]);
  assert.deepEqual(invocation("codex", "", "auto", undefined, inputs), [
    "exec", "--json", "--skip-git-repo-check",
    "--image", "C:/w/a.png", "--image", "C:/w/b.png",
    "--add-dir", "C:/specs",
    "--sandbox", "workspace-write", "-",
  ]);
  assert.deepEqual(invocation("codex", "gpt-x", "auto", undefined, inputs).slice(-2), ["--model", "gpt-x"]);
  // Without attachments nothing changes.
  assert.deepEqual(invocation("codex"), ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-"]);
});

async function coordinator(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-attach-coord-"));
  const calls = [];
  const c = new Coordinator({
    directory,
    runner: async (options) => {
      calls.push(options);
      return { text: "Seen it." };
    },
    probe: async () => [],
    concurrency: 1,
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Looker", role: "Reviewer", harness: "codex", trusted: true });
  const employee = c.snapshot().employees[0];
  await c.command("conversations.create", { title: "Direct", members: [employee.id] });
  return { c, calls, employee, conversation: c.snapshot().conversations[0] };
}
const settled = async (c) => {
  for (let i = 0; i < 300; i++) {
    if (c.snapshot().runs.every((r) => !["queued", "running"].includes(r.status))) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("runs did not settle");
};

test("a message with attachments delivers them to the bot's run", async (t) => {
  const { image, folder } = await fixtures(t);
  const { c, calls, employee, conversation } = await coordinator(t);
  const requestId = crypto.randomUUID();
  // Attachments alone are enough to send.
  await c.command("messages.send", { conversation: conversation.id, body: "", attachments: [image, folder], requestId });
  await settled(c);
  const message = c.snapshot().messages.find((m) => m.author === "human");
  assert.deepEqual(JSON.parse(message.attachments).map((a) => a.name), ["shot.png", "specs"]);
  assert.equal(calls.length, 1);
  const { prompt, images, addDirs } = calls[0];
  assert.match(prompt, /The owner attached these to the assignment/);
  assert.match(prompt, new RegExp(`shot.png \\(image/png, \\d+ B\\): .anybot-inbox/${message.id}/shot.png`));
  assert.match(prompt, /contains: /);
  assert.match(prompt, /\(no text: work from the attached files\)/);
  assert.deepEqual(addDirs, [folder]);
  assert.equal(images.length, 1);
  assert.ok(existsSync(images[0]));
  assert.ok(images[0].startsWith(employee.workspace));
  // Same request id, same message: accepted once. Different attachments: refused.
  await c.command("messages.send", { conversation: conversation.id, body: "", attachments: [image, folder], requestId });
  await assert.rejects(
    c.command("messages.send", { conversation: conversation.id, body: "", attachments: [image], requestId }),
    /already used/,
  );
  // Previews are addressed by message and index, never by path.
  assert.equal((await c.command("attachments.preview", { message: message.id, index: 0 })).kind, "image");
  await assert.rejects(c.command("attachments.preview", { message: message.id, index: 1 }), /not found/);
  // Text alone is still required without attachments.
  await assert.rejects(c.command("messages.send", { conversation: conversation.id, body: " ", requestId: crypto.randomUUID() }), /Message/);
});

test("later turns see earlier attachments by name in the history", async (t) => {
  const { doc } = await fixtures(t);
  const { c, calls, conversation } = await coordinator(t);
  await c.command("messages.send", { conversation: conversation.id, body: "Read this", attachments: [doc], requestId: crypto.randomUUID() });
  await settled(c);
  await c.command("messages.send", { conversation: conversation.id, body: "And now summarize it", requestId: crypto.randomUUID() });
  await settled(c);
  assert.match(calls[1].prompt, /Human: Read this \[attached: notes.md\]/);
  assert.doesNotMatch(calls[1].prompt, /The owner attached these/);
});

test("composer helpers: dedupe, cap, names, sizes, stored lists", async () => {
  const ui = await import("../src/lib/attachments.js");
  const first = ui.addAttachments([], [{ path: "C:\\Users\\T\\shot.png" }, { path: "c:\\users\\t\\SHOT.png" }, { path: "/home/t/specs", kind: "folder" }]);
  assert.deepEqual(first.list.map((a) => [a.name, a.kind]), [["shot.png", "file"], ["specs", "folder"]]);
  const many = Array.from({ length: 25 }, (_, i) => ({ path: `C:/f/${i}.txt` }));
  const capped = ui.addAttachments(first.list, many);
  assert.equal(capped.list.length, ui.MAX_ATTACHMENTS);
  assert.equal(capped.dropped, 7);
  assert.equal(ui.formatSize(0), "");
  assert.equal(ui.formatSize(2048), "2 KB");
  assert.equal(ui.formatSize(3 * 1024 * 1024), "3.0 MB");
  assert.equal(ui.isImageName("a.JPEG"), true);
  assert.equal(ui.isImageName("a.pdf"), false);
  assert.deepEqual(ui.messageAttachments({ attachments: "not json" }), []);
  assert.deepEqual(ui.messageAttachments({}), []);
});
