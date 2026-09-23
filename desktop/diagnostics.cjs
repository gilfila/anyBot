// Local diagnostics log: one JSON object per line under <userData>/logs.
// It records problems only (source, code, message, ids, versions), never
// conversation text, and it stays on this computer. Nothing here may throw:
// diagnostics must never become a failure of their own.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const LEVELS = new Set(["error", "warn", "info"]);
const clip = (value, max) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const redact = (text) =>
  String(text)
    .replace(/\b(sk-[\w-]{12,}|AIza[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[\w-]{10,})\b/g, "[redacted]")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s"']+/gi, "$1[redacted]");
// Ids, numbers, and paths differ between occurrences of the same problem.
const shape = (message) =>
  String(message)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/[a-z]:\\[^\s"']+|(?:\/[\w.-]+){2,}/gi, "<path>")
    .replace(/\d+/g, "<n>")
    .slice(0, 200);
const fingerprint = (entry) =>
  crypto.createHash("sha1").update(`${entry.source}|${entry.code}|${shape(entry.message)}`).digest("hex").slice(0, 12);
const sanitizeContext = (context) => {
  const out = {};
  for (const [key, value] of Object.entries(context).slice(0, 12)) {
    if (value === null || value === undefined) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    out[clip(key, 40)] = typeof value === "string" ? clip(redact(value), 200) : value;
  }
  return out;
};

class DiagnosticsLog {
  constructor(userData, { version = "", now = () => new Date(), maxBytes = 1024 * 1024, keep = 2, burstMs = 10_000 } = {}) {
    this.directory = path.join(userData, "logs");
    this.file = path.join(this.directory, "diagnostics.jsonl");
    this.statePath = path.join(this.directory, "diagnostics-state.json");
    this.version = version;
    this.now = now;
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.burstMs = burstMs;
    this.recent = new Map();
    this.cache = null;
    this.state = this.readState();
  }
  older(index) {
    return path.join(this.directory, `diagnostics.${index}.jsonl`);
  }
  readState() {
    try {
      const state = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      return { seen: String(state.seen || ""), cleared: String(state.cleared || "") };
    } catch {
      return { seen: "", cleared: "" };
    }
  }
  writeState() {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(this.state));
    } catch {
      // Losing the seen marker only re-shows old issues.
    }
  }
  record(input = {}) {
    try {
      const entry = {
        time: this.now().toISOString(),
        level: LEVELS.has(input.level) ? input.level : "error",
        source: clip(input.source || "app", 40),
        code: clip(input.code || "unknown", 80),
        message: clip(redact(input.message || ""), 600),
        version: this.version,
      };
      if (input.detail) entry.detail = clip(redact(input.detail), 4000);
      if (input.context && typeof input.context === "object") entry.context = sanitizeContext(input.context);
      entry.fp = fingerprint(entry);
      // A problem firing in a tight loop is written once per burst window.
      const at = this.now().getTime();
      if (at - (this.recent.get(entry.fp) ?? -Infinity) < this.burstMs) return null;
      if (this.recent.size > 500) this.recent.clear();
      this.recent.set(entry.fp, at);
      fs.mkdirSync(this.directory, { recursive: true });
      this.rotate();
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
      this.cache?.push(entry);
      if (this.cache && this.cache.length > 5000) this.cache.splice(0, this.cache.length - 5000);
      return entry;
    } catch {
      return null;
    }
  }
  rotate() {
    let size = 0;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (size < this.maxBytes) return;
    fs.rmSync(this.older(this.keep), { force: true });
    for (let index = this.keep - 1; index >= 1; index--)
      if (fs.existsSync(this.older(index))) fs.renameSync(this.older(index), this.older(index + 1));
    fs.renameSync(this.file, this.older(1));
  }
  entries() {
    if (this.cache) return this.cache;
    const entries = [];
    for (const file of [...Array.from({ length: this.keep }, (_, i) => this.older(this.keep - i)), this.file]) {
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line));
        } catch {
          // A torn last line from a crash is skipped.
        }
      }
    }
    this.cache = entries.slice(-5000);
    return this.cache;
  }
  // Problems since the last Clear, grouped by fingerprint, newest first.
  groups({ limit = 100, levels = ["error", "warn"] } = {}) {
    const byFp = new Map();
    for (const entry of this.entries()) {
      if (!levels.includes(entry.level)) continue;
      if (this.state.cleared && entry.time <= this.state.cleared) continue;
      const group = byFp.get(entry.fp);
      if (group) {
        group.count++;
        group.last = entry.time;
        group.latest = entry;
      } else byFp.set(entry.fp, { fp: entry.fp, count: 1, first: entry.time, last: entry.time, latest: entry });
    }
    return [...byFp.values()]
      .sort((a, b) => b.last.localeCompare(a.last))
      .slice(0, limit)
      .map(({ latest, ...group }) => ({
        ...group,
        level: latest.level,
        source: latest.source,
        code: latest.code,
        message: latest.message,
        detail: latest.detail,
        context: latest.context,
        version: latest.version,
        unseen: !this.state.seen || group.last > this.state.seen,
      }));
  }
  summary() {
    const groups = this.groups({ limit: 1000 });
    return {
      issues: groups.length,
      unseen: groups.filter((group) => group.unseen).length,
      errors: groups.filter((group) => group.level === "error").length,
    };
  }
  markSeen() {
    this.state.seen = this.now().toISOString();
    this.writeState();
  }
  clear() {
    this.state.cleared = this.now().toISOString();
    this.state.seen = this.state.cleared;
    this.writeState();
  }
}

// Before quitAndInstall the updater records the version it expects to relaunch
// as. The next start compares: a mismatch means the installer failed.
function pendingUpdatePath(userData) {
  return path.join(userData, "update-pending.json");
}
function rememberPendingUpdate(userData, from, to, now = new Date()) {
  try {
    fs.writeFileSync(pendingUpdatePath(userData), JSON.stringify({ from, to, at: now.toISOString() }));
  } catch {
    // Without the marker a failed install is still reported by the user.
  }
}
function checkPendingUpdate(userData, currentVersion) {
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(pendingUpdatePath(userData), "utf8"));
  } catch {
    return null;
  }
  fs.rmSync(pendingUpdatePath(userData), { force: true });
  if (!pending?.to) return null;
  if (pending.to === currentVersion)
    return {
      level: "info",
      source: "updater",
      code: "update.installed",
      message: `Updated from ${pending.from} to ${pending.to}`,
      context: { from: pending.from, to: pending.to },
    };
  return {
    level: "error",
    source: "updater",
    code: "update.install_failed",
    message: `The update to ${pending.to} did not install: Any Bot started as ${currentVersion}.`,
    context: { from: pending.from, to: pending.to, running: currentVersion, attempted: pending.at },
  };
}

module.exports = { DiagnosticsLog, checkPendingUpdate, rememberPendingUpdate, fingerprint, redact };
