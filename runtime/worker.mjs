import { Coordinator } from "./coordinator.mjs";
import { installCrashHandlers, isUnexpected } from "./diagnostics.mjs";

const port = process.parentPort;
if (!port)
  throw new Error("Coordinator must be started by the desktop supervisor");
// Anything nothing caught (including a workspace that can't be opened or
// backed up at startup) is reported as runtime.uncaught, then the process
// exits and the desktop restarts it. The short wait lets the report reach
// the main process first.
installCrashHandlers(process, {
  report: (entry) => port.postMessage({ type: "diagnostic", entry }),
  exit: (code) => setTimeout(() => process.exit(code), 200),
});
// --hold: an update is waiting for the team to finish, so nothing queued
// starts, including before this process is ready for main's runtime.hold.
const coordinator = new Coordinator({ directory: process.argv[2], holding: process.argv.includes("--hold") });
let ready = false,
  changedTimer;
coordinator.on("diagnostic", (entry) => port.postMessage({ type: "diagnostic", entry }));
coordinator.on("attention", (notice) => port.postMessage({ type: "attention", notice }));
coordinator.on("changed", () => {
  if (!ready || changedTimer) return;
  changedTimer = setTimeout(() => {
    changedTimer = null;
    port.postMessage({ type: "changed" });
  }, 100);
});
port.on("message", async ({ data }) => {
  if (data.type === "shutdown") {
    ready = false;
    clearTimeout(changedTimer);
    await coordinator.close();
    process.exit(0);
    return;
  }
  if (!ready) {
    port.postMessage({ id: data.id, error: "Runtime is starting" });
    return;
  }
  try {
    port.postMessage({
      id: data.id,
      result: await coordinator.command(data.method, data.payload),
    });
  } catch (error) {
    if (isUnexpected(error))
      port.postMessage({
        type: "diagnostic",
        entry: {
          level: "error",
          source: "runtime",
          code: "command.failed",
          message: `${data.method}: ${error.message}`,
          detail: error.stack,
          context: { method: data.method },
        },
      });
    port.postMessage({ id: data.id, error: String(error.message) });
  }
});
await coordinator.initialize();
ready = true;
port.postMessage({ type: "ready" });
