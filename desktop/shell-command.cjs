// The context rail's Terminal: the owner's own shell (desktop/main.cjs
// anybot:runCommand). Bot output never reaches it.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const inside = (child, parent) => {
  const fold = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  const relative = path.relative(fold(parent), fold(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

// Where a command runs: the folder the renderer asked for (the conversation's
// first allowed folder or its bot's workspace) when it is an existing
// absolute folder, else the owner's home. Never Any Bot's own data folder,
// which holds the database and the Slack and phone secrets; only the bot
// workspaces kept inside it (<userData>/workspaces) are allowed.
function commandDirectory(requested, { home, userData }) {
  if (typeof requested !== "string" || !requested.trim() || !path.isAbsolute(requested)) return home;
  const folder = path.resolve(requested);
  if (userData && inside(folder, path.resolve(userData)) && !inside(folder, path.join(path.resolve(userData), "workspaces")))
    return home;
  try {
    return fs.statSync(folder).isDirectory() ? folder : home;
  } catch {
    return home;
  }
}

// Stops a command and everything it started (a dev server, a build).
function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32")
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
    // Spawned detached, so the command leads its own process group.
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
}

module.exports = { commandDirectory, killTree };
