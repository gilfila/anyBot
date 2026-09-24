import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SIZES, digest, makeCorpus } from "../scripts/corpus.mjs";
import { benchContext } from "../scripts/bench-context.mjs";
import { benchSync } from "../scripts/bench-sync.mjs";

const corpus = makeCorpus();

test("the corpus generator matches its committed manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("./fixtures/corpus/manifest.json", import.meta.url), "utf8"));
  for (const [name, entry] of Object.entries(manifest.workspaces)) {
    assert.equal(corpus[name].messages.length, entry.messages, name);
    assert.equal(corpus[name].runs.length, entry.runs, name);
    assert.equal(digest(corpus[name]), entry.sha256, `${name} changed; run node scripts/make-corpus.mjs if intended`);
  }
});

test("corpus shapes: direct chat, a 40-message thread, 5,000 messages", () => {
  assert.equal(corpus.direct.conversation.members.length, 1);
  assert.ok(corpus.direct.messages.every((m) => m.thread === null));
  const project2 = corpus.project2;
  const root = project2.messages.find((m) => m.body.startsWith("@Ada @Lin"));
  assert.equal(project2.messages.filter((m) => m.id === root.id || m.thread === root.id).length, 40);
  assert.ok(project2.messages.filter((m) => m.thread === root.id && m.body.length >= 6000).length >= 4, "long reports");
  assert.equal(corpus.project5k.messages.length, 5000);
});

test("message sizes follow the corpus distribution", () => {
  const sizes = corpus.project5k.messages.map((m) => m.body.length).sort((a, b) => a - b);
  const at = (p) => sizes[Math.floor(p * (sizes.length - 1))];
  assert.ok(Math.abs(at(0.5) - SIZES.median) / SIZES.median < 0.15, `median ${at(0.5)}`);
  assert.ok(Math.abs(at(0.95) - SIZES.p95) / SIZES.p95 < 0.15, `p95 ${at(0.95)}`);
  assert.ok(sizes.at(-1) <= SIZES.max);
  assert.ok(sizes[0] >= SIZES.min);
});

test("the benchmarks run on the small workspaces and report every prompt section", async () => {
  const context = await benchContext(["direct", "project2"]);
  assert.equal(context.project2.prompt.runs, corpus.project2.runs.length);
  assert.ok(context.project2.prompt.median > context.direct.prompt.median);
  assert.ok("history" in context.project2.sections && "actionGuide" in context.project2.sections);
  const sync = await benchSync(["direct"]);
  assert.ok(sync.direct.snapshotBytes > 0);
  assert.ok(sync.direct.streamingTickBytes > sync.direct.snapshotBytes);
});
