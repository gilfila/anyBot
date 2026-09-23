import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(root, "package.json");
const originalPackage = await readFile(packagePath);
const command = process.execPath;
const builder = join(root, "node_modules", "electron-builder", "cli.js");

let exitCode = 1;
try {
  exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, [builder, ...process.argv.slice(2)], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} finally {
  // electron-builder prepares a production app manifest in-place. Restore the
  // developer manifest so package/test/mobile scripts survive packaging.
  await writeFile(packagePath, originalPackage);
}

if (exitCode === 0 && process.argv.slice(2).includes("nsis")) {
  exitCode = await new Promise((resolve, reject) => {
    const check = spawn(process.execPath, [join(root, "scripts/verify-brand-package.mjs")], {
      cwd: root, stdio: "inherit", windowsHide: true,
    });
    check.once("error", reject);
    check.once("exit", code => resolve(code ?? 1));
  });
}
process.exitCode = exitCode;
