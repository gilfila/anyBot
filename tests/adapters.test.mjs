import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  harnesses,
  loadModelCatalog,
  parseClaudeAliases,
  discoverConfiguredModels,
  discoverConfigurationIssues,
  parseAgyModels,
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
        antigravity: ["gemini-3.8-flash-high"],
      },
    }),
  );
  assert.deepEqual(loadModelCatalog(root), {
    models: {
      codex: [{ value: "gpt-5.5", label: "Codex 5.5" }],
      antigravity: [{ value: "gemini-3.8-flash-high", label: "gemini-3.8-flash-high" }],
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
  const antigravity = harnesses.find((h) => h.id === "antigravity");
  const codex = harnesses.find((h) => h.id === "codex");
  const hermes = harnesses.find((h) => h.id === "hermes");
  const cursor = harnesses.find((h) => h.id === "cursor");
  assert.deepEqual(claude.modelOptions.map((option) => option.value), [
    "fable",
    "sonnet",
    "opus",
  ]);
  assert.deepEqual(antigravity.modelOptions, []);
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
  // A later Codex message in the same run starts a new paragraph.
  const codexMessages = {};
  extractEvent("codex", { type: "item.completed", item: { type: "agent_message", text: "I'll run ls." } }, codexMessages);
  assert.deepEqual(extractEvent("codex", { type: "item.completed", item: { type: "agent_message", text: "Done." } }, codexMessages), { text: "\n\nDone." });
  // Codex error items: startup warnings before the turn, failures during it.
  const codexRun = {};
  assert.deepEqual(extractEvent("codex", { type: "item.completed", item: { type: "error", message: "config.toml key is ignored" } }, codexRun), { warning: "config.toml key is ignored" });
  extractEvent("codex", { type: "turn.started" }, codexRun);
  assert.deepEqual(extractEvent("codex", { type: "item.completed", item: { type: "error", message: "Codex network failed" } }, codexRun), { error: "Codex network failed" });
  // Antigravity: text deltas stream, the result's response is the reply, and a
  // non-SUCCESS status is the error (shapes captured from agy 1.2.10).
  assert.deepEqual(
    extractEvent("antigravity", { event: "step_update", step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: "Antigravity reply" } }),
    { text: "Antigravity reply" },
  );
  assert.deepEqual(extractEvent("antigravity", { event: "result", result: { status: "SUCCESS", response: "Done.\n" } }), { final: "Done." });
  assert.deepEqual(extractEvent("antigravity", { event: "result", result: { status: "ERROR", error: "quota exceeded" } }), { error: "quota exceeded" });
  // Headless agy auto-denies tools that need permission: say so, and how to allow it.
  const denied = [{ action: "command", display_name: "RunCommand" }];
  assert.match(extractEvent("antigravity", { event: "result", result: { status: "SUCCESS", response: "", denied_actions: denied } }).error, /wasn't allowed to use RunCommand[\s\S]*Edits run, everything else asks you/);
  assert.match(extractEvent("antigravity", { event: "result", result: { status: "SUCCESS", response: "Partly done", denied_actions: denied } }).final, /^Partly done\n\n_Antigravity wasn't allowed to use RunCommand/);
  assert.deepEqual(extractEvent("cursor", { type: "assistant", message: { content: [{ type: "text", text: "Cursor reply" }] } }), { text: "Cursor reply" });
  assert.deepEqual(extractEvent("cursor", { type: "result", subtype: "success", result: "Cursor final", is_error: false }), { final: "Cursor final" });
  assert.deepEqual(invocation("hermes"), [
    "chat", "--query-file", "-", "--quiet", "--max-turns", "30", "--run-budget", "600",
  ]);
  // Cursor has no approval hook or classifier: only dontAsk passes --force.
  assert.deepEqual(invocation("cursor"), [
    "--print", "--output-format", "stream-json", "--stream-partial-output",
  ], "cursor default (auto) should omit --force");
  assert.deepEqual(invocation("cursor", "", "dontAsk"), [
    "--print", "--force", "--output-format", "stream-json", "--stream-partial-output",
  ], "cursor dontAsk should use --force");
  assert.deepEqual(invocation("cursor", "", "ask"), [
    "--print", "--output-format", "stream-json", "--stream-partial-output",
  ], "cursor ask should omit --force");
  // Claude: auto (the default) uses Claude's classifier and allows edits in
  // the workspace; dontAsk maps to acceptEdits; ask maps to default.
  // Note: Claude's own "--permission-mode dontAsk" is auto-DENY, never used.
  assert.deepEqual(invocation("claude"), [
    "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto", "--allowedTools", "Edit(./**)",
  ], "claude default (auto) should use Claude's auto mode");
  // With an approval bridge, gated actions go to the owner instead of being denied.
  assert.deepEqual(invocation("claude", "", "auto", { configPath: "C:/x/run.json" }).slice(-6), [
    "--permission-prompts", "host", "--permission-prompt-tool", "mcp__anybot__approve", "--mcp-config", "C:/x/run.json",
  ]);
  // agy reads the prompt from stdin only when -p isn't given.
  assert.deepEqual(invocation("antigravity"), ["--output-format", "stream-json", "--mode", "accept-edits"]);
  assert.deepEqual(invocation("antigravity", "", "dontAsk"), ["--output-format", "stream-json", "--dangerously-skip-permissions"]);
  assert.deepEqual(invocation("antigravity", "", "ask"), ["--output-format", "stream-json"]);
  assert.deepEqual(invocation("antigravity", "gemini-3.8-flash-high").slice(-2), ["--model", "gemini-3.8-flash-high"]);
  assert.ok(!invocation("antigravity").includes("-p"));
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
  assert.deepEqual(await discoverConfiguredModels(harnesses.find((h) => h.id === "antigravity"), { USERPROFILE: root }), []);
});

test("agy models lines become model choices", () => {
  const output = "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\r\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n\nnot a model line\n";
  assert.deepEqual(parseAgyModels(output), [
    { value: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" },
  ]);
});

test("Codex's unrecognized-setting issue is read-only and explains itself", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "anybot-codex-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, ".codex", "config.toml"),
    `[computer_use.windows.always_allowed_app_ids]\n"example.exe" = true\n`,
  );
  const [issue, ...rest] = await discoverConfigurationIssues(harnesses.find((h) => h.id === "codex"), { USERPROFILE: root });
  assert.equal(rest.length, 0);
  assert.equal(issue.id, "codex.unrecognized-setting");
  assert.equal(issue.impact, "none", "runs keep working since 0.3.19");
  assert.equal(issue.file, join(root, ".codex", "config.toml"));
  assert.match(issue.details, /\[computer_use\.windows\.always_allowed_app_ids\]/);
  assert.ok(issue.fix.length >= 2);
  // The file is only read, never changed.
  assert.match(await readFile(join(root, ".codex", "config.toml"), "utf8"), /always_allowed_app_ids/);
});

test(
  "Windows finds agy where its installer puts it, and never runs a Unix shim",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "anybot-resolver-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    // Not on PATH (an app started before the install), but in LocalAppData.
    const env = { PATH: join(root, "empty"), USERPROFILE: root, LOCALAPPDATA: root };
    assert.equal(await resolveExecutable("agy", env), null);
    await mkdir(join(root, "agy", "bin"), { recursive: true });
    await writeFile(join(root, "agy", "bin", "agy.exe"), "fixture");
    assert.deepEqual(await resolveExecutable("agy", env), { file: join(root, "agy", "bin", "agy.exe"), prefix: [] });
    // A bare Unix script on PATH is never picked on Windows.
    const shims = join(root, "shims");
    await mkdir(shims);
    await writeFile(join(shims, "agy"), "#!/bin/sh");
    assert.deepEqual(await resolveExecutable("agy", { ...env, PATH: shims }), { file: join(root, "agy", "bin", "agy.exe"), prefix: [] });
    await writeFile(join(root, "node.exe"), "fixture");
    // Codex and Cursor below are found through PATH.
    env.PATH = root;

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

test("Antigravity structured output completes through the real subprocess adapter", async (t) => {
  const f = await fixture(
    t,
    "for (const e of [{event:'step_update',step_update:{step_type:'agent_response',state:'ACTIVE',text_delta:'Antigravity '}},{event:'step_update',step_update:{step_type:'agent_response',state:'DONE',text_delta:'answer'}},{event:'result',result:{status:'SUCCESS',response:'Antigravity answer\\n'}}]) process.stdout.write(JSON.stringify(e)+'\\n');",
    { harness: "antigravity" },
  );
  assert.equal(await f.run(), "Antigravity answer");
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
    `process.stdout.write(JSON.stringify({type:'turn.started'})+'\\n'+JSON.stringify({type:'item.completed',item:{type:'error',message:'Codex network failed'}})+'\\n'); setInterval(() => {},1000);`,
  );
  await assert.rejects(f.run(), /Codex network failed/);
});

test("a Codex startup warning (an unrecognized config.toml key) doesn't fail the run", async (t) => {
  const warning = "Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings.";
  const f = await fixture(
    t,
    [
      `const say = (e) => process.stdout.write(JSON.stringify(e) + '\\n');`,
      `say({type:'thread.started',thread_id:'t1'});`,
      `say({type:'item.completed',item:{id:'item_0',type:'error',message:${JSON.stringify(warning)}}});`,
      `say({type:'turn.started'});`,
      `say({type:'item.completed',item:{id:'item_1',type:'agent_message',text:'OK'}});`,
      `say({type:'turn.completed',usage:{input_tokens:5,output_tokens:1}});`,
    ].join(" "),
  );
  assert.equal(await f.run(), "OK");
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
