// Adversarial review checkpoints with Codex CLI (docs/plans/lean-runtime.md §7).
//
//   node scripts/adversarial-review.mjs design --milestone M2 --section 3.2 [--files a.mjs,b.mjs]
//   node scripts/adversarial-review.mjs code --milestone M2 [--base main] [--focus "races between replies and deltas"]
//   add --dry-run to print the command and prompt size without running Codex
//
// Codex runs read-only: `codex exec --sandbox read-only` for designs and
// `codex review --base <branch>` for code. The report lands in
// docs/reviews/<date>-<milestone>-<mode>.md with a triage table to fill in.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveExecutable } from "../runtime/adapters.mjs";

const root = resolve(import.meta.dirname, "..");
const [mode, ...rest] = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[index + 1] : fallback;
};
const dryRun = rest.includes("--dry-run");
const milestone = flag("milestone");
if (!["design", "code"].includes(mode) || !/^M\d+$/.test(milestone)) {
  console.error("Usage: adversarial-review.mjs <design|code> --milestone M<n> [--section 3.2] [--files a,b] [--base main] [--focus text] [--dry-run]");
  process.exit(2);
}

const plan = readFileSync(join(root, "docs/plans/lean-runtime.md"), "utf8");
// A plan section ("### 3.2 …" up to the next heading of the same or higher level).
function section(number) {
  const lines = plan.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^#{2,3} ${number.replace(".", "\\.")}\\b`).test(line));
  if (start < 0) throw Error(`No section ${number} in the plan`);
  const depth = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= depth);
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}
// The milestone's own entry in §4, including its checkpoint focus.
const milestoneText = section("4").split(/\n(?=### )/).find((part) => part.startsWith(`### ${milestone} `)) || "";

const template = readFileSync(join(root, `docs/reviews/prompts/${mode}.md`), "utf8");
const files = flag("files").split(",").map((file) => file.trim()).filter(Boolean);
const prompt =
  mode === "design"
    ? `${template}\n\n---\nMilestone: ${milestone}\n\n${milestoneText}\n\nDesign section under review:\n\n${section(flag("section", "3"))}\n\n${
        files.length ? `Check it against these files first: ${files.join(", ")}.` : "Check it against the code it changes."
      }\n`
    : `${template}\n\n---\nMilestone: ${milestone}\n\n${milestoneText}\n${flag("focus") ? `\nFocus: ${flag("focus")}\n` : ""}`;

const codex = await resolveExecutable("codex");
// A dry run only shows what would run, so it works without Codex installed.
if (!codex && !dryRun) {
  console.error("Codex CLI not found. Install it and sign in (codex login).");
  process.exit(1);
}
const scratch = mkdtempSync(join(tmpdir(), "anybot-review-"));
const lastMessage = join(scratch, "last-message.md");
const args =
  mode === "design"
    ? ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-C", root, "-o", lastMessage, "-"]
    : ["review", "--base", flag("base", "main"), "-"];
if (dryRun) {
  console.log([...(codex ? [codex.file, ...codex.prefix] : ["codex"]), ...args].join(" "));
  console.log(`prompt: ${prompt.length} chars`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const version = execFileSync(codex.file, [...codex.prefix, "--version"], { encoding: "utf8" }).trim();
console.log(`Running ${version} (${mode} review of ${milestone})…`);
const output = await new Promise((done, fail) => {
  const child = spawn(codex.file, [...codex.prefix, ...args], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
  let text = "";
  child.stdout.on("data", (chunk) => (text += chunk));
  child.on("error", fail);
  child.on("close", (code) => (code === 0 ? done(text) : fail(Error(`Codex exited with ${code}`))));
  child.stdin.end(prompt);
});
const findings = (existsSync(lastMessage) ? readFileSync(lastMessage, "utf8") : output).replace(/\x1b\[[0-9;]*m/g, "").trim();
rmSync(scratch, { recursive: true, force: true });

mkdirSync(join(root, "docs/reviews"), { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const file = join(root, "docs/reviews", `${date}-${milestone}-${mode}.md`);
writeFileSync(
  file,
  `# ${milestone} ${mode} review\n\n- Date: ${date}\n- Commit: ${git("rev-parse", "--short", "HEAD")}${mode === "code" ? ` vs ${flag("base", "main")}` : ""}\n- Reviewer: ${version}, read-only\n- Prompt: docs/reviews/prompts/${mode}.md + ${mode === "design" ? `plan §${flag("section", "3")}` : "the milestone's risk list"}\n\n## Findings (raw)\n\n${findings}\n\n## Triage\n\nEvery finding gets a verdict. High and critical findings are fixed, or rejected with evidence, before merge.\n\n| # | Finding | Severity | Verdict | Evidence |\n|---|---|---|---|---|\n|  |  |  |  |  |\n`,
);
console.log(`Report: ${file}`);
