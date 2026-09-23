import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLiveModels, mergeModelOptions } from "../runtime/adapters.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

async function home(t) {
  const dir = await mkdtemp(join(tmpdir(), "anybot-models-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("Claude's own model list is read live, disabled entries included", async (t) => {
  const dir = await home(t);
  await writeFile(
    join(dir, ".claude.json"),
    JSON.stringify({
      additionalModelOptionsCache: [
        { value: "claude-fable-5-1[1m]", label: "Fable", description: "Fable 5.1 · Most capable" },
        { value: "cc-update-required-1", label: "Opus 5.5 (disabled)", description: "Update to 2.1.280+ to use Opus 5.5", disabled: true },
        { value: "bad value with spaces", label: "x" },
      ],
    }),
  );
  const models = await discoverLiveModels("claude", { env: { USERPROFILE: dir } });
  assert.deepEqual(models, [
    { value: "claude-fable-5-1[1m]", label: "Fable", description: "Fable 5.1 · Most capable" },
    { value: "cc-update-required-1", label: "Opus 5.5 (disabled)", description: "Update to 2.1.280+ to use Opus 5.5", disabled: true },
  ]);
  assert.deepEqual(await discoverLiveModels("claude", { env: { USERPROFILE: join(dir, "nobody") } }), []);
});

test("Codex's model cache is read in priority order, hidden models skipped", async (t) => {
  const dir = await home(t);
  await mkdir(join(dir, ".codex"));
  await writeFile(
    join(dir, ".codex", "models_cache.json"),
    JSON.stringify({
      fetched_at: "2026-09-23T16:11:32Z",
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5", priority: 7, visibility: "list" },
        { slug: "gpt-6-astra", display_name: "GPT-6-Astra", description: "Frontier intelligence", priority: 1, visibility: "list" },
        { slug: "internal-eval", display_name: "Eval", priority: 0, visibility: "hide" },
      ],
    }),
  );
  const models = await discoverLiveModels("codex", { env: { USERPROFILE: dir } });
  assert.deepEqual(models.map((m) => m.value), ["gpt-6-astra", "gpt-5.5"]);
  assert.equal(models[0].label, "GPT-6-Astra");
  assert.equal(models[0].description, "Frontier intelligence");
  // CODEX_HOME wins over the default location.
  assert.deepEqual(await discoverLiveModels("codex", { env: { USERPROFILE: join(dir, "x"), CODEX_HOME: join(dir, ".codex") } }).then((m) => m.length), 2);
});

test("Hermes follows its configured provider, including a CRLF config", async (t) => {
  const dir = await home(t);
  const hermes = join(dir, "Local", "hermes");
  await mkdir(join(hermes, "cache"), { recursive: true });
  await mkdir(join(dir, ".codex"));
  await writeFile(join(dir, ".codex", "models_cache.json"), JSON.stringify({ models: [{ slug: "gpt-6-sol", priority: 1 }] }));
  await writeFile(join(hermes, "config.yaml"), "model:\r\n  default: gpt-6-sol\r\n  provider: openai-codex\r\ndatabase:\r\n  journal_mode: wal\r\n");
  const env = { USERPROFILE: dir, LOCALAPPDATA: join(dir, "Local") };
  assert.deepEqual((await discoverLiveModels("hermes", { env })).map((m) => m.value), ["gpt-6-sol"]);
  await writeFile(join(hermes, "config.yaml"), "model:\n  provider: openrouter\n");
  await writeFile(
    join(hermes, "cache", "model_catalog.json"),
    JSON.stringify({ providers: { openrouter: { models: [{ id: "anthropic/claude-fable-5.1" }, { id: "google/gemini-3.5-flash" }] } } }),
  );
  assert.deepEqual((await discoverLiveModels("hermes", { env })).map((m) => m.value), ["anthropic/claude-fable-5.1", "google/gemini-3.5-flash"]);
});

test("Gemini's models come from the installed CLI bundle, newest first", async (t) => {
  const dir = await home(t);
  const bundle = join(dir, "node_modules", "@google", "gemini-cli", "bundle");
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, "gemini.js"), 'const A="gemini-2.5-pro",B="gemini-3.5-flash",C="gemini-3.5-flash";');
  await writeFile(join(bundle, "chunk-1.js"), 'x("gemini-3.1-pro-preview"); y("gemini-embedding-001"); z("not-a-model")');
  const models = await discoverLiveModels("gemini", { executable: { file: "node.exe", prefix: [join(bundle, "gemini.js")] } });
  assert.deepEqual(models.map((m) => m.value), ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-2.5-pro"]);
  assert.deepEqual(await discoverLiveModels("gemini", { executable: { file: "gemini.exe", prefix: [] } }), []);
});

test("model lists merge without duplicates, and the editor refreshes them on demand", async (t) => {
  assert.deepEqual(
    mergeModelOptions([{ value: "a", label: "A (owner)" }], [{ value: "a", label: "A (live)" }, { value: "b", label: "B" }], [{ value: "no spaces allowed" }]).map((m) => m.label),
    ["A (owner)", "B"],
  );
  const dir = await mkdtemp(join(tmpdir(), "anybot-models-"));
  let calls = 0;
  const c = new Coordinator({
    directory: dir,
    probe: async () => [{ id: "claude", name: "Claude Code", status: "detected", modelOptions: [{ value: "fable", label: "Fable" }] }],
    probeModels: async () => {
      calls++;
      return { claude: [{ value: "claude-opus-6", label: "Opus 6" }, { value: "fable", label: "Fable" }] };
    },
    runner: async () => "ok",
  });
  t.after(async () => {
    await c.close();
    await rm(dir, { recursive: true, force: true });
  });
  await c.initialize();
  const snapshot = await c.command("harnesses.models");
  assert.equal(calls, 1);
  assert.deepEqual(snapshot.harnesses[0].modelOptions.map((m) => m.value), ["claude-opus-6", "fable"]);
  assert.equal(snapshot.harnesses[0].status, "detected", "the rest of the probe result is kept");
  // Bracketed context variants are valid model ids.
  await c.command("employees.create", { name: "Sol", role: "Writer", harness: "claude", model: "claude-fable-5-1[1m]", trusted: true });
  assert.equal(c.snapshot().employees[0].model, "claude-fable-5-1[1m]");
});
