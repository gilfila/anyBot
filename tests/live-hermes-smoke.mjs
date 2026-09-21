/**
 * Opt-in live Hermes smoke. Uses the installed Hermes CLI and local login.
 * Skips when Hermes is not detected. Outside the default `npm test` suite.
 *
 * Usage: node tests/live-hermes-smoke.mjs [model]
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { resolveExecutable } from "../runtime/adapters.mjs";

const model = process.argv[2] || "";
const marker = "ANYBOT_HERMES_OK";

const executable = await resolveExecutable("hermes");
if (!executable) {
  console.log("SKIP: Hermes is not installed (hermes not found on PATH).");
  process.exit(0);
}

const directory = await mkdtemp(join(tmpdir(), "anybot-live-hermes-"));
const coordinator = new Coordinator({
  directory,
  concurrency: 1,
});

try {
  await coordinator.initialize();
  const hermes = coordinator.snapshot().harnesses.find((h) => h.id === "hermes");
  if (!hermes || hermes.status === "not-installed") {
    console.log(
      `SKIP: Hermes not detected (${hermes?.detail || "missing probe result"}).`,
    );
    process.exit(0);
  }

  await coordinator.command("employees.create", {
    name: "Hermes Smoke",
    role: "Live probe",
    harness: "hermes",
    model,
    trusted: true,
    permissionMode: "dontAsk",
    instructions:
      "Reply with only the exact token requested. Do not use tools.",
  });
  const employee = coordinator.snapshot().employees[0];
  await coordinator.command("conversations.create", {
    title: "Hermes live smoke",
    members: [employee.id],
  });
  const conversation = coordinator.snapshot().conversations[0];
  await coordinator.command("messages.send", {
    conversation: conversation.id,
    body: `Reply with exactly this token and nothing else: ${marker}`,
    recipients: [employee.id],
    requestId: "live-hermes-smoke",
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
      `Hermes smoke failed: status=${run?.status || "missing"} error=${run?.error || "none"}`,
    );
  }
  if (!String(run.output || "").trim()) {
    throw new Error("Hermes smoke succeeded but output was empty");
  }
  console.log("PASS: Hermes live smoke succeeded.");
  console.log(`output: ${run.output.slice(0, 500)}`);
} finally {
  await coordinator.close();
  await rm(directory, { recursive: true, force: true });
}
