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
  lineSplitter,
  runHarness,
  resolveExecutable,
} from "../runtime/adapters.mjs";
import { classifyRunError } from "../runtime/diagnostics.mjs";

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
  // Codex error items are warnings, before the turn (config notices) and
  // during it (compaction notices): a failure ends with turn.failed.
  const codexRun = {};
  assert.deepEqual(extractEvent("codex", { type: "item.completed", item: { type: "error", message: "config.toml key is ignored" } }, codexRun), { warning: "config.toml key is ignored" });
  extractEvent("codex", { type: "turn.started" }, codexRun);
  const compaction = "Heads up: Long threads and multiple compactions can cause the model to be less accurate.";
  assert.deepEqual(extractEvent("codex", { type: "item.completed", item: { type: "error", message: compaction } }, codexRun), { warning: compaction });
  // A top-level error is a retry notice unless it can't recover (credits,
  // sign-in, model); turn.failed carries the last one when it has no message.
  const retry = "Reconnecting... 1/5 (stream disconnected before completion: error sending request)";
  assert.deepEqual(extractEvent("codex", { type: "error", message: retry }, codexRun), { warning: retry });
  assert.deepEqual(extractEvent("codex", { type: "turn.failed", error: {} }, codexRun), { error: retry });
  assert.deepEqual(extractEvent("codex", { type: "turn.failed", error: { message: "stream closed" } }, codexRun), { error: "stream closed" });
  const credits = "You've hit your usage limit. Upgrade to Pro or try again later.";
  // These two also carry a structured code for the provider breaker (0.3.38).
  assert.deepEqual(extractEvent("codex", { type: "error", message: credits }, {}), { error: credits, failure: { code: "usage_limit" } });
  assert.deepEqual(extractEvent("codex", { type: "error", message: "unexpected status 401 Unauthorized" }, {}), {
    error: "unexpected status 401 Unauthorized",
    failure: { code: "auth" },
  });
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
  assert.match(extractEvent("antigravity", { event: "result", result: { status: "SUCCESS", response: "", denied_actions: denied } }).error, /wasn't allowed to use RunCommand[\s\S]*Everything runs, nothing asks you/);
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

test("Codex's sandbox follows the bot's permission mode", () => {
  // Codex exec can't ask, so each mode is a sandbox (flags checked against
  // `codex exec --help` 0.130/0.157): ask reads only, auto writes the
  // workspace, dontAsk adds network access. None lifts the sandbox.
  const sandbox = (mode) => {
    const argv = invocation("codex", "", mode);
    return argv.slice(argv.indexOf("--sandbox") - 2);
  };
  assert.deepEqual(invocation("codex", "", "ask"), ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-"]);
  assert.deepEqual(invocation("codex"), ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-"]);
  assert.deepEqual(sandbox("dontAsk"), ["-c", "sandbox_workspace_write.network_access=true", "--sandbox", "workspace-write", "-"]);
  for (const mode of ["ask", "auto", "dontAsk"]) {
    const argv = invocation("codex", "", mode, undefined, { addDirs: ["C:/Shared"] });
    assert.ok(!argv.some((part) => /bypass|danger-full-access/.test(part)), mode);
    assert.ok(argv.indexOf("--add-dir") < argv.indexOf("--sandbox"), "folders before the sandbox flag");
  }
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

async function fixture(t, source, options = {}, internals = {}) {
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
            ...internals,
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

test("a Codex error that can't recover (out of credits) stops a retrying process promptly", async (t) => {
  const f = await fixture(
    t,
    `process.stdout.write(JSON.stringify({type:'turn.started'})+'\\n'+JSON.stringify({type:'error',message:"You've hit your usage limit. Try again later."})+'\\n'); setInterval(() => {},1000);`,
  );
  await assert.rejects(f.run(), /hit your usage limit/);
});

test("a failed Codex turn stops the run with the error it reported", async (t) => {
  const f = await fixture(
    t,
    [
      `const say = (e) => process.stdout.write(JSON.stringify(e) + '\\n');`,
      `say({type:'turn.started'});`,
      `say({type:'error',message:'Reconnecting... 5/5 (stream disconnected before completion)'});`,
      `say({type:'turn.failed',error:{}});`,
      `setInterval(() => {},1000);`,
    ].join(" "),
  );
  await assert.rejects(f.run(), /Reconnecting\.\.\. 5\/5/);
});

test("Codex notices mid-turn (a compaction warning, a reconnect) don't end the run", async (t) => {
  // The same event shapes as the real capture in tests/fixtures/usage/codex.jsonl.
  const f = await fixture(
    t,
    [
      `const say = (e) => process.stdout.write(JSON.stringify(e) + '\\n');`,
      `say({type:'thread.started',thread_id:'t1'});`,
      `say({type:'turn.started'});`,
      `say({type:'item.completed',item:{id:'item_0',type:'agent_message',text:'Working.'}});`,
      `say({type:'item.completed',item:{id:'item_1',type:'error',message:'Heads up: Long threads and multiple compactions can cause the model to be less accurate.'}});`,
      `say({type:'error',message:'Reconnecting... 1/5 (stream disconnected before completion: error sending request)'});`,
      `say({type:'item.completed',item:{id:'item_2',type:'agent_message',text:'Done.'}});`,
      `say({type:'turn.completed',usage:{input_tokens:5,output_tokens:1}});`,
    ].join(" "),
  );
  assert.equal(await f.run(), "Working.\n\nDone.");
});

test("a Codex exit with no turn.failed reports its last error", async (t) => {
  const f = await fixture(
    t,
    `process.stdout.write(JSON.stringify({type:'turn.started'})+'\\n'+JSON.stringify({type:'error',message:'Reconnecting... 2/5 (connection reset)'})+'\\n'); process.exitCode = 1;`,
  );
  await assert.rejects(f.run(), /Reconnecting\.\.\. 2\/5 \(connection reset\)/);
});

test("a Codex retry notice that recovered doesn't explain a later, unrelated failure", async (t) => {
  const f = await fixture(
    t,
    [
      `const say = (e) => process.stdout.write(JSON.stringify(e) + '\\n');`,
      `say({type:'turn.started'});`,
      `say({type:'error',message:'Reconnecting... 1/5 (unexpected status 429 Too Many Requests)'});`,
      `say({type:'item.completed',item:{id:'item_0',type:'agent_message',text:'Working.'}});`,
      `process.stderr.write("thread 'main' panicked at src/main.rs:1\\n");`,
      `process.exitCode = 3;`,
    ].join(" "),
  );
  await assert.rejects(f.run(), (error) => {
    assert.doesNotMatch(error.message, /Reconnecting/);
    assert.match(error.message, /panicked/);
    assert.notEqual(classifyRunError(error.message), "usage_limit");
    return true;
  });
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

test("a long run's tool output past 2 MB doesn't stop it", async (t) => {
  // Claude repeats each file it reads or edits in its tool events (a 100 KB
  // file is ~200 KB of stream): 30 of them is ~6 MB and a normal run.
  const f = await fixture(
    t,
    [
      `const say = (e) => process.stdout.write(JSON.stringify(e) + '\\n');`,
      `const file = 'x'.repeat(100000);`,
      `for (let i = 0; i < 30; i++) say({type:'user',message:{content:[{type:'tool_result',content:file}]},tool_use_result:{file:{content:file}}});`,
      `say({type:'assistant',message:{content:[{type:'text',text:'Edited all of it.'}]}});`,
      `say({type:'result',result:'Edited all of it.',is_error:false});`,
    ].join(" "),
    { harness: "claude" },
  );
  assert.equal(await f.run(), "Edited all of it.");
});

test("a runaway harness stops at the output backstop, with its own error", async (t) => {
  const f = await fixture(
    t,
    `const line = JSON.stringify({type:'user',message:{content:[{type:'tool_result',content:'y'.repeat(50000)}]}}) + '\\n'; setInterval(() => process.stdout.write(line), 1);`,
    { harness: "claude" },
    { limits: { total: 1_000_000 } },
  );
  await assert.rejects(f.run(), (error) => {
    assert.match(error.message, /safety limit/);
    assert.equal(classifyRunError(error.message), "output_limit");
    return true;
  });
});

test("one oversized event is skipped, not fatal", async (t) => {
  const terminal = [];
  const f = await fixture(
    t,
    [
      `const say = (e) => process.stdout.write(JSON.stringify(e) + '\\n');`,
      `say({type:'user',message:{content:[{type:'tool_result',content:'z'.repeat(300000)}]}});`,
      `say({type:'result',result:'Still here',is_error:false});`,
    ].join(" "),
    { harness: "claude", onTerminal: (text) => terminal.push(text) },
    { limits: { line: 100_000 } },
  );
  assert.equal(await f.run(), "Still here");
  assert.ok(terminal.some((text) => /oversized event skipped/.test(text)));
});

test("streamed output splits into lines across chunks; an oversized line is skipped to its newline", () => {
  const lines = [];
  let oversized = 0;
  const split = lineSplitter(10, (line) => lines.push(line), () => oversized++);
  split.feed("ab");
  split.feed("c\nde\nf");
  split.feed("g\n\nh");
  assert.deepEqual(lines, ["abc", "de", "fg", ""]);
  split.feed("0123456789A"); // past 10 characters without a newline
  assert.equal(oversized, 1);
  split.feed("more of it");
  split.feed(" still\nnext\ntail");
  assert.deepEqual(lines, ["abc", "de", "fg", "", "next"], "the oversized line is dropped, the next one kept");
  assert.equal(split.rest(), "tail");
  assert.equal(split.rest(), "");
});

test("one very long event is read in time linear in its size", () => {
  // A 48 MB line in 64 KB chunks, as a harness's stdout delivers it (a large
  // file read returned as base64 is one event). Rescanning and rejoining the
  // whole pending line on every chunk took seconds here and froze the
  // coordinator; reading it once takes milliseconds.
  const chunk = "x".repeat(64 * 1024);
  let length = 0;
  const split = lineSplitter(64 * 1024 * 1024, (line) => (length = line.length));
  const started = performance.now();
  for (let i = 0; i < 768; i++) split.feed(chunk);
  split.feed("\n");
  const elapsed = performance.now() - started;
  assert.equal(length, 768 * chunk.length);
  assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
});

test("a plain-text harness's kept reply is capped instead of killing the run", async (t) => {
  const f = await fixture(t, `process.stdout.write('h'.repeat(5000));`, { harness: "hermes" }, { limits: { reply: 1000 } });
  const result = await f.run();
  assert.ok(result.startsWith("h".repeat(1000)));
  assert.match(result, /output truncated/);
  assert.ok(result.length < 1200);
});

test("a structured harness's final result is capped like its streamed reply", async (t) => {
  const f = await fixture(
    t,
    `process.stdout.write(JSON.stringify({type:'result',result:'r'.repeat(5000),is_error:false})+'\\n');`,
    { harness: "claude" },
    { limits: { reply: 1000 } },
  );
  const result = await f.run();
  assert.ok(result.startsWith("r".repeat(1000)));
  assert.match(result, /output truncated/);
  assert.ok(result.length < 1200);
});

test("real subprocess timeout terminates a hanging provider", async (t) => {
  const f = await fixture(t, `setInterval(() => {},1000);`, { timeoutMs: 150 });
  await assert.rejects(f.run(), /time limit/);
});

test("time spent waiting on the owner's approval doesn't count against the run limit", async (t) => {
  // The harness needs 900 ms; 830 of them are an approval wait, so it
  // worked for well under its 400 ms limit.
  const source = `setTimeout(() => process.stdout.write(JSON.stringify({type:'result',result:'Approved and done',is_error:false})+'\\n'), 900);`;
  const started = Date.now();
  const waitedMs = () => Math.max(0, Math.min(Date.now() - started, 850) - 20);
  const paused = await fixture(t, source, { harness: "claude", timeoutMs: 400, waitedMs });
  assert.equal(await paused.run(), "Approved and done");
  // Without the pause, the same run is cut off.
  const counted = await fixture(t, source, { harness: "claude", timeoutMs: 400 });
  await assert.rejects(counted.run(), /time limit/);
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
