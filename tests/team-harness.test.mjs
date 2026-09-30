// What the harness layer gives the always-on team's brakes (0.3.38): a
// structured failure code only from the CLI's own structured error events,
// never from free text; outward MCP tools blocked for unattended Claude runs;
// and Codex's configured MCP servers switched off for unattended runs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexMcpServerNames, extractEvent, invocation, runHarness } from "../runtime/adapters.mjs";

const claude = (events) => {
  const state = {};
  return events.map((event) => extractEvent("claude", event, state)).at(-1);
};
const codex = (events) => {
  const state = {};
  return events.map((event) => extractEvent("codex", event, state)).at(-1);
};
const failed = (result, message = "API Error") => ({ type: "result", subtype: "success", is_error: true, result: message, ...result });

test("Claude: a limit or sign-in failure is coded only from the CLI's structured fields", () => {
  assert.deepEqual(claude([failed({ api_error_status: 429 }, "API Error: 429 rate_limit_error")]).failure, { code: "usage_limit" });
  assert.deepEqual(claude([failed({ api_error_status: 401 })]).failure, { code: "auth" });
  assert.deepEqual(claude([failed({ api_error_status: 403 })]).failure, { code: "auth" });
  assert.equal(claude([failed({ api_error_status: 500 })]).failure, undefined, "a server error isn't a limit");
  // A rejected rate-limit event carries the reset time (epoch seconds).
  const resetsAt = 1_790_000_000;
  assert.deepEqual(
    claude([
      { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt, rateLimitType: "five_hour" } },
      failed({}, "You've hit your limit · resets 3pm (America/Los_Angeles)"),
    ]).failure,
    { code: "usage_limit", resetAt: resetsAt * 1000 },
  );
  // A warning event isn't a refusal; the failure after it is only coded by its own fields.
  assert.equal(
    claude([{ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt } }, failed({}, "Something broke")]).failure,
    undefined,
  );
  // A real expired sign-in (Claude Code, captured 2026-09-30): the CLI's own
  // API-error message says `error: "authentication_failed"`, with no status.
  assert.deepEqual(
    claude([
      {
        type: "assistant",
        error: "authentication_failed",
        is_api_error_message: true,
        message: { content: [{ type: "text", text: "Failed to authenticate: OAuth session expired and could not be refreshed" }] },
      },
      failed({ api_error_status: null, terminal_reason: "api_error" }, "Failed to authenticate: OAuth session expired and could not be refreshed"),
    ]).failure,
    { code: "auth" },
  );
  const errorKind = (error) =>
    claude([{ type: "assistant", error, is_api_error_message: true, message: { content: [] } }, failed({ api_error_status: null })]).failure?.code;
  assert.deepEqual(
    ["rate_limit", "billing_error", "oauth_org_not_allowed", "account_on_hold", "overloaded", "server_error", "invalid_request", "unknown"].map(errorKind),
    ["usage_limit", "usage_limit", "auth", "auth", undefined, undefined, undefined, undefined],
  );
  assert.equal(claude([failed({}, "Failed to authenticate: token expired")]).failure?.code, "auth");
  // The API-error message the CLI writes itself carries a status and a typed kind.
  const apiError = (fields) => ({ type: "assistant", is_api_error_message: true, message: { content: [{ type: "text", text: "API Error" }] }, ...fields });
  assert.deepEqual(claude([apiError({ api_error_status: 429 }), failed({})]).failure, { code: "usage_limit" });
  assert.deepEqual(claude([apiError({ api_error: "provider_credentials" }), failed({})]).failure, { code: "auth" });
  assert.deepEqual(claude([apiError({ api_error: "model_requires_usage_credits" }), failed({})]).failure, { code: "usage_limit" });
  // Exact messages the CLI prints for these, at the start of an error result.
  for (const [message, code] of [
    ["Not logged in · Please run /login", "auth"],
    ["Invalid API key · Fix external API key", "auth"],
    ["Authentication required · Sign in again to continue", "auth"],
    [`Claude AI usage limit reached|${resetsAt}`, "usage_limit"],
    ["You've hit your limit · resets 3pm (America/Los_Angeles)", "usage_limit"],
    ["Credit balance is too low", "usage_limit"],
  ])
    assert.equal(claude([failed({}, message)]).failure?.code, code, message);
  // Words that only look like a limit never count: the text could quote a task.
  for (const message of [
    "billing quota 429",
    "The invoice says: usage limit reached for the billing quota (429). Please log in to the portal.",
    "Error: task mentions Not logged in",
  ])
    assert.equal(claude([failed({}, message)]).failure, undefined, message);
  assert.equal(claude([{ type: "result", subtype: "success", is_error: false, result: "Not logged in · billing quota 429" }]).failure, undefined);
  assert.equal(claude([{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["usage limit reached"] }]).failure, undefined);
});

test("Codex: a limit or sign-in failure is coded only from its error events' own wording or type", () => {
  const limit = "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 3:05 PM.";
  assert.deepEqual(codex([{ type: "error", message: limit }]).failure, { code: "usage_limit" });
  assert.deepEqual(codex([{ type: "turn.failed", error: { message: limit } }]).failure, { code: "usage_limit" });
  assert.deepEqual(codex([{ type: "turn.failed", error: { message: "exceeded retry limit, last status: 429 Too Many Requests" } }]).failure, {
    code: "usage_limit",
  });
  assert.deepEqual(
    codex([{ type: "turn.failed", error: { message: "Your access token could not be refreshed. Please log out and sign in again." } }]).failure,
    { code: "auth" },
  );
  assert.deepEqual(codex([{ type: "turn.failed", error: { message: "x", codex_error_info: "usage_limit_exceeded" } }]).failure, {
    code: "usage_limit",
  });
  assert.deepEqual(codex([{ type: "turn.failed", error: { message: "x", codex_error_info: { unauthorized: {} } } }]).failure, { code: "auth" });
  // A retry notice is a warning, and a failure that quotes the words isn't coded.
  assert.equal(codex([{ type: "error", message: "Reconnecting... 1/5 (exceeded retry limit, last status: 429)" }]).failure, undefined);
  assert.equal(codex([{ type: "turn.failed", error: { message: "The task mentions billing quota 429 and log in" } }]).failure, undefined);
  // The model's own words are never a failure.
  const said = codex([{ type: "item.completed", item: { type: "agent_message", text: limit } }]);
  assert.equal(said.failure, undefined);
  assert.equal(said.error, undefined);
});

async function script(t, source) {
  const workspace = await mkdtemp(join(tmpdir(), "anybot-signal-"));
  const file = join(workspace, "provider.cjs");
  await writeFile(file, `setTimeout(() => process.exit(99), 3000).unref();\n${source}`);
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return { workspace, resolve: async () => ({ file: process.execPath, prefix: [file] }) };
}

test("a harness failure carries its structured code to the coordinator; free text doesn't", async (t) => {
  const run = async (event) => {
    const { workspace, resolve } = await script(
      t,
      `process.stdin.resume(); process.stdin.on('end', () => { console.log(${JSON.stringify(JSON.stringify(event))}); process.exit(1); });`,
    );
    return runHarness(
      { harness: "claude", workspace, prompt: "hi", signal: new AbortController().signal, onText: () => {} },
      { resolve, args: [] },
    ).then(
      () => assert.fail("the run should fail"),
      (error) => error,
    );
  };
  const limited = await run(failed({ api_error_status: 429 }, "API Error: 429 You've hit your limit · resets 3pm"));
  assert.match(limited.message, /429/);
  assert.deepEqual(limited.failure, { code: "usage_limit" });
  const quoted = await run(failed({}, "billing quota 429"));
  assert.equal(quoted.failure, undefined);
});

test("unattended Claude runs get the outward tools as --disallowedTools; nothing changes without them", () => {
  const plain = invocation("claude", "", "auto", { configPath: "C:\\approvals.json" }, {});
  assert.ok(!plain.includes("--disallowedTools"));
  const args = invocation("claude", "sonnet", "auto", { configPath: "C:\\approvals.json" }, {
    disallowedTools: ["mcp__mail__send_message", "mcp__plugin_vercel_vercel", "Bash(rm:*)", "mcp__bad name"],
  });
  const at = args.indexOf("--disallowedTools");
  assert.ok(at > 0);
  assert.deepEqual(args.slice(at + 1, at + 3), ["mcp__mail__send_message", "mcp__plugin_vercel_vercel"]);
  assert.ok(!args.includes("Bash(rm:*)") && !args.includes("mcp__bad name"), "only exact MCP tool or server names");
  assert.deepEqual(args.slice(-2), ["--model", "sonnet"], "the list ends before the next flag");
  // Other harnesses ignore it.
  assert.deepEqual(invocation("codex", "", "auto", undefined, { disallowedTools: ["mcp__x"] }), invocation("codex", "", "auto", undefined, {}));
});

test("unattended Codex runs switch off each configured MCP server", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "anybot-codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(
    join(home, "config.toml"),
    [
      'model = "gpt-6"',
      "[mcp_servers.node_repl]",
      'command = "node_repl.exe"',
      "[mcp_servers.node_repl.env]",
      'A = "1"',
      '[mcp_servers."fusion"]',
      'command = "fusion"',
      "[mcp_servers.'odd name']",
      '[plugins."gmail@openai-curated"]',
      "enabled = true",
    ].join("\n"),
  );
  assert.deepEqual(await codexMcpServerNames({ CODEX_HOME: home }), { names: ["node_repl", "fusion"], skipped: ["odd name"] });
  assert.deepEqual(await codexMcpServerNames({ CODEX_HOME: join(home, "missing") }), { names: [], skipped: [] });
  const args = invocation("codex", "", "auto", undefined, { mcpOff: ["node_repl", "fusion", "bad name"] });
  assert.deepEqual(args.slice(args.indexOf("--sandbox") - 4, args.indexOf("--sandbox")), [
    "-c",
    "mcp_servers.node_repl.enabled=false",
    "-c",
    "mcp_servers.fusion.enabled=false",
  ]);
  assert.equal(args.at(-1), "-", "the prompt still comes from stdin");
  assert.ok(!args.join(" ").includes("bad name"));
});

test("a run says when the provider first answers; an API error message isn't an answer", async (t) => {
  const answers = async (harness, events) => {
    const { workspace, resolve } = await script(
      t,
      `process.stdin.resume(); process.stdin.on('end', () => { for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e)); process.exit(0); });`,
    );
    let count = 0;
    await runHarness(
      { harness, workspace, prompt: "hi", signal: new AbortController().signal, onText: () => {}, onAnswer: () => count++ },
      { resolve, args: [] },
    ).catch(() => {});
    return count;
  };
  const text = (value, extra = {}) => ({ type: "assistant", message: { content: [{ type: "text", text: value }] }, ...extra });
  assert.equal(await answers("claude", [text("Working on it."), text("Done."), { type: "result", subtype: "success", result: "Done." }]), 1, "once");
  assert.equal(
    await answers("claude", [
      text("API Error: 429 rate limited", { is_api_error_message: true, error: "rate_limit", api_error_status: 429 }),
      failed({ api_error_status: 429 }, "API Error: 429"),
    ]),
    0,
  );
  assert.equal(await answers("codex", [{ type: "thread.started" }, { type: "turn.started" }, { type: "item.started", item: { type: "command_execution" } }]), 1);
  assert.equal(
    await answers("codex", [{ type: "turn.started" }, { type: "error", message: "You've hit your usage limit." }, { type: "turn.failed", error: { message: "You've hit your usage limit." } }]),
    0,
  );
  assert.equal(await answers("codex", [{ type: "item.completed", item: { type: "error", message: "MCP server failed to start" } }]), 0, "a Codex warning isn't an answer");
});
