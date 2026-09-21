import { spawn } from "node:child_process";
import process from "node:process";

const steps = [
  ["unit and integration tests", ["test"]],
  ["desktop renderer build", ["run", "build"]],
  ["Electron runtime smoke", ["run", "test:runtime"]],
  ["mobile web build and Capacitor sync", ["run", "mobile:sync"]],
  ["installed harness and model discovery", ["run", "doctor"]],
];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n== ${label} ==`);
    const command = process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : npm;
    const commandArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", npm, ...args]
      : args;
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve(code ?? (signal ? 1 : 0)),
    );
  });
}

for (const [label, args] of steps) {
  const code = await run(label, args);
  if (code !== 0) {
    console.error(`\nVerification stopped after: ${label}`);
    process.exit(code);
  }
}
console.log("\nLocal verification passed.");
