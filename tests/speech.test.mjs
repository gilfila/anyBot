import test from "node:test";
import assert from "node:assert/strict";
import { speechChunks, splitSentences, toSpeech } from "../src/lib/speech.js";

test("code blocks and artifact manifests are never read aloud", () => {
  const spoken = toSpeech(
    'Fixed the bug.\n\n```js\nconst secret = 1;\n```\n\n```anybot-artifacts\n{"paths":["a.md"]}\n```',
  );
  assert.ok(!spoken.includes("const"), spoken);
  assert.ok(!spoken.includes("paths"), spoken);
  assert.match(spoken, /^Fixed the bug\./);
  assert.match(spoken, /full details are in the chat/);
});

test("markdown markup, links and HTML are stripped", () => {
  const spoken = toSpeech(
    "## Summary\n- **Bold** item with `code`\n- See [the docs](https://example.com) or https://x.io/y\n\nsafe <script>text</script>.",
    { maxSentences: 5 },
  );
  assert.equal(spoken, "Summary. Bold item with code. See the docs or a link. safe text.");
  assert.ok(!/[#*`<>\[\]]/.test(spoken), spoken);
});

test("tables are left in the chat", () => {
  const spoken = toSpeech("Results:\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.equal(spoken, "Results: The full details are in the chat.");
});

test("long replies are cut to a few sentences with a pointer to the chat", () => {
  const spoken = toSpeech("One. Two. Three. Four. Five.");
  assert.equal(spoken, "One. Two. Three. The full details are in the chat.");
  const short = toSpeech("Done. All tests pass.");
  assert.equal(short, "Done. All tests pass.");
});

test("a single very long sentence is truncated at a word boundary", () => {
  const spoken = toSpeech(`${"word ".repeat(200)}end.`, { maxChars: 50 });
  assert.ok(spoken.startsWith("word word"), spoken);
  assert.ok(spoken.length < 100, spoken);
});

test("empty and code-only replies", () => {
  assert.equal(toSpeech(""), "");
  assert.equal(toSpeech("```\nx\n```"), "The full details are in the chat.");
});

test("sentence splitting and chunking keep every word", () => {
  assert.deepEqual(splitSentences("Hi there. How are you? Fine!"), ["Hi there.", "How are you?", "Fine!"]);
  assert.deepEqual(splitSentences("Saved report.md in v0.2.27. Done"), ["Saved report.md in v0.2.27.", "Done"]);
  const text = "Alpha beta gamma. ".repeat(30).trim();
  const chunks = speechChunks(text, 60);
  assert.ok(chunks.every((chunk) => chunk.length <= 60), JSON.stringify(chunks));
  assert.equal(chunks.join(" "), text);
});
