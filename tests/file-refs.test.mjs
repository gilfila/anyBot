import test from "node:test";
import assert from "node:assert/strict";
import { fileTooltip, pathShape } from "../src/lib/file-refs.js";
import { fileCandidates, renderMarkdownInline } from "../src/lib/markdown.js";

const candidates = (text, platform = "win32") => fileCandidates([text], platform);
const found = (state = "file", extra = {}) => ({
  state,
  kind: "text",
  action: "preview",
  open: true,
  reveal: true,
  preview: "text",
  path: "C:\\canonical\\path.md",
  name: "path.md",
  size: 2048,
  ...extra,
});
// A lookup that says `existing` paths exist and everything else is `other`.
const lookupOf = (existing, other = { state: "missing" }) => (raw) => (existing.includes(raw) ? found() : other);
const render = (text, lookup, platform = "win32") => renderMarkdownInline(text, { files: { platform, lookup } });

test("real examples give the exact candidates, space variants included", () => {
  const videos = "C:/Users/Tony/Videos/2026-09-28";
  assert.deepEqual(candidates("C:/Users/Tony/Videos/2026-09-28 21-47-22.mp4 for you."), [
    videos,
    `${videos} 21-47-22.mp4`,
    `${videos} 21-47-22.mp4 for`,
    `${videos} 21-47-22.mp4 for you`,
  ]);
  assert.deepEqual(candidates("`C:\\Users\\Tony\\Videos\\2026-09-28 21-47-22.mp4`"), [
    "C:\\Users\\Tony\\Videos\\2026-09-28 21-47-22.mp4",
  ]);
  // JSON keeps its doubled backslashes; main collapses them.
  assert.deepEqual(candidates('{"out": "C:\\\\Users\\\\Tony\\\\Videos"}'), ["C:\\\\Users\\\\Tony\\\\Videos"]);
  assert.deepEqual(candidates("saved in C:/Users/Tony/Videos/edited/: done"), ["C:/Users/Tony/Videos/edited/"]);
  assert.deepEqual(candidates("(C:\\Users\\Tony\\autoEditor\\src\\transcribe.ts)"), [
    "C:\\Users\\Tony\\autoEditor\\src\\transcribe.ts",
  ]);
  assert.deepEqual(candidates("autoEditor/render/scripts/filler-cut.mjs, then reports/x.md."), [
    "autoEditor/render/scripts/filler-cut.mjs",
    "reports/x.md",
  ]);
  assert.deepEqual(candidates(".claude/settings.json and ~/.claude/settings.json"), [
    ".claude/settings.json",
    "~/.claude/settings.json",
  ]);
  assert.deepEqual(candidates("see src/app.ts:42"), ["src/app.ts"]);
  assert.deepEqual(candidates("[App](src/App.jsx#L10)"), ["src/App.jsx"]);
  assert.deepEqual(candidates("[notes](my%20notes/a.md)"), ["my notes/a.md"]);
  assert.deepEqual(candidates("C:\\R&D\\plan.md"), ["C:\\R&D\\plan.md"]);
  assert.deepEqual(candidates("C:\\x\\a (1).md"), ["C:\\x\\a", "C:\\x\\a (1).md"]);
  // Quoted paths with spaces come first; unquoted fragments follow.
  const quoted = candidates('"C:\\Program Files\\x y\\a.txt" and \'C:\\a b\\c.md\' and “~/My Files/a.md”');
  assert.deepEqual(quoted.slice(0, 3), ["C:\\Program Files\\x y\\a.txt", "C:\\a b\\c.md", "~/My Files/a.md"]);
  assert.deepEqual(candidates("it's 'C:\\a b\\c.md'")[0], "C:\\a b\\c.md");
  assert.deepEqual(candidates("don't 'quote' this"), []);
});

test("URLs, commands, prose, and unsafe shapes never become candidates", () => {
  for (const text of [
    "/",
    "/permissions",
    "/favicon.ico",
    "`/model`",
    "try/catch",
    "read / write",
    "and/or",
    "1/2.5",
    "2026/09/28",
    "https://x.dev/a/b.md",
    "[x](https://x.dev/a/b.md)",
    "`npm run build`",
    "--out=dist/x.js",
    "C:foo.txt",
    "\\\\server\\share\\x.md",
    "//server/share/x.md",
    "\\\\?\\C:\\x.md",
    "\\\\.\\pipe\\x",
    "file://host/x.md",
    "C:\\x\\evil.exe::$DATA",
    "`~`",
  ])
    assert.deepEqual(candidates(text), [], text);
  assert.ok(!candidates("C:\\a.md C:\\b.md").includes("C:\\a.md C"));
  assert.deepEqual(candidates("C:\\a.md C:\\b.md"), ["C:\\a.md", "C:\\b.md"]);
  // Fenced code is never scanned: MessageContent strips it before calling this.
  assert.equal(pathShape("read / write", { bare: true }), null);
  assert.equal(pathShape("C:\\x\\a.md:x"), null);
});

test("a path links only once main says it exists, as a keyboard-reachable span", () => {
  const lookup = lookupOf(["C:\\x\\a.md"]);
  assert.equal(
    render("See C:\\x\\a.md.", lookup),
    'See <span class="file-link" role="link" tabindex="0" data-file-ref="C:\\x\\a.md" data-kind="text" data-action="preview" title="C:\\canonical\\path.md\nText · 2.0 KB\nClick to preview · Shift+click to show in folder · Right-click for more">C:\\x\\a.md</span>.',
  );
  // Inside code the span sits inside <code>; a line suffix stays in the text.
  assert.match(render("`C:\\x\\a.md`", lookup), /^<code><span class="file-link"[^>]*>C:\\x\\a\.md<\/span><\/code>$/);
  assert.match(render("C:\\x\\a.md:42 here", lookup), /data-file-ref="C:\\x\\a\.md"[^>]*>C:\\x\\a\.md:42<\/span> here$/);
  assert.match(render("[the plan](C:/x/a.md#L3)", lookupOf(["C:/x/a.md"])), /data-file-ref="C:\/x\/a\.md"[^>]*>the plan<\/span>$/);
  assert.match(render("**C:\\x\\a.md**", lookup), /^<strong><span class="file-link"[^>]*>C:\\x\\a\.md<\/span><\/strong>$/);
  // A file that can't be opened says so on the element.
  const reveal = () => found("file", { open: false, action: "reveal", reason: "runs-programs", name: "setup.exe" });
  assert.match(render("C:\\x\\setup.exe", reveal), /data-action="reveal" data-open="no"/);
});

test("the longest existing variant wins, and hits inside a linked range are skipped", () => {
  const text = "Saved C:/v/2026-09-28 21-47-22.mp4 for you.";
  const html = render(text, lookupOf(["C:/v/2026-09-28", "C:/v/2026-09-28 21-47-22.mp4"]));
  assert.match(html, /^Saved <span [^>]*data-file-ref="C:\/v\/2026-09-28 21-47-22\.mp4"[^>]*>C:\/v\/2026-09-28 21-47-22\.mp4<\/span> for you\.$/);
  // "b\c.md" inside the linked quoted path is not linked again.
  const quoted = render("'C:\\a b\\c.md'", lookupOf(["C:\\a b\\c.md", "b\\c.md"]));
  assert.equal((quoted.match(/file-link/g) || []).length, 1);
  // An unlinked quote stays text, so a real path inside it can still link.
  assert.match(render('"see src/a.md now"', lookupOf(["src/a.md"])), /&quot;see <span [^>]*>src\/a\.md<\/span> now&quot;/);
});

test("missing, refused, unknown, and pending paths render exactly as without file links", () => {
  const samples = [
    "See C:\\x\\a.md and `C:\\x\\b.md` and [c](src/c.md) and \"C:\\a b\\c.md\" **bold** *em* https://e.com/a.md",
    "C:/v/2026-09-28 21-47-22.mp4 for you. @Alex",
    "[**bold label**](src/c.md) and [x](file:///C:/secret)",
    // The inputs of tests/markdown.test.mjs.
    '<img src=x onerror="alert(1)"> <script>x()</script>',
    "[x](javascript:alert(1))",
    "[x](data:text/html,hi)",
    "[docs](https://example.com)",
    "[mail](mailto:a@b.co)",
    '[x](https://e.com/" onmouseover="alert(1))',
    "See https://example.com/docs.",
    '"https://example.com"',
    "`**not bold** https://x.dev`",
    "**a** *b* `c`",
    "Ask @[Morgan](agent:1a2b3c4d-0000) about @[Pricing <page>](task:9f8e7d6c)",
    "@Alex Kim and @morgan, ping @Sage",
    "mail alex@Alex.dev",
    "`@Alex` @Alexander",
  ];
  for (const text of samples) {
    const plain = renderMarkdownInline(text, { people: ["Alex"] });
    for (const state of ["missing", "refused", "unknown"])
      assert.equal(renderMarkdownInline(text, { people: ["Alex"], files: { platform: "win32", lookup: () => ({ state }) } }), plain, `${state}: ${text}`);
    assert.equal(renderMarkdownInline(text, { people: ["Alex"], files: { platform: "win32", lookup: () => undefined } }), plain, text);
  }
});

test("attributes are built from the escaped raw path, and injections next to paths stay escaped", () => {
  const all = () => found("file", { path: 'C:\\x\\"><img src=x onerror=alert(1)>.md', name: '"><b>.md' });
  assert.match(render("C:\\R&D\\plan.md", all), /data-file-ref="C:\\R&amp;D\\plan\.md"/);
  for (const text of ['"onmouseover=alert(1) C:\\x\\a.md"', "<img src=x onerror=alert(1)> C:\\x\\a.md", "C:\\x\\a.md<script>x()</script>"]) {
    const html = render(text, all);
    assert.ok(!/<img|<script|<b>/.test(html), html);
    for (const [, value] of html.matchAll(/(?:data-file-ref|title)="([^"]*)"/g)) assert.ok(!/[<"]/.test(value), value);
    assert.ok(!/\sonmouseover=/.test(html.replace(/"[^"]*"/g, "")), html);
  }
});

test("candidates are capped at 64 with every hit's shortest form first, and long input gives none", () => {
  const many = Array.from({ length: 100 }, (_, i) => `C:\\x\\f${i}.md`).join(" ");
  const list = candidates(many);
  assert.equal(list.length, 64);
  assert.deepEqual(list.slice(0, 3), ["C:\\x\\f0.md", "C:\\x\\f1.md", "C:\\x\\f2.md"]);
  const spaced = candidates("C:\\x\\a one two C:\\y\\b three");
  assert.deepEqual(spaced.slice(0, 2), ["C:\\x\\a", "C:\\y\\b"]);
  assert.deepEqual(candidates(`C:\\${"a".repeat(1100)}.md`), []);
  assert.deepEqual(candidates(`\`C:\\x\\${"a".repeat(1100)}.md\``), []);
});

test("posix paths link off Windows only", () => {
  assert.deepEqual(candidates("/Users/tony/notes/a.md", "posix"), ["/Users/tony/notes/a.md"]);
  assert.deepEqual(candidates("/Users/tony/notes/a.md", "win32"), []);
  assert.deepEqual(candidates("`/model` and /permissions", "posix"), []);
});

test("tooltips say what a click does", () => {
  assert.equal(
    fileTooltip({ state: "file", path: "C:\\v\\clip.mp4", name: "clip.mp4", kind: "video", size: 84.2 * 1024 * 1024, action: "open", open: true, reveal: true }),
    "C:\\v\\clip.mp4\nVideo · 84.2 MB\nClick to open · Shift+click to show in folder · Right-click for more",
  );
  assert.match(
    fileTooltip({ state: "file", path: "C:\\d\\setup.exe", name: "setup.exe", kind: "other", size: 10, action: "reveal", reason: "runs-programs", reveal: true }),
    /This \.exe file can run programs, so Any Bot won't open it\. Click to show it in its folder\.$/,
  );
  assert.match(fileTooltip({ state: "file", path: "C:\\x.lnk", name: "x.lnk", action: "menu" }), /Shortcut files aren't opened from chat/);
  assert.match(fileTooltip({ state: "folder", path: "C:\\x", name: "x", action: "open", reveal: true }), /^C:\\x\nFolder\nClick to open the folder/);
});
