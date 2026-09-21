import { Coordinator } from "./coordinator.mjs";

const port = process.parentPort;
if (!port)
  throw new Error("Coordinator must be started by the desktop supervisor");
const coordinator = new Coordinator({ directory: process.argv[2] });
let ready = false,
  changedTimer;
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
    port.postMessage({ id: data.id, error: String(error.message) });
  }
});
await coordinator.initialize();
ready = true;
port.postMessage({ type: "ready" });
