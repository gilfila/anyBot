import test from "node:test";
import assert from "node:assert/strict";
import { plainNotes } from "../src/lib/update-notes.js";
import { changelogSection } from "../scripts/release-policy.mjs";

test("feed release notes show as plain text without the download boilerplate", () => {
  const html =
    '<p>Windows installer and automatic update files.</p>\n<p><a href="https://github.com/gilfila/anyBot-updates/releases/download/v0.3.15/anyBot-Setup-0.3.15.exe">Download the Windows installer</a></p>\n<!-- source-commit: abc -->';
  assert.equal(plainNotes(html), "");
  const changelog = "<h3>Added</h3>\n<ul>\n<li><strong>Threads.</strong> Bots reply under your message &amp; &lt;stay&gt; tidy.</li>\n</ul>";
  assert.equal(plainNotes(changelog), "Added\nThreads. Bots reply under your message & <stay> tidy.");
  assert.equal(plainNotes("a".repeat(300), 280), `${"a".repeat(280)}…`);
  assert.equal(plainNotes(undefined), "");
});

test("the release notes are the version's CHANGELOG entry", () => {
  const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.3.16] - 2026-09-24\n\n### Fixed\n- One\n\n## [0.3.15] - 2026-09-24\n\n### Added\n- Two\n";
  assert.equal(changelogSection(changelog, "0.3.16"), "### Fixed\n- One");
  assert.equal(changelogSection(changelog, "0.3.15"), "### Added\n- Two");
  assert.equal(changelogSection(changelog, "0.3.1"), "");
});
