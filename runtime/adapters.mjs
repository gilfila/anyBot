import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { constants } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { formatEvent } from "./terminal.mjs";
import { finishUsage, readUsage, usageState } from "./usage.mjs";

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
    // Google's Antigravity CLI replaced Gemini CLI for personal Google
    // accounts on 2026-06-18 (free, AI Pro, and Ultra). Bots that used the
    // Gemini CLI harness were moved here by schema 16.
    id: "antigravity",
    name: "Antigravity CLI",
    // Models come live from `agy models` (discoverLiveModels).
    modelOptions: [],
    command: "agy",
    login: "agy",
    website: "https://antigravity.google",
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

// Brackets allow context variants such as claude-fable-5-1[1m]; models are
// passed as a single argv entry, never through a shell.
const modelId = /^[a-zA-Z0-9][a-zA-Z0-9_.:/+[\]-]{0,119}$/;
// Live model lists. Each CLI keeps its own, refreshed whenever it talks to
// its provider, so reading them picks up new models the day they ship,
// without an anyBot update:
// - Claude Code: ~/.claude.json additionalModelOptionsCache (server-provided;
//   entries that need a newer CLI come back disabled with the reason).
// - Codex: models_cache.json in CODEX_HOME.
// - Antigravity: `agy models`, one "id<TAB>label" line per model.
// - Hermes: its provider's catalog; the openai-codex provider uses Codex's.
const homeOf = (env) => env.USERPROFILE || env.HOME || "";
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const clipText = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

async function codexModels(env) {
  const document = await readJson(join(env.CODEX_HOME || join(homeOf(env), ".codex"), "models_cache.json"));
  return (Array.isArray(document.models) ? document.models : [])
    .filter((model) => typeof model?.slug === "string" && (model.visibility ?? "list") === "list")
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((model) => ({
      value: model.slug,
      label: clipText(model.display_name, 80) || model.slug,
      description: clipText(model.description, 160),
    }));
}

// `agy models` prints "id<TAB>label" per model on stdout (progress goes to
// stderr). It asks Google's servers, so it's cached for ten minutes.
export function parseAgyModels(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter(([id, label]) => id && label && modelId.test(id.trim()))
    .map(([id, label]) => ({ value: id.trim(), label: clipText(label, 80) || id.trim() }));
}
let agyModelCache = null;
async function agyModels(executable) {
  if (!executable) return [];
  if (agyModelCache && Date.now() - agyModelCache.at < 10 * 60 * 1000) return agyModelCache.models;
  const output = await new Promise((resolve) => {
    let text = "";
    const child = spawn(executable.file, [...executable.prefix, "models"], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
      resolve("");
    }, 10000);
    child.stdout.on("data", (chunk) => (text += chunk));
    child.once("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
  const models = parseAgyModels(output);
  if (models.length) agyModelCache = { at: Date.now(), models };
  return models;
}

async function hermesModels(env) {
  const roots = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, "hermes"), join(homeOf(env), ".hermes")].filter(Boolean);
  for (const base of roots) {
    let config;
    try {
      config = (await readFile(join(base, "config.yaml"), "utf8")).replace(/\r\n?/g, "\n");
    } catch {
      continue;
    }
    const provider = config.match(/^model:\s*\n(?:\s+.*\n)*?\s+provider:\s*["']?([\w.-]+)/m)?.[1];
    if (!provider) return [];
    if (provider === "openai-codex") return codexModels(env);
    const catalog = await readJson(join(base, "cache", "model_catalog.json")).catch(() => null);
    return (catalog?.providers?.[provider]?.models || [])
      .filter((model) => typeof model?.id === "string")
      .slice(0, 24)
      .map((model) => ({ value: model.id, label: model.id, description: clipText(model.description, 160) }));
  }
  return [];
}

export async function discoverLiveModels(harnessId, { env = process.env, executable = null } = {}) {
  try {
    if (harnessId === "claude") {
      const document = await readJson(join(homeOf(env), ".claude.json"));
      return (Array.isArray(document.additionalModelOptionsCache) ? document.additionalModelOptionsCache : [])
        .filter((model) => typeof model?.value === "string" && modelId.test(model.value))
        .map((model) => ({
          value: model.value,
          label: clipText(model.label, 80) || model.value,
          description: clipText(model.description, 160),
          ...(model.disabled === true ? { disabled: true } : {}),
        }));
    }
    if (harnessId === "codex") return await codexModels(env);
    if (harnessId === "antigravity") return await agyModels(executable);
    if (harnessId === "hermes") return await hermesModels(env);
  } catch {
    // A missing or unreadable cache just means fewer suggestions.
  }
  return [];
}

// Owner catalog first, then live lists, then what the CLI or its config
// reports; one entry per model id.
export function mergeModelOptions(...lists) {
  const seen = new Map();
  for (const option of lists.flat())
    if (option?.value && modelId.test(option.value) && !seen.has(option.value)) seen.set(option.value, option);
  return [...seen.values()].slice(0, 32);
}


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

// A harness problem the Harnesses page can explain in full (click the status):
//   { id, title, summary, impact: "none" | "blocks", details, file?, fix: [steps] }
// "none" means runs still work; "blocks" means runs will fail until it's fixed.

/** Known provider configuration hazards, read-only: user files are never changed. */
export async function discoverConfigurationIssues(harness, env = process.env) {
  if (harness.id !== "codex") return [];
  const home = env.USERPROFILE || env.HOME || "";
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  const file = join(codexHome, "config.toml");
  try {
    const text = await readFile(file, "utf8");
    if (text.includes("[computer_use.windows.always_allowed_app_ids]"))
      return [
        {
          id: "codex.unrecognized-setting",
          title: "Codex ignores a setting in its config file",
          summary: "Codex warns about an unrecognized setting at the start of every run. Runs still work.",
          impact: "none",
          details:
            "Your Codex config file has a [computer_use.windows.always_allowed_app_ids] section. The Codex desktop app writes it, but the Codex CLI doesn't recognize it. So at the start of every run the CLI prints \"Codex is ignoring 1 unrecognized configuration setting\" and carries on. Any Bot shows that as a ⚠ line in the bot's terminal and lets the run continue.",
          file,
          fix: [
            "Nothing is required: Codex bots work normally.",
            "To silence the warning, open the file and delete the [computer_use.windows.always_allowed_app_ids] section and the lines under it, then click Check installations.",
            "The Codex desktop app may add the section back the next time it runs.",
          ],
        },
      ];
  } catch {
    // Missing or unreadable optional config is handled by normal CLI errors.
  }
  return [];
}

async function discoverModelOptions(harness, executable) {
  const live = await discoverLiveModels(harness.id, { executable });
  if (harness.id !== "claude") {
    const configured = await discoverConfiguredModels(harness);
    return mergeModelOptions(live, configured, harness.modelOptions || []);
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
      resolve(mergeModelOptions(live, harness.modelOptions || []));
    }, 3500);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(mergeModelOptions(live, harness.modelOptions || []));
    });
    child.once("close", () => {
      clearTimeout(timer);
      const aliases = parseClaudeAliases(output).map((value) => ({
        value,
        label: `${value[0].toUpperCase()}${value.slice(1)} (latest)`,
      }));
      resolve(mergeModelOptions(live, aliases, harness.modelOptions || []));
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
    // The Antigravity installer puts agy here and adds it to PATH, but an app
    // started before the install won't see the new PATH yet.
    if (command === "agy") candidates.push(join(env.LOCALAPPDATA || "", "agy", "bin", "agy.exe"));
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
    case "antigravity":
      // The prompt goes on stdin (no -p: with a -p value agy ignores stdin).
      // Headless agy can't ask, so anything it would ask about is denied and
      // listed in the result's denied_actions (extractEvent reports them):
      // - auto: "accept-edits" (file edits in the workspace run; commands are
      //   denied).
      // - dontAsk: every tool runs.
      // - ask: the default mode (edits and commands are denied).
      if (permissionMode === "dontAsk") return ["--output-format", "stream-json", "--dangerously-skip-permissions"];
      if (permissionMode === "ask") return ["--output-format", "stream-json"];
      return ["--output-format", "stream-json", "--mode", "accept-edits"];
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

// What headless agy wasn't allowed to do, for the reply ("" when nothing was).
function antigravityDenied(actions) {
  if (!Array.isArray(actions) || !actions.length) return "";
  const names = [...new Set(actions.map((a) => String(a?.display_name || a?.action || "a tool").slice(0, 40)))];
  return `Antigravity wasn't allowed to use ${names.join(", ")}: it can't ask for permission when Any Bot runs it. To let it, edit the bot and set Permission mode to "Edits run, everything else asks you", which lets Antigravity run every tool.`;
}

// `state` carries what a harness's earlier events said (Codex: whether its
// turn has started). One object per run.
export function extractEvent(harness, value, state = {}) {
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
    // Each agent_message is a whole message ("I'll run ls." then the answer),
    // so later ones start a new paragraph instead of running on.
    if (value.type === "item.completed" && value.item?.type === "agent_message") {
      const text = `${state.messages ? "\n\n" : ""}${value.item.text || ""}`;
      state.messages = true;
      return { text };
    }
    if (value.type === "turn.started") state.turn = true;
    // Before the turn, error items are startup warnings (an unrecognized
    // config.toml key, an unreachable MCP server) and Codex carries on.
    // During the turn they're provider failures: stop instead of waiting
    // out Codex's retries.
    if (value.type === "item.completed" && value.item?.type === "error")
      return state.turn ? { error: value.item.message || "Codex failed" } : { warning: value.item.message || "" };
    if (value.type === "turn.failed" || value.type === "error")
      return { error: value.error?.message || value.message || "Codex failed" };
  }
  if (harness === "antigravity") {
    const step = value.step_update;
    if (value.event === "step_update" && step?.step_type === "agent_response" && step.text_delta)
      return { text: step.text_delta };
    if (value.event === "result") {
      const result = value.result || {};
      if (result.status && result.status !== "SUCCESS") return { error: result.error || "Antigravity failed" };
      const denied = antigravityDenied(result.denied_actions);
      const response = String(result.response || "").trim();
      // A headless run that needed permission gets the tool denied, and can end
      // with no reply at all: say what was blocked and how to allow it.
      if (!response && denied) return { error: `${denied} Nothing else was done.` };
      return { final: denied ? `${response}\n\n_${denied}_` : response };
    }
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

// Cursor Agent's launcher can be broken (a missing module after a partial
// update): a version check catches it before a run fails.
async function cursorLauncherIssue(executable) {
  const problem = await cursorVersionProblem(executable);
  if (!problem) return null;
  return {
    id: "cursor.launcher",
    title: "Cursor Agent is installed but won't start",
    summary: problem.summary,
    impact: "blocks",
    details: `Any Bot ran "cursor-agent --version" and it failed, so Cursor bots will fail too.${problem.output ? ` The last thing it printed was:\n\n${problem.output}` : ""}`,
    file: executable.launcher || executable.file,
    fix: [
      "Reinstall Cursor Agent (see cursor.com/docs/cli), or run its own update.",
      "Then click Check installations here.",
    ],
  };
}
async function cursorVersionProblem(executable) {
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
      resolve({ summary: "Cursor Agent was found, but its version check timed out.", output: "" });
    }, 3000);
    child.stdout.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ summary: "Cursor Agent was found, but it couldn't start.", output: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(null);
      resolve({
        summary: "Cursor Agent was found, but it fails to start. Cursor bots won't run until it's reinstalled.",
        output: diagnostics.trim().split(/\r?\n/).filter(Boolean).slice(-6).join("\n").slice(0, 1500),
      });
    });
  });
}

// Just the model lists, for the bot editor to refresh whenever it opens.
export async function probeModels(modelCatalog = {}) {
  const result = {};
  await Promise.all(
    harnesses.map(async (h) => {
      const configured = modelCatalog[h.id] || [];
      const executable = await resolveExecutable(h.command);
      result[h.id] = executable
        ? mergeModelOptions(configured, await discoverModelOptions(h, executable))
        : mergeModelOptions(configured, h.modelOptions || []);
    }),
  );
  return result;
}

export async function probeAll(modelCatalog = {}) {
  return Promise.all(
    harnesses.map(async (h) => {
      const configured = modelCatalog[h.id] || [];
      const issues = await discoverConfigurationIssues(h);
      const executable = await resolveExecutable(h.command);
      // `warnings` (the summaries) stays for older clients.
      if (!executable)
        return {
          ...h,
          modelOptions: configured.length ? configured : h.modelOptions || [],
          status: "not-installed",
          detail: "Not found on PATH or supported installation locations.",
          issues,
          warnings: issues.map((issue) => issue.summary),
        };
      const modelOptions = mergeModelOptions(configured, await discoverModelOptions(h, executable));
      if (h.id === "cursor") {
        const issue = await cursorLauncherIssue(executable);
        if (issue) issues.push(issue);
      }
      return {
        ...h,
        modelOptions,
        status: issues.length ? "warning" : "detected",
        detail: issues.length
          ? issues.map((issue) => issue.summary).join(" ")
          : "Executable detected. Authentication and compatibility are checked when you run a task.",
        executable: executable.launcher || executable.file,
        issues,
        warnings: issues.map((issue) => issue.summary),
      };
    }),
  );
}

export async function runHarness(
  { harness, model, workspace, prompt, signal, onText, onTerminal, onUsage, timeoutMs = 600000, permissionMode = "auto", approvals },
  { resolve = resolveExecutable, args, outputFormat, pipeGraceMs = 2000 } = {},
) {
  // The raw CLI view for the Activity terminal: redacted, never parsed for results.
  const term = (text) => {
    if (text) onTerminal?.(redact(text));
  };
  const executable = await resolve(harness);
  if (!executable)
    throw new Error(
      `${harness} is not installed or its launcher is unsupported. Open Harnesses for setup instructions.`,
    );
  if (signal.aborted) throw new Error("Run cancelled");
  const argv = [...executable.prefix, ...(args ?? invocation(harness, model, permissionMode, approvals))];
  const quote = (part) => (/[\s"]/.test(part) ? `"${String(part).replace(/"/g, '\\"')}"` : part);
  term(`$ ${[executable.file, ...argv].map(quote).join(" ")}  < prompt (${prompt.length.toLocaleString("en-US")} chars)\n`);
  const child = spawn(
    executable.file,
    argv,
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
  const eventState = {};
  // Token counts from the harness's result events, reported however the run ends.
  const usage = usageState();
  const started = Date.now();
  const append = (text) => {
    output += text;
    onText(redact(output));
  };
  const line = (text) => {
    if (!text.trim()) return;
    let value;
    try {
      value = JSON.parse(text);
      term(formatEvent(harness, value));
      readUsage(harness, value, usage);
    } catch {
      term(`${text}\n`);
    }
    try {
      const event = extractEvent(harness, value ?? JSON.parse(text), eventState);
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
    if (harness === "hermes" || outputFormat === "text") {
      term(text);
      append(text);
    }
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
    term(data.toString());
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
      // A harness's helper processes can outlive it and keep its output pipes
      // open (on Windows, killing the tree misses helpers whose parent already
      // exited). Once the harness itself has exited, give the pipes a moment
      // to drain, then stop waiting for them.
      child.once("exit", (exitCode) => {
        setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          resolve(exitCode);
        }, pipeGraceMs).unref();
      });
    });
    const tail = decoder.end();
    term(`[exit ${code ?? "?"}]\n`);
    if (harness === "hermes" || outputFormat === "text") {
      term(tail);
      append(tail);
    }
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
    try {
      onUsage?.(finishUsage(usage, { harness, model, durationMs: Date.now() - started }));
    } catch {
      // Metrics are best effort; they never change how a run ends.
    }
  }
}
