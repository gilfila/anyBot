// The window's own chrome, kept free of Electron so node:test can load it
// (tests/window-shell.test.mjs): the right-click menu, where a clicked
// notification goes, and which file: requests the window may make.
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const MAX_SUGGESTIONS = 5;

// The right-click menu for Electron's context-menu params, as plain items
// main turns into a Menu: { role, enabled } for the edit commands, or
// { action: "replace" | "openLink" | "copyLink", label, value }. Web links
// only (isWebUrl); anything else gets no link items. An empty list means no
// menu. The renderer's own menus (file links) call preventDefault, and then
// Electron never asks for this one.
function contextMenuItems(params = {}, isWebUrl = () => false) {
  const flags = params.editFlags || {};
  const groups = [];
  if (params.isEditable && params.misspelledWord) {
    const words = (params.dictionarySuggestions || []).filter((word) => typeof word === "string" && word).slice(0, MAX_SUGGESTIONS);
    groups.push(
      words.length
        ? words.map((word) => ({ action: "replace", label: word, value: word }))
        : [{ label: "No spelling suggestions", enabled: false }],
    );
  }
  if (params.linkURL && isWebUrl(params.linkURL))
    groups.push([
      { action: "openLink", label: "Open link in browser", value: params.linkURL },
      { action: "copyLink", label: "Copy link address", value: params.linkURL },
    ]);
  if (params.isEditable) {
    groups.push([
      { role: "cut", enabled: Boolean(flags.canCut) },
      { role: "copy", enabled: Boolean(flags.canCopy) },
      { role: "paste", enabled: Boolean(flags.canPaste) },
    ]);
    groups.push([{ role: "selectAll", enabled: flags.canSelectAll !== false }]);
  } else if (String(params.selectionText || "").trim()) {
    groups.push([{ role: "copy", enabled: flags.canCopy !== false }]);
  }
  return groups.flatMap((group, index) => (index ? [{ type: "separator" }, ...group] : group));
}

// A notification's place in the app, as ids the renderer resolves against
// its snapshot (src/lib/navigation.js). Anything else is dropped.
const ID = /^[A-Za-z0-9-]{1,100}$/;
function navigationTarget(value) {
  if (!value || typeof value !== "object") return null;
  const target = {};
  for (const key of ["conversation", "thread", "task", "run", "approval", "message"])
    if (typeof value[key] === "string" && ID.test(value[key])) target[key] = value[key];
  return Object.keys(target).length ? target : null;
}

// Whether main cancels a request from the window or a frame in it (its
// webRequest.onBeforeRequest): a file: URL with a host, which is an SMB
// request that sends the NTLM hash, and a file: URL outside the app's own
// folder `root`. The page CSP can't stop either ('self' on a file: page
// matches file://host), and bot HTML shown in chat can ask for one through
// CSS or SVG. Other schemes are left to the CSP.
function fileRequestBlocked(url, root, platform = process.platform) {
  const text = String(url || "");
  if (!/^file:/i.test(text)) return false;
  try {
    const parsed = new URL(text);
    if (parsed.host) return true;
    const p = platform === "win32" ? path.win32 : path.posix;
    const rel = p.relative(root, fileURLToPath(parsed, { windows: platform === "win32" }));
    return !rel || rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel);
  } catch {
    return true;
  }
}

module.exports = { contextMenuItems, fileRequestBlocked, navigationTarget };
