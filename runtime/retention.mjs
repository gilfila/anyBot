// What the workspace keeps, and for how long (docs/architecture/metrics.md).
// Full prompts are for debugging recent runs; their sizes and hashes stay.
export const KEEP_PROMPTS = 50;
export const EVENT_DAYS = 90;

// Blanks the prompt text of every run input but the newest `keep`.
export function prunePrompts(store, keep = KEEP_PROMPTS) {
  return store.run(
    `UPDATE run_inputs SET prompt='' WHERE prompt!='' AND rowid NOT IN (
      SELECT rowid FROM run_inputs ORDER BY rowid DESC LIMIT ?)`,
    Math.max(0, Math.floor(keep)),
  ).changes;
}

// Drops audit events older than `days`.
export function pruneEvents(store, days = EVENT_DAYS, clock = Date.now) {
  const cutoff = new Date(clock() - days * 86_400_000).toISOString();
  return store.run("DELETE FROM events WHERE created < ?", cutoff).changes;
}
