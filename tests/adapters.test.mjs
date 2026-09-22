import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  harnesses,
  loadModelCatalog,
  parseClaudeAliases,
  discoverConfiguredModels,
  discoverConfigurationWarnings,
  extractEvent,
  invocation,
  runHarness,
  resolveExecutable,
} from "../runtime/adapters.mjs";

test("owner model catalog supplies current provider choices and fails closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "anybot-models-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "models.json"),
    JSON.stringify({
      version: 1,
      models: {
        codex: [{ value: "gpt-5.5", label: "Codex 5.5" }],
        gemini: ["gemini-2.5-pro"],
      },
    }),
  );
  assert.deepEqual(loadModelCatalog(root), {
    models: {
      codex: [{ value: "gpt-5.5", label: "Codex 5.5" }],
      gemini: [{ value: "gemini-2.5-pro", label: "gemini-2.5-pro" }],
    },
    error: null,
  });
  await writeFile(
    join(root, "models.json"),
    JSON.stringify({ version: 1, models: { codex: [{ value: "bad id" }] } }),
  );
  assert.match(loadModelCatalog(root).error, /Invalid model identifier/);
});

test("model choices use provider aliases and avoid stale dated IDs", () => {
  const claude = harnesses.find((h) => h.id === "claude");
  const gemini = harnesses.find((h) => h.id === "gemini");
  const codex = harnesses.find((h) => h.id === "codex");
  const hermes = harnesses.find((h) => h.id === "hermes");
  const cursor = harnesses.find((h) => h.id === "cursor");
  assert.deepEqual(claude.modelOptions.map((option) => option.value), [
    "fable",
    "sonnet",
    "opus",
  ]);
  assert.deepEqual(gemini.modelOptions, []);
  assert.deepEqual(codex.modelOptions, []);
  assert.deepEqual(hermes.modelOptions, []);
  assert.deepEqual(cursor.modelOptions, []);
  assert.equal(
    JSON.stringify(harnesses).match(/(?:claude|gemini|gpt)-\d[\w.-]*/i),
    null,
  );
});

test("Claude model aliases can be refreshed from the installed CLI help", () => {
  assert.deepEqual(
    parseClaudeAliases(
      "Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5').",
    ),
    ["fable", "opus", "sonnet"],
  );
  assert.deepEqual(parseClaudeAliases("--model <model> Model for this session."), []);
});

test("built-in structured parsers expose text, final, and error semantics", () => {
  assert.deepEqual(extractEvent("claude", {
    type: "assistant",
    message: { content: [{ type: "text", text: "Claude reply" }] },
  }), { text: "Claude reply" });
  assert.deepEqual(extractEvent("claude", { type: "result", result: "Claude final", is_error: false }), { final: "Claude final" });
  assert.deepEqual(extractEvent("codex", { type: "item.completed", item: { type: "agent_message", text: "Codex reply" } }), { text: "Codex reply" });
  assert.deepEqual(extractEvent("codex", { type: "item.completed", item: { type: "error", message: "Codex network failed" } }), { error: "Codex network failed" });
  assert.deepEqual(extractEvent("gemini", { type: "message", role: "assistant", content: "Gemini reply" }), { text: "Gemini reply" });
  assert.deepEqual(extractEvent("gemini", { type: "result", status: "error", error: { message: "Gemini failed" } }), { error: "Gemini failed" });
  assert.deepEqual(extractEvent("cursor", { type: "assistant", message: { content: [{ type: "text", text: "Cursor reply" }] } }), { text: "Cursor reply" });
  assert.deepEqual(extractEvent("cursor", { type: "result", subtype: "success", result: "Cursor final", is_error: false }), { final: "Cursor final" });
  assert.deepEqual(invocation("hermes"), [
    "chat", "--query-file", "-", "--quiet", "--max-turns", "30", "--run-budget", "600",
  ]);
  // Cursor: ask mode omits --force, dontAsk mode uses --force
  assert.deepEqual(invocation("cursor"), [
    "--print", "--output-format", "stream-json", "--stream-partial-output",
  ], "cursor default (ask) should omit --force");
  assert.deepEqual(invocation("cursor", "", "dontAsk"), [
    "--print", "--force", "--output-format", "stream-json", "--stream-partial-output",
  ], "cursor dontAsk should use --force");
  assert.deepEqual(invocation("cursor", "", "ask"), [
    "--print", "--output-format", "stream-json", "--stream-partial-output",
  ], "cursor ask should omit --force");
  // Claude: ask maps to "default" (prompt), dontAsk maps to "acceptEdits" (allow file edits)
  // Note: Claude's "--permission-mode dontAsk" is auto-DENY, not autonomous!
  assert.deepEqual(invocation("claude"), [
    "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "default",
  ], "claude default (ask) should use --permission-mode default");
  assert.deepEqual(invocation("claude", "", "dontAsk"), [
    "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
  ], "claude dontAsk should map to acceptEdits, NOT Claude's dontAsk");
  assert.deepEqual(invocation("claude", "", "ask"), [
    "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "default",
  ], "claude ask should use --permission-mode default");
  assert.deepEqual(invocation("claude", "sonnet", "ask").slice(-4), [
    "--permission-mode", "default", "--model", "sonnet",
  ]);
});

test("provider model discovery reads the configured model without inventing a catalog", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "anybot-provider-model-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", "config.toml"), 'model = "current-provider-model"\n');
  await mkdir(join(root, ".cursor"), { recursive: true });
  await writeFile(
    join(root, ".cursor", "cli-config.json"),
    JSON.stringify({ model: "cursor-configured-model" }),
  );
  assert.deepEqual(await discoverConfiguredModels(harnesses.find((h) => h.id === "codex"), { USERPROFILE: root }), [
    { value: "current-provider-model", label: "current-provider-model (configured)" },
  ]);
  assert.deepEqual(await discoverConfiguredModels(harnesses.find((h) => h.id === "cursor"), { USERPROFILE: root }), [
    { value: "cursor-configured-model", label: "cursor-configured-model (configured)" },
  ]);
  assert.deepEqual(await discoverConfiguredModels(harnesses.find((h) => h.id === "gemini"), { USERPROFILE: root }), []);
});

test("Codex legacy configuration warnings are read-only and explicit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "anybot-codex-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, ".codex", "config.toml"),
    `[computer_use.windows.always_allowed_app_ids]\n"example.exe" = true\n`,
  );
  assert.deepEqual(
    await discoverConfigurationWarnings(harnesses.find((h) => h.id === "codex"), { USERPROFILE: root }),
    ["Codex config contains the legacy computer_use.windows.always_allowed_app_ids setting; update the Codex CLI configuration before running this employee."],
  );
});

test(
  "Windows resolves Gemini's bundled Node entry and ignores Unix shims",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "anybot-resolver-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bundle = join(root, "node_modules/@google/gemini-cli/bundle");
    await mkdir(bundle, { recursive: true });
    await writeFile(join(root, "gemini.cmd"), "@echo off");
    await writeFile(join(root, "gemini"), "#!/bin/sh");
    await writeFile(join(root, "node.exe"), "fixture");
    await writeFile(join(bundle, "gemini.js"), "fixture");
    const env = { PATH: root, USERPROFILE: root, LOCALAPPDATA: root };
    assert.deepEqual(await resolveExecutable("gemini", env), {
      file: join(root, "node.exe"),
      prefix: [join(bundle, "gemini.js")],
    });
    await rm(join(bundle, "gemini.js"));
    assert.equal(await resolveExecutable("gemini", env), null);

    const native = join(
      root,
      "OpenAI",
      "Codex",
      "bin",
      "v1",
      "codex.exe",
    );
    await mkdir(join(root, "OpenAI", "Codex", "bin", "v1"), {
      recursive: true,
    });
    await writeFile(native, "fixture");
    await writeFile(join(root, "codex.cmd"), "@echo off");
    assert.deepEqual(await resolveExecutable("codex", env), {
      file: native,
      prefix: [],
    });

    const cursor = join(root, "cursor-agent.exe");
    await writeFile(cursor, "fixture");
    assert.deepEqual(await resolveExecutable("cursor-agent", env), {
      file: cursor,
      prefix: [],
    });
    await rm(cursor);
    const cursorShim = join(root, ".cursor", "bin", "cursor-agent.cmd");
    await mkdir(join(root, ".cursor", "bin"), { recursive: true });
    await writeFile(cursorShim, "@echo off");
    assert.deepEqual(await resolveExecutable("cursor-agent", { ...env, COMSPEC: "C:\\Windows\\System32\\cmd.exe" }), {
      file: "C:\\Windows\\System32\\cmd.exe",
      prefix: ["/d", "/s", "/c", cursorShim],
      launcher: cursorShim,
    });
  },
);

async function fixture(t, source, options = {}) {
  const harness = options.harness || "codex";
  const workspace = await mkdtemp(join(tmpdir(), "anybot-process-"));
  const script = join(workspace, "provider.cjs");
  await writeFile(
    script,
    `setTimeout(() => process.exit(99), 3000).unref();\n${source}`,
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const controller = new AbortController();
  const updates = [];
  return {
    controller,
    updates,
    run: async () => {
      const started = Date.now();
      try {
        return await runHarness(
          {
            harness,
            workspace,
            prompt: "A literal $(prompt); with Unicode 🐝",
            signal: controller.signal,
            onText: (text) => updates.push(text),
            ...options,
          },
          {
            resolve: async () => ({ file: process.execPath, prefix: [script] }),
          },
        );
      } finally {
        assert.ok(
          Date.now() - started < 2500,
          "Provider must stop before fixture safety deadline",
        );
      }
    },
  };
}

test("real subprocess receives stdin literally and handles split Unicode JSON without trailing newline", async (t) => {
  const f = await fixture(
    t,
    `
    let input = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      const bytes = Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input}}));
      const i = bytes.indexOf(Buffer.from('🐝')) + 2;
      process.stdout.write(bytes.subarray(0,i));
      setTimeout(() => process.stdout.write(bytes.subarray(i)), 20);
    });
  `,
  );
  assert.equal(await f.run(), "A literal $(prompt); with Unicode 🐝");
  assert.equal(f.updates.at(-1), "A literal $(prompt); with Unicode 🐝");
});

test("Hermes plain-text output completes through the real subprocess adapter", async (t) => {
  const f = await fixture(t, "process.stdout.write('Hermes answer');", { harness: "hermes" });
  assert.equal(await f.run(), "Hermes answer");
});

test("Gemini structured output completes through the real subprocess adapter", async (t) => {
  const f = await fixture(
    t,
    "process.stdout.write(JSON.stringify({type:'message',role:'assistant',content:'Gemini answer'})+'\\n');",
    { harness: "gemini" },
  );
  assert.equal(await f.run(), "Gemini answer");
});

test("Claude structured output completes through the real subprocess adapter", async (t) => {
  const f = await fixture(
    t,
    "process.stdout.write(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Claude answer'}]}})+'\\n'+JSON.stringify({type:'result',result:'Claude answer',is_error:false})+'\\n');",
    { harness: "claude" },
  );
  assert.equal(await f.run(), "Claude answer");
});

test("real subprocess malformed output fails even after a valid answer", async (t) => {
  const f = await fixture(
    t,
    `process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Partial'}})+'\\nnot-json');`,
  );
  await assert.rejects(f.run(), /invalid structured output/);
});

test("structured provider errors cancel a retrying Codex process promptly", async (t) => {
  const f = await fixture(
    t,
    `process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'error',message:'Codex network failed'}})+'\\n'); setInterval(() => {},1000);`,
  );
  await assert.rejects(f.run(), /Codex network failed/);
});

test("real subprocess output overflow reports its limit instead of a generic killed-process error", async (t) => {
  const f = await fixture(
    t,
    `process.stdout.write('x'.repeat(2100000)); setInterval(() => {},1000);`,
  );
  await assert.rejects(f.run(), /2 MB run limit/);
});

test("real subprocess timeout terminates a hanging provider", async (t) => {
  const f = await fixture(t, `setInterval(() => {},1000);`, { timeoutMs: 150 });
  await assert.rejects(f.run(), /time limit/);
});

test("real subprocess cancellation waits for process shutdown", async (t) => {
  const f = await fixture(
    t,
    `process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Started'}})+'\\n'); setInterval(() => {},1000);`,
    {
      onText: () => f.controller.abort(),
    },
  );
  await assert.rejects(f.run(), /Run cancelled/);
});

test("real subprocess error diagnostics redact credentials", async (t) => {
  const f = await fixture(
    t,
    `process.stderr.write('Authorization: Bearer private-token'); process.exitCode=1;`,
  );
  await assert.rejects(f.run(), (error) => {
    assert.match(error.message, /\[redacted\]/);
    assert.ok(!error.message.includes("private-token"));
    return true;
  });
});
