// Lifecycle rules of the desktop shell (desktop/main.cjs), kept apart so they
// can be tested without Electron.

// One graceful stop for every way out: quitting, Settings → Quit, and
// installing an update. `stop()` runs once (later calls join it): `before`
// stops the gateways, then the coordinator is asked to shut down (it stops
// its runs and records them for the next start) and `stop()` resolves when it
// exits, or after `timeoutMs`, when it is killed.
function createShutdown({ worker: getWorker, before = () => {}, timeoutMs = 10_000 }) {
  let stopping = null;
  let stopped = false;
  return {
    stop() {
      if (stopping) return stopping;
      try {
        before();
      } catch {
        // A gateway that fails to stop must not keep the coordinator running.
      }
      stopping = new Promise((resolve) => {
        const worker = getWorker();
        if (!worker) return resolve();
        const timer = setTimeout(() => {
          try {
            worker.kill();
          } catch {
            // Already gone.
          }
          resolve();
        }, timeoutMs);
        timer.unref?.();
        worker.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          worker.postMessage({ type: "shutdown" });
        } catch {
          clearTimeout(timer);
          resolve();
        }
      }).then(() => {
        stopped = true;
      });
      return stopping;
    },
    get stopping() {
      return Boolean(stopping);
    },
    get stopped() {
      return stopped;
    },
  };
}

// The window's renderer crashed: reload it, unless it keeps crashing (more
// than `limit` times in `windowMs`), which a reload wouldn't fix.
function createCrashTracker({ limit = 3, windowMs = 120_000, now = Date.now } = {}) {
  let crashes = [];
  return {
    next() {
      const at = now();
      crashes = crashes.filter((time) => at - time < windowMs);
      crashes.push(at);
      return crashes.length > limit ? "give-up" : "reload";
    },
  };
}

// Coordinator restarts after unexpected exits: up to `limit` in a row, each
// waiting a second longer. One that stayed up for `stableMs` starts a new
// count, so crashes days apart never use up the limit. `exited()` returns the
// delay before the next start, or null to stop restarting.
function createRestartBudget({ limit = 3, stableMs = 10 * 60_000, now = Date.now } = {}) {
  let count = 0;
  let readyAt = null;
  return {
    ready() {
      readyAt = now();
    },
    exited() {
      if (readyAt !== null && now() - readyAt >= stableMs) count = 0;
      readyAt = null;
      if (count >= limit) return null;
      count += 1;
      return count * 1000;
    },
    get count() {
      return count;
    },
  };
}

// An update check that failed because this computer is offline (or the
// network isn't up yet after login or sleep), not because of the update.
const OFFLINE =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_CHANGED|NETWORK_IO_SUSPENDED|ADDRESS_UNREACHABLE|CONNECTION_(REFUSED|RESET|CLOSED|ABORTED|TIMED_OUT|FAILED)|TIMED_OUT|PROXY_CONNECTION_FAILED)|\b(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENETDOWN)\b/;
function isOfflineError(error) {
  return OFFLINE.test(`${error?.code || ""} ${error?.message || ""}`);
}

module.exports = { createShutdown, createCrashTracker, createRestartBudget, isOfflineError };
