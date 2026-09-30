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
const PATH = /(?:file:\/\/\/?)?(?:(?<!\w)[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|(?<![\w:.])\/(?=[\w.~-]+\/))[^\s"'`()<>|]*/g;
export function scrubPaths(text) {
  return String(text ?? "").replace(PATH, (path) => {
    const code = /[\\/]([\w.-]+\.(?:mjs|cjs|js|jsx))(:\d+(?::\d+)?)?$/.exec(path);
    return code ? `<path>/${code[1]}${code[2] || ""}` : "<path>";
  });
}

// The coordinator process's last word: an error nothing caught (a throw, or
// a promise nobody awaited) is reported once, then the process exits so the
// desktop restarts it (desktop/main.cjs). `origin` says which kind it was.
export function crashEntry(error, origin) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    level: "error",
    source: "runtime",
    code: "runtime.uncaught",
    message: scrubPaths(message).slice(0, 600),
    detail: error instanceof Error && error.stack ? scrubPaths(error.stack).slice(0, 4000) : undefined,
    context: { origin },
  };
}
export function installCrashHandlers(target, { report, exit }) {
  let crashed = false;
  const crash = (error, origin) => {
    if (crashed) return;
    crashed = true;
    try {
      report(crashEntry(error, origin));
    } catch {
      // Reporting is best effort; exiting is not.
    }
    exit(1);
  };
  target.on("uncaughtException", (error, origin) => crash(error, origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException"));
  target.on("unhandledRejection", (error) => crash(error, "unhandledRejection"));
}
