// Classification for problems the coordinator reports to the desktop
// diagnostics log. Harness errors arrive as free text from five different
// CLIs, so the cause is matched on wording; "exit" is the fallback.
export function classifyRunError(message) {
  const text = String(message);
  if (/is not installed or its launcher is unsupported/i.test(text)) return "not_installed";
  if (/exceeded its configured .*time limit/i.test(text)) return "timeout";
  if (/safety limit for one run/i.test(text)) return "output_limit";
  if (
    /usage credits|usage limit|rate.?limit|quota|limit reached|too many requests|\b429\b|out of credits|insufficient (credits|balance|funds)|billing/i.test(
      text,
    )
  )
    return "usage_limit";
  // Checked before auth: its own message mentions "Check login".
  if (/without an assistant response/i.test(text)) return "no_response";
  if (/not logged in|log ?in|sign ?in|unauthori[sz]ed|authenticat|api key|\b401\b|\b403\b|credentials?\b/i.test(text))
    return "auth";
  if (/unknown model|invalid model|model\b.{0,60}\b(not found|not available|not supported|does not exist)/i.test(text))
    return "model";
  if (/\b(ENOENT|EACCES|EPERM)\b|spawn/i.test(text)) return "launch";
  return "exit";
}

// Validation errors are expected answers to bad input. Engine errors (a
// TypeError from a code path, a SQLite failure) are bugs worth logging.
export function isUnexpected(error) {
  if (!error) return false;
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError)
    return true;
  return /SQLITE_|constraint failed|database is locked|no such (table|column)/i.test(String(error.message));
}

// Diagnostics never carry paths (they name the owner's folders and files).
// A path becomes <path>, except that a code file keeps its name and line, so
// a stack trace still says where it failed: file:///C:/…/coordinator.mjs:220:14
// becomes <path>/coordinator.mjs:220:14.
// A drive path (C:\, C:/), a network path (\\server\), or a rooted one with
// two or more parts (/home/…), each optionally as a file:// URL.
const START = String.raw`(?:file:\/\/\/?)?(?:(?<!\w)[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|(?<![\w:.])\/(?=[\w.~-]+\/))`;
// Folder names can hold spaces. A quoted path (as Node's errors quote them)
// runs to its closing quote. An unquoted one takes each further
// space-separated part that still holds a separator, so a stack frame under
// "C:\Program Files\Any Bot\…" goes whole; only a last part with a space
// and no separator ("…\file name.txt") can be left over.
const QUOTED = new RegExp(String.raw`(['"\`])(${START}[^'"\`\r\n]*)\1`, "g");
const PART = String.raw`[^\s"'\`()<>|]`;
const PATH = new RegExp(String.raw`${START}${PART}*(?: ${PART}*[\\/]${PART}*)*`, "g");
const scrubOne = (path) => {
  const code = /[\\/]([\w.-]+\.(?:mjs|cjs|js|jsx))(:\d+(?::\d+)?)?$/.exec(path);
  return code ? `<path>/${code[1]}${code[2] || ""}` : "<path>";
};
export function scrubPaths(text) {
  return String(text ?? "")
    .replace(QUOTED, (_, quote, path) => `${quote}${scrubOne(path)}${quote}`)
    .replace(PATH, scrubOne);
}

// The coordinator process's last word: a throw nothing caught is reported
// once, then the process exits so the desktop restarts it (desktop/main.cjs).
export function crashEntry(error, origin, code = "runtime.uncaught") {
  const message = error instanceof Error ? error.message : String(error);
  return {
    level: "error",
    source: "runtime",
    code,
    message: scrubPaths(message).slice(0, 600),
    detail: error instanceof Error && error.stack ? scrubPaths(error.stack).slice(0, 4000) : undefined,
    context: { origin },
  };
}
// A rejected promise nobody handled is reported (at most once a minute per
// message) and the process keeps running, as Electron's utility process does
// by default: before 0.3.37 it was only a warning on stderr, and exiting on
// one would cut off every running bot. A throw nothing caught still exits,
// after `stop()` has kept new work from starting in the meantime.
const REJECTION_REPORT_MS = 60_000;
export function installCrashHandlers(target, { report, exit, stop = () => {}, now = Date.now }) {
  let crashed = false;
  const crash = (error) => {
    if (crashed) return;
    crashed = true;
    try {
      stop();
    } catch {
      // Stopping is best effort (the coordinator may not exist yet); exiting is not.
    }
    try {
      report(crashEntry(error, "uncaughtException"));
    } catch {
      // Reporting is best effort; exiting is not.
    }
    exit(1);
  };
  const reported = new Map(); // message -> when it was last reported
  const rejected = (error) => {
    if (crashed) return;
    const entry = crashEntry(error, "unhandledRejection", "runtime.unhandled_rejection");
    const at = now();
    if (at - (reported.get(entry.message) ?? -Infinity) < REJECTION_REPORT_MS) return;
    if (reported.size > 100) reported.clear();
    reported.set(entry.message, at);
    try {
      report(entry);
    } catch {
      // Best effort.
    }
  };
  // With --unhandled-rejections=strict a rejection arrives as an uncaught
  // exception whose origin says so; it is treated as a rejection all the same.
  target.on("uncaughtException", (error, origin) => (origin === "unhandledRejection" ? rejected(error) : crash(error)));
  target.on("unhandledRejection", (error) => rejected(error));
}
