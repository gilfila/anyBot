// Classification for problems the coordinator reports to the desktop
// diagnostics log. Harness errors arrive as free text from five different
// CLIs, so the cause is matched on wording; "exit" is the fallback.
export function classifyRunError(message) {
  const text = String(message);
  if (/is not installed or its launcher is unsupported/i.test(text)) return "not_installed";
  if (/exceeded its configured .*time limit/i.test(text)) return "timeout";
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
