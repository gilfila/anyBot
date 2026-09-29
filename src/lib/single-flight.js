// Runs `task` at most once at a time. A call while it runs asks for one more
// run after it (however many calls came in), so bursts of change pushes
// (up to ten a second while bots stream) load one snapshot at a time
// instead of queueing a full snapshot per push. Returns the current run.
export function singleFlight(task) {
  let running = null;
  let again = false;
  return function trigger() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await task();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
