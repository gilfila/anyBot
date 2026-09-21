import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { harnesses, runHarness } from "./adapters.mjs";

// Owner configuration, loaded once at coordinator startup. Never accept a
// launcher definition from employee output, conversation text, or renderer IPC.
export function loadCustomHarnesses(directory) {
  const file = join(directory, "harnesses.json");
  try {
    if (statSync(file).size > 65536)
      throw new Error("harnesses.json exceeds 64 KB");
    const document = JSON.parse(readFileSync(file, "utf8"));
    if (
      document.version !== 1 ||
      !Array.isArray(document.adapters) ||
      document.adapters.length > 32
    )
      throw new Error("Expected version 1 and at most 32 adapters");
    const ids = new Set(harnesses.map((h) => h.id));
    const adapters = document.adapters.map((a) => {
      if (
        !a ||
        typeof a !== "object" ||
        typeof a.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,29}$/.test(a.id) ||
        ids.has(a.id)
      )
        throw new Error(
          "Custom harness IDs must be unique and cannot replace built-ins",
        );
      ids.add(a.id);
      if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 80)
        throw new Error("Harness name must contain 1–80 characters");
      if (a.trusted !== true)
        throw new Error(`Explicit trusted:true required for ${a.id}`);
      if (
        typeof a.executable !== "string" ||
        !isAbsolute(a.executable) ||
        a.executable.includes("\0") ||
        (process.platform === "win32" &&
          !a.executable.toLowerCase().endsWith(".exe"))
      )
        throw new Error(
          `Use an absolute executable path for ${a.id}; Windows requires .exe`,
        );
      if (
        !Array.isArray(a.args) ||
        a.args.length > 64 ||
        a.args.some(
          (arg) =>
            typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"),
        )
      )
        throw new Error(`Invalid argument array for ${a.id}`);
      if (a.output !== "text")
        throw new Error('Custom harnesses currently require output:"text"');
      if (
        a.modelFlag !== undefined &&
        (typeof a.modelFlag !== "string" ||
          !/^--?[a-z][a-z0-9-]{0,39}$/i.test(a.modelFlag))
      )
        throw new Error("modelFlag must be a single option such as --model");
      return Object.freeze({
        id: a.id,
        name: a.name.trim(),
        executable: a.executable,
        args: Object.freeze([...a.args]),
        output: a.output,
        modelFlag: a.modelFlag,
      });
    });
    return { adapters, error: null };
  } catch (error) {
    if (error.code === "ENOENT") return { adapters: [], error: null };
    return {
      adapters: [],
      error: `Custom harness configuration: ${error.message}`,
    };
  }
}

export function customInstallation(adapter) {
  let detected = false;
  try {
    detected = statSync(adapter.executable).isFile();
  } catch {
    /* missing */
  }
  return {
    id: adapter.id,
    name: adapter.name,
    custom: true,
    executable: adapter.executable,
    status: detected ? "detected" : "not-installed",
    detail: detected
      ? "Owner-configured CLI. Authentication and compatibility require a task test."
      : "Configured executable was not found.",
  };
}

export function runCustomHarness(adapter, options) {
  if (options.model && !adapter.modelFlag)
    throw new Error(
      "This custom harness has no modelFlag; leave the employee model blank.",
    );
  return runHarness(options, {
    resolve: async () => ({ file: adapter.executable, prefix: [] }),
    args: [
      ...adapter.args,
      ...(options.model ? [adapter.modelFlag, options.model] : []),
    ],
    outputFormat: "text",
  });
}
