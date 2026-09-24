import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";

// A workspace with two bots, a project, and a direct chat. The runner waits
// until it's released (or aborted), so tests can archive a project mid-run.
async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-projects-"));
  const release = [];
  const c = new Coordinator({
    directory,
    probe: async () => [],
    concurrency: 2,
    runner: ({ signal }) =>
      new Promise((resolve, reject) => {
        release.push(() => resolve("Done"));
        signal?.addEventListener("abort", () => reject(new Error("Run cancelled")));
      }),
  });
  t.after(async () => {
    release.forEach((go) => go());
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of ["Alex", "Morgan"]) await c.command("employees.create", { name, role: `${name} role`, harness: "codex", trusted: true });
  const [alex, morgan] = c.snapshot().employees;
  await c.command("conversations.create", { title: "Launch", members: [alex.id, morgan.id], delegation: false });
  await c.command("conversations.create", { title: "Alex", members: [alex.id] });
  const [project, direct] = c.snapshot().conversations;
  const waitFor = async (check) => {
    const deadline = Date.now() + 30000;
    while (!check(c.snapshot())) {
      if (Date.now() > deadline) throw new Error("Timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const say = (conversation, body) =>
    c.command("messages.send", { conversation, body, requestId: crypto.randomUUID() });
  return { c, alex, morgan, project, direct, waitFor, say };
}

test("editing a project changes its name, handoffs, and folders", async (t) => {
  const { c, project } = await workspace(t);
  await c.command("conversations.updateSettings", {
    conversation: project.id,
    title: "Launch v2",
    delegation: true,
    allowedFolders: ["C:/work/site"],
    artifactsFolder: "C:/work/out",
  });
  let saved = c.snapshot().conversations.find((x) => x.id === project.id);
  assert.equal(saved.title, "Launch v2");
  assert.equal(saved.delegation, 1);
  assert.deepEqual(saved.allowedFolders, ["C:/work/site"]);
  // Leaving handoffs out keeps them as they are.
  await c.command("conversations.updateSettings", { conversation: project.id, title: "Launch v3" });
  saved = c.snapshot().conversations.find((x) => x.id === project.id);
  assert.equal(saved.delegation, 1);
  await assert.rejects(
    c.command("conversations.updateSettings", { conversation: project.id, delegation: "yes" }),
    /Handoffs must be on or off/,
  );
});

test("deleting a project archives it, stops its work, and blocks new work until restored", async (t) => {
  const { c, alex, project, direct, waitFor, say } = await workspace(t);
  await c.command("routines.create", { name: "Daily", conversation: project.id, employee: alex.id, prompt: "Check in", minutes: 60 });
  await c.command("conversations.setAutopilot", { conversation: project.id, enabled: true });
  await say(project.id, "@Alex and @Morgan start the launch plan");
  await waitFor((s) => s.runs.filter((r) => r.status === "running").length === 2);

  await c.command("conversations.setArchived", { conversation: project.id, archived: true });
  await waitFor((s) => s.runs.every((r) => r.status === "cancelled"));
  let snap = c.snapshot();
  const archived = snap.conversations.find((x) => x.id === project.id);
  assert.equal(archived.archived, 1);
  assert.equal(archived.autopilot, 0, "autopilot is turned off");
  assert.equal(snap.routines.find((r) => r.conversation === project.id).enabled, 0, "its routines are paused");
  assert.ok(snap.messages.some((m) => m.conversation === project.id), "history is kept");

  await assert.rejects(say(project.id, "@Alex one more thing"), /This project is archived/);
  await assert.rejects(
    c.command("routines.setEnabled", { id: snap.routines[0].id, enabled: true }),
    /This project is archived/,
  );
  // Direct chats aren't projects.
  await assert.rejects(
    c.command("conversations.setArchived", { conversation: direct.id, archived: true }),
    /Only projects can be deleted/,
  );

  await c.command("conversations.setArchived", { conversation: project.id, archived: false });
  snap = c.snapshot();
  assert.equal(snap.conversations.find((x) => x.id === project.id).archived, 0);
  await say(project.id, "@Alex back to it");
  await waitFor((s) => s.runs.some((r) => r.status === "running"));
});

test("work queued in an archived project never starts", async (t) => {
  const { c, alex, project, waitFor } = await workspace(t);
  await c.command("conversations.setArchived", { conversation: project.id, archived: true });
  // A hand-off landing after the archive (as a finishing run could queue one).
  const message = c.addMessage(project.id, alex.id, "handoff", "Follow up");
  c.addRun(project.id, alex.id, message);
  c.dispatch();
  await waitFor((s) => s.runs.length === 1 && s.runs[0].status === "cancelled");
});

