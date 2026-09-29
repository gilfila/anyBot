// `cd` in the context rail's Terminal: each command runs in a fresh shell, so
// the panel keeps the folder itself. Returns the absolute folder `argument`
// names from `cwd` (Windows or POSIX style), or null when it can't tell.
export function resolveCd(cwd, argument) {
  let target = String(argument || "").trim().replace(/^\/d\s+/i, "").trim();
  target = target.replace(/^"(.*)"$/, "$1");
  if (!target) return null;
  const windows = /^[a-z]:/i.test(target) || /^[a-z]:/i.test(cwd || "") || target.includes("\\");
  const sep = windows ? "\\" : "/";
  let base;
  let rest;
  if (/^[a-z]:/i.test(target)) {
    base = `${target.slice(0, 2).toUpperCase()}`;
    rest = target.slice(2);
  } else if (!windows && target.startsWith("/")) {
    base = "";
    rest = target;
  } else {
    if (!cwd) return null;
    const drive = /^[a-z]:/i.exec(cwd);
    base = drive ? drive[0].toUpperCase() : "";
    rest = `${drive ? cwd.slice(2) : cwd}${sep}${target}`;
  }
  const parts = [];
  for (const part of rest.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${base}${sep}${parts.join(sep)}`;
}
