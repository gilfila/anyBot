import test from "node:test";
import assert from "node:assert/strict";
import { plainNotes } from "../src/lib/update-notes.js";
import { readFileSync } from "node:fs";
import { changelogSection, compareVersions, missingReleaseNotes } from "../scripts/release-policy.mjs";

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

test("a release's notes are never lost: every version heading the base had is still there", () => {
  const before = "## [Unreleased]\n\n## [0.3.38] - 2026-09-30\n\nBrakes.\n\n## [0.3.37] - 2026-09-29\n\nFloor.\n";
  const renamed = "## [Unreleased]\n\n## [0.3.39] - 2026-09-30\n\nReview.\n\nBrakes.\n\n## [0.3.37] - 2026-09-29\n\nFloor.\n";
  const kept = "## [Unreleased]\n\n## [0.3.39] - 2026-09-30\n\nReview.\n\n## [0.3.38] - 2026-09-30\n\nBrakes.\n\n## [0.3.37] - 2026-09-29\n\nFloor.\n";
  assert.deepEqual(missingReleaseNotes(before, renamed), ["0.3.38"]);
  assert.deepEqual(missingReleaseNotes(before, kept), []);
  assert.deepEqual(missingReleaseNotes("", kept), []);
});

test("the CHANGELOG has this version once, on top, and its notes fit the update card", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  assert.equal(headings[0], version);
  assert.equal(headings.filter((v) => v === version).length, 1);
  assert.equal(compareVersions(headings[1], version), -1, "the release before it has its own heading");
  const notes = changelogSection(changelog, version);
  assert.ok(notes.length > 0 && notes.length < 6000, `the ${version} notes are ${notes.length} characters; the updater cuts at 6000`);
  // The release before it keeps its own section.
  assert.ok(changelogSection(changelog, headings[1]).length > 0);
});
