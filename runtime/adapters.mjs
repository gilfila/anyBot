import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { constants } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";

export const harnesses = [
  {
    id: "claude",
    name: "Claude Code",
    modelOptions: [
      { value: "fable", label: "Fable (latest alias)" },
      { value: "sonnet", label: "Sonnet (latest)" },
      { value: "opus", label: "Opus (latest)" },
    ],
    command: "claude",
    login: "claude auth login",
    website: "https://code.claude.com/docs/en/overview",
  },
  {
    id: "codex",
    name: "Codex CLI",
    modelOptions: [],
    command: "codex",
    login: "codex login",
    website: "https://developers.openai.com/codex/cli",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    // Gemini CLI model availability is account- and release-dependent. Keep
    // this empty so the form offers the harness default and Custom model
    // rather than advertising aliases that may not exist for the user.
    modelOptions: [],
    command: "gemini",
    login: "gemini",
    website: "https://geminicli.com/docs/get-started/installation/",
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    modelOptions: [],
    command: "hermes",
    login: "hermes setup",
    website: "https://hermes-agent.nousresearch.com/docs/",
  },
  {
    id: "cursor",
    name: "Cursor Agent CLI",
    modelOptions: [],
    command: "cursor-agent",
    login: "cursor-agent login",
    website: "https://cursor.com/docs/cli",
  },
];

const modelId = /^[a-zA-Z0-9][a-zA-Z0-9_.:/+-]{0,119}$/;

/** Read an owner-maintained model catalog without baking provider IDs into a release. */
export function loadModelCatalog(directory) {
  const file = join(directory, "models.json");
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size > 65536)
      throw new Error("models.json exceeds 64 KB");
    const document = JSON.parse(readFileSync(file, "utf8"));
    if (!document || document.version !== 1 || !document.models ||
        typeof document.models !== "object" || Array.isArray(document.models))
      throw new Error("Expected version 1 and a models object");
    const builtIns = new Set(harnesses.map((h) => h.id));
    const result = {};
    for (const [harness, values] of Object.entries(document.models)) {
      if (!builtIns.has(harness) || !Array.isArray(values) || values.length > 64)
        throw new Error(`Invalid model list for ${harness}`);
      const seen = new Set();
      result[harness] = values.map((entry) => {
        const value = typeof entry === "string" ? entry : entry?.value;
        const label = typeof entry === "string" ? entry : entry?.label;
        if (typeof value !== "string" || !modelId.test(value) || seen.has(value))
          throw new Error(`Invalid model identifier for ${harness}`);
        if (label !== undefined &&
            (typeof label !== "string" || !label.trim() || label.length > 160))
          throw new Error(`Invalid model label for ${harness}`);
        seen.add(value);
        return { value, label: label?.trim() || value };
      });
    }
    return { models: result, error: null };
  } catch (error) {
    if (error.code === "ENOENT") return { models: {}, error: null };
    return { models: {}, error: `Model catalog: ${error.message}` };
  }
}

/** Extract provider aliases from the installed Claude CLI help text. */
export function parseClaudeAliases(output) {
  const match = String(output).match(/Provide an alias[\s\S]{0,260}?or a model's full name/i);
  if (!match) return [];
  return [...match[0].matchAll(/['"]([a-z][a-z0-9_-]{1,31})['"]/gi)]
    .map((item) => item[1].toLowerCase())
    .filter((value, index, values) => values.indexOf(value) === index);
}

function modelChoices(values, source) {
  return [...new Set(values)]
    .filter((value) => typeof value === "string" && modelId.test(value))
    .slice(0, 16)
    .map((value) => ({ value, label: `${value} (${source})` }));
}

export async function discoverConfiguredModels(harness, env = process.env) {
  const home = env.USERPROFILE || env.HOME || "";
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  const candidates = {
    codex: [join(codexHome, "config.toml")],
    gemini: [join(home, ".gemini", "settings.json")],
    hermes: [join(home, ".hermes", "config.json"), join(home, ".hermes", "config.yaml")],
    cursor: [join(home, ".cursor", "cli-config.json"), join(home, ".cursor", "config.json")],
  }[harness.id] || [];
  for (const file of candidates) {
    try {
      const text = await readFile(file, "utf8");
      if (text.length > 65536) continue;
      if (harness.id === "codex") {
        const values = [...text.matchAll(/^\s*model\s*=\s*["']([^"']+)["']/gim)].map((m) => m[1]);
        if (values.length) return modelChoices(values, "configured");
      } else if (harness.id === "gemini") {
        const document = JSON.parse(text);
        const values = [
          document?.model,
          document?.model?.name,
          document?.model?.id,
          document?.modelName,
          document?.modelId,
        ];
        const choices = modelChoices(values, "configured");
        if (choices.length) return choices;
      } else if (harness.id === "cursor" && file.endsWith(".json")) {
        const document = JSON.parse(text);
        const values = [
          document?.model,
          document?.model?.name,
          document?.model?.id,
          document?.modelName,
          document?.modelId,
        ];
        const choices = modelChoices(values, "configured");
        if (choices.length) return choices;
      } else {
        const values = [...text.matchAll(/(?:^|\s)(?:model|model_name|modelName)\s*[:=]\s*["']([^"']+)["']/gim)].map((m) => m[1]);
        if (values.length) return modelChoices(values, "configured");
      }
    } catch {
      // Missing or malformed provider config should leave Custom available.
    }
  }
  return [];
}

/** Report known provider configuration hazards without changing user files. */
export async function discoverConfigurationWarnings(harness, env = process.env) {
  if (harness.id !== "codex") return [];
  const home = env.USERPROFILE || env.HOME || "";
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  const file = join(codexHome, "config.toml");
  try {
    const text = await readFile(file, "utf8");
    if (text.includes("[computer_use.windows.always_allowed_app_ids]"))
      return [
        "Codex config contains the legacy computer_use.windows.always_allowed_app_ids setting; update the Codex CLI configuration before running this employee.",
      ];
  } catch {
    // Missing or unreadable optional config is handled by normal CLI errors.
  }
  return [];
}

async function discoverModelOptions(harness, executable) {
  if (harness.id !== "claude") {
    const configured = await discoverConfiguredModels(harness);
    return configured.length ? configured : harness.modelOptions || [];
  }
  return new Promise((resolve) => {
    const child = spawn(executable.file, [...executable.prefix, "--help"], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
      resolve(harness.modelOptions || []);
    }, 3500);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(harness.modelOptions || []);
    });
    child.once("close", () => {
      clearTimeout(timer);
      const aliases = parseClaudeAliases(output);
      resolve(
        aliases.length
          ? aliases.map((value) => ({
              value,
              label: `${value[0].toUpperCase()}${value.slice(1)} (installed alias)`,
            }))
          : harness.modelOptions || [],
      );
    });
  });
}

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Never execute an arbitrary .cmd through a shell. Recognize known Node package
// entry points or the native WinGet Codex binary instead.
export async function resolveExecutable(command, env = process.env) {
  const candidates = [];
  for (const dir of (env.PATH || env.Path || "")
    .split(delimiter)
    .filter(Boolean)) {
    for (const suffix of process.platform === "win32" ? [".exe", ".cmd"] : [""])
      candidates.push(join(dir, command + suffix));
  }
  if (process.platform === "win32") {
    const home = env.USERPROFILE || "";
    candidates.push(join(home, ".local", "bin", command + ".exe"));
    if (command === "cursor-agent") {
      candidates.push(join(home, ".cursor", "bin", command + ".exe"));
      candidates.push(join(home, ".cursor", "bin", command + ".cmd"));
    }
    if (command === "hermes")
      candidates.push(
        join(env.LOCALAPPDATA || "", "hermes", "bin", "hermes.exe"),
      );
  }
  for (const file of candidates) {
    if (!(await exists(file))) continue;
    if (!file.endsWith(".cmd")) return { file, prefix: [] };
    if (command === "cursor-agent")
      return {
        file: env.COMSPEC || "cmd.exe",
        prefix: ["/d", "/s", "/c", file],
        launcher: file,
      };
    // Current Windows Codex installs ship a native binary under LocalAppData
    // while an older npm shim may remain earlier on PATH. Prefer the native
    // binary so a stale JavaScript launcher cannot mask a working install.
    if (command === "codex" && env.LOCALAPPDATA) {
      const base = join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
      const versions = await readdir(base).catch(() => []);
      for (const version of versions.sort().reverse()) {
        const native = join(base, version, "codex.exe");
        if (await exists(native)) return { file: native, prefix: [] };
      }
    }
    const entries =
      {
        codex: ["@openai/codex/bin/codex.js"],
        gemini: [
          "@google/gemini-cli/bundle/gemini.js",
          "@google/gemini-cli/dist/index.js",
        ],
        claude: ["@anthropic-ai/claude-code/cli.js"],
      }[command] || [];
    for (const entry of entries) {
      const script = join(dirname(file), "node_modules", entry);
      if (await exists(script)) {
        const node = await resolveExecutable("node", env);
        if (node) return { file: node.file, prefix: [script] };
      }
    }
    if (command === "codex" && env.LOCALAPPDATA) {
      const base = join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
      const packages = await readdir(base).catch(() => []);
      for (const p of packages.filter((p) => p.startsWith("OpenAI.Codex_"))) {
        const native = join(base, p, "codex-x86_64-pc-windows-msvc.exe");
        if (await exists(native)) return { file: native, prefix: [] };
      }
    }
  }
  return null;
}

export function childEnvironment(env = process.env) {
  const allowed =
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|LANG|LC_ALL|TERM|SSL_CERT_FILE|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|OPENROUTER_API_KEY|CURSOR_API_KEY)$/i;
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => allowed.test(key)),
  );
}

export function invocation(harness, model = "", permissionMode = "auto", approvals = undefined) {
  if (model) return [...invocation(harness, "", permissionMode, approvals), "--model", model];
  switch (harness) {
    case "claude": {
      // anyBot modes → Claude Code permission modes:
      // - auto: "auto" (a classifier runs safe actions, flags risky ones) plus
      //   file edits inside the workspace allowed outright.
      // - dontAsk: "acceptEdits" (edits run; commands and the rest are gated).
      // - ask: "default" (everything gated).
      // Headless runs can't show prompts, so gated actions go to the owner
      // through the approval bridge (runtime/approvals.mjs); without it they
      // would be denied silently.
      const mode = permissionMode === "ask" ? "default" : permissionMode === "dontAsk" ? "acceptEdits" : "auto";
      const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", mode];
      if (mode === "auto") args.push("--allowedTools", "Edit(./**)");
      if (approvals?.configPath)
        args.push(
          "--permission-prompts",
          "host",
          "--permission-prompt-tool",
          "mcp__anybot__approve",
          "--mcp-config",
          approvals.configPath,
        );
      return args;
    }
    case "codex":
      return [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "-",
      ];
    case "gemini":
      // No approval hook: auto and dontAsk let Gemini edit files; commands stay blocked.
      return ["--output-format", "stream-json", "--approval-mode", permissionMode === "ask" ? "default" : "auto_edit"];
    case "hermes":
      return [
        "chat",
        "--query-file",
        "-",
        "--quiet",
        "--max-turns",
        "30",
        "--run-budget",
        "600",
      ];
    case "cursor":
      // No approval hook and no classifier: only dontAsk passes --force.
      return permissionMode !== "dontAsk"
        ? [
            "--print",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
          ]
        : [
            "--print",
            "--force",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
          ];
    default:
      throw new Error("Unknown harness");
  }
}

export function extractEvent(harness, value) {
  if (harness === "claude") {
    if (value.type === "assistant")
      return {
        text: (value.message?.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n"),
      };
    if (value.type === "result")
      return value.is_error
        ? { error: value.result || value.errors?.join("\n") || "Claude failed" }
        : { final: value.result || "" };
  }
  if (harness === "codex") {
    if (value.type === "item.completed" && value.item?.type === "agent_message")
      return { text: value.item.text };
    if (value.type === "item.completed" && value.item?.type === "error")
      return { error: value.item.message || "Codex failed" };
    if (value.type === "turn.failed" || value.type === "error")
      return { error: value.error?.message || value.message || "Codex failed" };
  }
  if (harness === "gemini") {
    if (value.type === "message" && value.role === "assistant")
      return { text: value.content || "" };
    if (value.type === "result" && value.status === "error")
      return { error: value.error?.message || "Gemini failed" };
  }
  if (harness === "cursor") {
    if (value.type === "assistant")
      return {
        text: (value.message?.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n"),
      };
    if (value.type === "result")
      return value.is_error || value.subtype === "error"
        ? { error: value.result || "Cursor Agent failed" }
        : { final: value.result || "" };
  }
  return {};
}

export function redact(text) {
  return String(text)
    .replace(/\b(sk-[\w-]{12,}|AIza[\w-]{20,})\b/g, "[redacted]")
    .replace(
      /(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s"']+/gi,
      "$1[redacted]",
    );
}

export async function terminateTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const fallback = () => {
        try {
          child.kill();
        } catch {
          /* already exited */
        }
        resolve();
      };
      const killer = spawn(
        join(
          process.env.SYSTEMROOT || "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
        ["/pid", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.once("error", fallback);
      killer.once("close", (code) => (code === 0 ? resolve() : fallback()));
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* exited */
      }
    }, 1500).unref();
  }
}

async function cursorLauncherWarning(executable) {
  return new Promise((resolve) => {
    const child = spawn(executable.file, [...executable.prefix, "--version"], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
      resolve("Cursor Agent was found but its version check timed out.");
    }, 3000);
    child.stdout.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve(`Cursor Agent was found but could not start: ${error.message}`);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve("");
      const detail = diagnostics.trim().split(/\r?\n/).filter(Boolean).at(-1);
      resolve(
        `Cursor Agent was found but its installation failed the version check${detail ? `: ${detail}` : "."}`,
      );
    });
  });
}

export async function probeAll(modelCatalog = {}) {
  return Promise.all(
    harnesses.map(async (h) => {
      const configured = modelCatalog[h.id] || [];
      const warnings = await discoverConfigurationWarnings(h);
      const executable = await resolveExecutable(h.command);
      if (!executable)
        return {
        ...h,
        modelOptions: configured.length ? configured : h.modelOptions || [],
        status: "not-installed",
          detail: "Not found on PATH or supported installation locations.",
          warnings,
        };
      const modelOptions = configured.length
        ? configured
        : await discoverModelOptions(h, executable);
      if (h.id === "cursor") {
        const warning = await cursorLauncherWarning(executable);
        if (warning) warnings.push(warning);
      }
      return {
        ...h,
        modelOptions,
        status: warnings.length ? "warning" : "detected",
        detail: warnings.length
          ? `Executable detected. ${warnings.join(" ")}`
          : "Executable detected. Authentication and compatibility are checked when you run a task.",
        executable: executable.launcher || executable.file,
        warnings,
      };
    }),
  );
}

export async function runHarness(
  { harness, model, workspace, prompt, signal, onText, timeoutMs = 600000, permissionMode = "auto", approvals },
  { resolve = resolveExecutable, args, outputFormat } = {},
) {
  const executable = await resolve(harness);
  if (!executable)
    throw new Error(
      `${harness} is not installed or its launcher is unsupported. Open Harnesses for setup instructions.`,
    );
  if (signal.aborted) throw new Error("Run cancelled");
  const child = spawn(
    executable.file,
    [...executable.prefix, ...(args ?? invocation(harness, model, permissionMode, approvals))],
    {
      cwd: workspace,
      env: childEnvironment(),
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    buffer = "",
    diagnostics = "",
    parseError = "",
    bytes = 0,
    final;
  const decoder = new StringDecoder("utf8");
  const append = (text) => {
    output += text;
    onText(redact(output));
  };
  const line = (text) => {
    if (!text.trim()) return;
    try {
      const event = extractEvent(harness, JSON.parse(text));
      if (event.text) append(event.text);
      if (event.final !== undefined) final = event.final;
      if (event.error) {
        parseError = event.error;
        abort();
      }
    } catch {
      parseError =
        "Harness emitted invalid structured output. Check its installed version.";
    }
  };
  let termination;
  const abort = () => {
    termination ??= terminateTree(child);
  };
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  child.stdout.on("data", (data) => {
    bytes += data.length;
    if (bytes > 2_000_000) {
      parseError = "Harness output exceeded the 2 MB run limit";
      abort();
      return;
    }
    const text = decoder.write(data);
    if (harness === "hermes" || outputFormat === "text") append(text);
    else {
      buffer += text;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
  });
  child.stderr.on("data", (data) => {
    diagnostics = (diagnostics + data.toString()).slice(-8000);
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const tail = decoder.end();
    if (harness === "hermes" || outputFormat === "text") append(tail);
    else buffer += tail;
    if (
      !parseError &&
      harness !== "hermes" &&
      outputFormat !== "text" &&
      buffer.trim()
    )
      line(buffer);
    if (signal.aborted) throw new Error("Run cancelled");
    if (timedOut)
      throw new Error(`Run exceeded its configured ${Math.round(timeoutMs / 60000)}-minute time limit`);
    if (parseError) throw new Error(redact(parseError));
    if (code !== 0)
      throw new Error(
        redact(diagnostics || `Harness exited with code ${code}`),
      );
    const result = redact(final ?? output).trim();
    if (!result)
      throw new Error(
        "Harness exited without an assistant response. Check login and installed version.",
      );
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    await termination;
  }
}
