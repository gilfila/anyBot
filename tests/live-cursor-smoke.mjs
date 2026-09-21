/**
 * Opt-in live Cursor Agent smoke. Uses the installed cursor-agent CLI and local login.
 * Requires a model identifier as argv[2]. Skips when Cursor is not detected.
 * Outside the default `npm test` suite.
 *
 * Usage: node tests/live-cursor-smoke.mjs <model>
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { resolveExecutable } from "../runtime/adapters.mjs";

const model = process.argv[2] || "";
if (!model) {
  console.error("Usage: node tests/live-cursor-smoke.mjs <model>");
  process.exit(2);
}

const marker = "ANYBOT_CURSOR_OK";

const executable = await resolveExecutable("cursor-agent");
if (!executable) {
  console.log(
    "SKIP: Cursor Agent is not installed (cursor-agent not found on PATH).",
  );
  process.exit(0);
}

const directory = await mkdtemp(join(tmpdir(), "anybot-live-cursor-"));
const coordinator = new Coordinator({
  directory,
  concurrency: 1,
});

try {
  await coordinator.initialize();
  const cursor = coordinator.snapshot().harnesses.find((h) => h.id === "cursor");
  if (!cursor || cursor.status === "not-installed") {
    console.log(
      `SKIP: Cursor Agent not detected (${cursor?.detail || "missing probe result"}).`,
    );
    process.exit(0);
  }

  await coordinator.command("employees.create", {
    name: "Cursor Smoke",
    role: "Live probe",
    harness: "cursor",
    model,
    trusted: true,
    permissionMode: "dontAsk",
    instructions:
      "Reply with only the exact token requested. Do not use tools.",
  });
  const employee = coordinator.snapshot().employees[0];
  await coordinator.command("conversations.create", {
    title: "Cursor live smoke",
    members: [employee.id],
  });
  const conversation = coordinator.snapshot().conversations[0];
  await coordinator.command("messages.send", {
    conversation: conversation.id,
    body: `Reply with exactly this token and nothing else: ${marker}`,
    recipients: [employee.id],
    requestId: "live-cursor-smoke",
  });

  const deadline = Date.now() + 180_000;
  let run;
  while (Date.now() < deadline) {
    run = coordinator
      .snapshot()
      .runs.find((r) => r.conversation === conversation.id);
    if (run && ["succeeded", "failed", "cancelled", "interrupted"].includes(run.status))
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!run || run.status !== "succeeded") {
    throw new Error(
      `Cursor smoke failed: status=${run?.status || "missing"} error=${run?.error || "none"}`,
    );
  }
  if (!String(run.output || "").trim()) {
    throw new Error("Cursor smoke succeeded but output was empty");
  }
  console.log("PASS: Cursor live smoke succeeded.");
  console.log(`output: ${run.output.slice(0, 500)}`);
} finally {
  await coordinator.close();
  await rm(directory, { recursive: true, force: true });
}
