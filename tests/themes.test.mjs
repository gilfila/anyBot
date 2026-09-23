import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DECOR, THEMES, TOKENS, contrast, parseOklch, themeById, toHex, validateTheme } from "../src/themes/themes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("every built-in theme is complete and readable", () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    ["paper", "matrix", "solarpunk", "cyberpunk"],
  );
  for (const theme of THEMES) assert.deepEqual(validateTheme(theme), [], theme.id);
  assert.equal(themeById("nope").id, "paper", "unknown ids fall back to the default");
});

test("Studio paper's data mirrors the :root tokens in style.css", async () => {
  const css = await read("src/style.css");
  const block = css.match(/\n:root \{([\s\S]*?)\n\}/)[1];
  const paper = themeById("paper");
  for (const key of TOKENS) {
    const value = block.match(new RegExp(`--${key}:\\s*([^;]+);`))?.[1].trim();
    assert.equal(value, paper.tokens[key], `--${key}`);
  }
  // The validated knowledge-graph palette is unchanged.
  assert.deepEqual(
    ["cat-agent", "cat-task", "cat-project"].map((key) => toHex(paper.tokens[key])),
    ["#2978d6", "#eb6834", "#1baf7a"],
  );
});

test("color math matches known values", () => {
  assert.equal(Math.round(contrast("oklch(0 0 0)", "oklch(1 0 0)")), 21);
  assert.equal(toHex("oklch(1 0 0)"), "#ffffff");
  assert.equal(toHex("oklch(0 0 0)"), "#000000");
  assert.deepEqual(parseOklch("oklch(62% 0.2 30 / 50%)"), { l: 0.62, c: 0.2, h: 30, alpha: 0.5 });
  assert.equal(parseOklch("#ffffff"), null);
});

test("validation rejects unreadable, incomplete, or unsafe themes", () => {
  const base = themeById("paper");
  const variant = (patch) => ({ ...base, id: "custom", name: "Custom", ...patch, tokens: { ...base.tokens, ...(patch.tokens || {}) } });
  assert.deepEqual(validateTheme(variant({})), []);
  assert.match(validateTheme(variant({ tokens: { "ink-2": base.tokens.paper } })).join(), /ink-2 on paper contrast/);
  assert.match(validateTheme(variant({ tokens: { ink: "red" } })).join(), /ink must be an oklch/);
  assert.match(validateTheme(variant({ tokens: { paper: "oklch(0.9 0 0 / 0.5)" } })).join(), /paper must be opaque/);
  assert.match(validateTheme(variant({ tokens: { "font-evil": "oklch(0.5 0 0)" } })).join(), /unknown token font-evil/);
  assert.match(validateTheme(variant({ decor: { backdrop: "iframe", chrome: "none", bubbles: "none" } })).join(), /decor\.backdrop/);
  assert.match(validateTheme(variant({ id: "Bad Id" })).join(), /id must be/);
  assert.match(validateTheme(variant({ scheme: "sepia" })).join(), /scheme/);
  const missing = variant({});
  delete missing.tokens.rule;
  assert.match(validateTheme(missing).join(), /token rule must be/);
  assert.deepEqual(validateTheme(null), ["A theme must be an object"]);
});

test("every decoration preset has styles, and the backdrop renders each kind", async () => {
  const css = await read("src/themes/themes.css");
  const backdrop = await read("src/components/theme/ThemeBackdrop.jsx");
  for (const [slot, values] of Object.entries(DECOR))
    for (const value of values.filter((v) => v !== "none")) assert.ok(css.includes(`[data-${slot}="${value}"]`), `${slot}=${value}`);
  for (const kind of DECOR.backdrop.filter((v) => v !== "none")) assert.ok(backdrop.includes(`kind === "${kind}"`), kind);
  // Decorative animation always has an off switch.
  assert.match(css, /:root\[data-motion="off"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
