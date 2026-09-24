import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, renderMarkdownInline } from "../src/lib/markdown.js";

test("employee output is HTML-escaped before markdown is applied", () => {
  const html = renderMarkdownInline('<img src=x onerror="alert(1)"> <script>x()</script>');
  assert.ok(!html.includes("<img"), html);
  assert.ok(!html.includes("<script"), html);
  assert.ok(html.includes("&lt;img"), html);
});

test("markdown links only allow http, https, and mailto", () => {
  for (const unsafe of ["[x](javascript:alert(1))", "[x](JavaScript:void0)", "[x](data:text/html,hi)", "[x](file:///C:/secret)"]) {
    assert.ok(!renderMarkdownInline(unsafe).includes("<a"), unsafe);
  }
  assert.match(renderMarkdownInline("[docs](https://example.com)"), /<a href="https:\/\/example.com"/);
  assert.match(renderMarkdownInline("[mail](mailto:a@b.co)"), /<a href="mailto:a@b.co"/);
});

test("attribute breakout through a link href is escaped", () => {
  const html = renderMarkdownInline('[x](https://e.com/" onmouseover="alert(1))');
  assert.ok(!/href="[^"]*"\s+onmouseover=/.test(html), html);
});

test("bare URLs become links without swallowing trailing punctuation", () => {
  const html = renderMarkdownInline("See https://example.com/docs.");
  assert.match(html, /<a href="https:\/\/example.com\/docs"[^>]*>https:\/\/example.com\/docs<\/a>\.$/);
});

test("bare URLs stop at escaped quotes", () => {
  const html = renderMarkdownInline('"https://example.com"');
  assert.match(html, /href="https:\/\/example.com"/);
});

test("markdown syntax inside code spans is left alone", () => {
  const html = renderMarkdownInline("`**not bold** https://x.dev`");
  assert.equal(html, "<code>**not bold** https://x.dev</code>");
});

test("bold, italic, and code render", () => {
  assert.equal(renderMarkdownInline("**a** *b* `c`"), "<strong>a</strong> <em>b</em> <code>c</code>");
});

test("doc mentions render as inert chips only when enabled", () => {
  const token = "Ask @[Morgan](agent:1a2b3c4d-0000) about @[Pricing <page>](task:9f8e7d6c)";
  assert.ok(!renderMarkdownInline(token).includes("data-mention"));
  const html = renderMarkdownInline(token, { mentions: true });
  assert.match(html, /<span class="mention mention-agent" data-mention="agent:1a2b3c4d-0000">@Morgan<\/span>/);
  assert.match(html, /data-mention="task:9f8e7d6c">@Pricing &lt;page&gt;<\/span>/);
  assert.ok(!renderMarkdownInline('@[x](task:abc" onclick="y)', { mentions: true }).includes("data-mention"));
});

test("escapeHtml covers quotes and ampersands", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("bot @mentions are highlighted, but not emails, code, or unknown names", () => {
  const people = ["Alex", "Alex Kim", "Morgan"];
  assert.equal(
    renderMarkdownInline("@Alex Kim and @morgan, ping @Sage", { people }),
    '<span class="mention mention-agent">@Alex Kim</span> and <span class="mention mention-agent">@morgan</span>, ping @Sage',
  );
  assert.equal(renderMarkdownInline("mail alex@Alex.dev", { people }), "mail alex@Alex.dev");
  assert.equal(renderMarkdownInline("`@Alex` @Alexander", { people }), "<code>@Alex</code> @Alexander");
  assert.match(renderMarkdownInline('@<b>Alex</b>', { people: ["<b>Alex</b>"] }), /@&lt;b&gt;Alex&lt;\/b&gt;<\/span>$/);
});
