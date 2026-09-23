import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { artifactPaths } from "../runtime/artifacts.mjs";

async function fixture(t, runner) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-artifact-"));
  const c = new Coordinator({
    directory,
    runner,
    probe: async () => [],
    concurrency: 1,
  });
  t.after(async () => {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.command("employees.create", {
    name: "Writer",
    role: "Writer",
    harness: "codex",
    trusted: true,
  });
  const employee = c.snapshot().employees[0];
  await c.command("conversations.create", {
    title: "Work",
    members: [employee.id],
  });
  const conversation = c.snapshot().conversations[0].id;
  return {
    c,
    employee,
    conversation,
    directory,
    send: (body) =>
      c.command("messages.send", {
        conversation,
        body,
        recipients: [employee.id],
        requestId: crypto.randomUUID(),
      }),
  };
}
async function settle(c) {
  const deadline = Date.now() + 30000;
  while (
    c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status))
  ) {
    if (Date.now() > deadline) throw new Error("Timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
test("artifacts retain immutable contents and preview HTML as text", async (t) => {
  const { c, employee, conversation, send } = await fixture(
    t,
    async ({ workspace }) => {
      await writeFile(
        join(workspace, "report.html"),
        '<script>alert("untrusted")</script>',
      );
      return 'Done\n```anybot-artifacts\n{"paths":["report.html"]}\n```';
    },
  );
  await send("Produce a report");
  await settle(c);
  const artifact = c.snapshot().artifacts[0];
  assert.ok(artifact);
  await writeFile(
    join(employee.workspace, "report.html"),
    "Changed after completion",
  );
  const preview = await c.command("artifacts.preview", {
    id: artifact.id,
    conversation,
  });
  assert.equal(preview.kind, "text");
  assert.match(preview.text, /<script>/);
  await assert.rejects(
    c.command("artifacts.preview", {
      id: artifact.id,
      conversation: "another-conversation",
    }),
    /not found/,
  );
});
test("artifact manifests reject traversal, absolute paths, device paths, and executables", () => {
  for (const path of [
    "../secret.txt",
    "C:\\secret.txt",
    "/secret.txt",
    "dir/../secret.txt",
    "NUL.txt",
    "report.txt:secret",
    "program.exe",
  ]) {
    assert.throws(() =>
      artifactPaths(
        "```anybot-artifacts\n" + JSON.stringify({ paths: [path] }) + "\n```",
      ),
    );
  }
});
test("following runs receive authorized copies of preceding artifacts", async (t) => {
  let calls = 0;
  const { c, send } = await fixture(t, async ({ workspace, prompt }) => {
    calls++;
    if (calls === 1) {
      await writeFile(join(workspace, "report.md"), "Original artifact");
      return '```anybot-artifacts\n{"paths":["report.md"]}\n```';
    }
    const path = prompt.match(/"path":"(\.anybot-inbox\/[^"\s]+)"/)?.[1];
    assert.ok(path, "prompt must advertise a scoped artifact copy");
    assert.equal(
      await readFile(join(workspace, path), "utf8"),
      "Original artifact",
    );
    return "Reviewed";
  });
  await send("Write");
  await settle(c);
  await send("Review");
  await settle(c);
  assert.ok(c.snapshot().runs.every((r) => r.status === "succeeded"));
});
test("missing artifact claims produce visible collection errors", async (t) => {
  const { c, send } = await fixture(
    t,
    async () => '```anybot-artifacts\n{"paths":["missing.md"]}\n```',
  );
  await send("Return a file");
  await settle(c);
  assert.equal(c.snapshot().artifacts.length, 0);
  assert.ok(
    c
      .snapshot()
      .messages.some(
        (m) =>
          m.kind === "notice" && m.body.includes("Files were not collected"),
      ),
  );
});

test("oversized artifacts are not loaded or published", async (t) => {
  const { c, send } = await fixture(t, async ({ workspace }) => {
    await writeFile(
      join(workspace, "large.txt"),
      Buffer.alloc(10 * 1024 * 1024 + 1),
    );
    return '```anybot-artifacts\n{"paths":["large.txt"]}\n```';
  });
  await send("Large result");
  await settle(c);
  assert.equal(c.snapshot().artifacts.length, 0);
  assert.ok(
    c
      .snapshot()
      .messages.some((m) => m.kind === "notice" && m.body.includes("10 MB")),
  );
});

test("tampered storage is rejected instead of shown as the original result", async (t) => {
  const { c, conversation, directory, send } = await fixture(
    t,
    async ({ workspace }) => {
      await writeFile(join(workspace, "result.txt"), "Original");
      return '```anybot-artifacts\n{"paths":["result.txt"]}\n```';
    },
  );
  await send("Write");
  await settle(c);
  const a = c.store.one("SELECT * FROM artifacts LIMIT 1");
  await writeFile(join(directory, "artifacts", a.blob), "Tampered");
  await assert.rejects(
    c.command("artifacts.preview", { id: a.id, conversation }),
    /integrity/,
  );
});

test("junctions cannot advertise files outside the employee workspace", async (t) => {
  let outside;
  const { c, directory, send } = await fixture(t, async ({ workspace }) => {
    await symlink(
      outside,
      join(workspace, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    return '```anybot-artifacts\n{"paths":["linked/secret.txt"]}\n```';
  });
  outside = join(directory, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "private fixture");
  await send("Read outside");
  await settle(c);
  assert.equal(c.snapshot().artifacts.length, 0);
  assert.ok(
    c
      .snapshot()
      .messages.some(
        (m) => m.kind === "notice" && m.body.includes("Symbolic links"),
      ),
  );
});
