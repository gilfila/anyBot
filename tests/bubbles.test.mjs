import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BUBBLE_SHADES, bubbleBackground, bubbleColors, bubbleStyle } from "../src/lib/bubbles.js";
import { parseAvatarConfig, stringifyAvatarConfig } from "../src/lib/avatar-config.js";
import { THEMES, contrast } from "../src/themes/themes.js";

const robots = ["cobalt", "coral", "citron", "violet"];

test("every bubble tint keeps bot text readable in every theme", () => {
  for (const theme of THEMES)
    for (const { id } of bubbleColors)
      for (const robot of robots) {
        const background = bubbleBackground(id, robot, theme.scheme);
        const where = `${theme.id} / ${id} / ${robot}`;
        assert.ok(contrast(theme.tokens.ink, background) >= 7, `ink on ${where}`);
        assert.ok(contrast(theme.tokens["ink-2"], background) >= 4.5, `ink-2 on ${where}`);
        assert.ok(contrast(theme.tokens["accent-ink"], background) >= 4.5, `links on ${where}`);
      }
});

test("the CSS shades mirror the palette module", async () => {
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  const block = (selector) => css.slice(css.indexOf(`${selector} {\n  --bubble-l`)).split("}")[0];
  for (const [selector, shade] of [[":root", BUBBLE_SHADES.light], [':root[data-scheme="dark"]', BUBBLE_SHADES.dark]]) {
    const rules = block(selector);
    assert.match(rules, new RegExp(`--bubble-l: ${shade.l};`), selector);
    assert.match(rules, new RegExp(`--bubble-c: ${shade.c};`), selector);
    assert.match(rules, new RegExp(`--bubble-edge-l: ${shade.edgeL};`), selector);
    assert.match(rules, new RegExp(`--bubble-edge-c: ${shade.edgeC};`), selector);
  }
});

test("a bot's bubble choice survives the avatar round trip", () => {
  assert.equal(parseAvatarConfig('{"color":"coral"}', "Alex").bubble, "auto");
  assert.equal(parseAvatarConfig('{"color":"coral","bubble":"mint"}', "Alex").bubble, "mint");
  assert.equal(parseAvatarConfig('{"bubble":"<script>"}', "Alex").bubble, "auto");
  assert.equal(JSON.parse(stringifyAvatarConfig({ color: "violet", bubble: "rose" })).bubble, "rose");
  // Match robot follows the robot's color; a chosen tint ignores it.
  assert.deepEqual(bubbleStyle("auto", "cobalt"), { "--bubble-h": 265, "--bubble-k": 1 });
  assert.deepEqual(bubbleStyle("mint", "cobalt"), { "--bubble-h": 170, "--bubble-k": 1 });
  assert.deepEqual(bubbleStyle("plain", "coral"), { "--bubble-h": 90, "--bubble-k": 0 });
});
