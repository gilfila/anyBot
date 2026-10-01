// Where a message came from. Messages people send are all written with
// author "human", whether the owner typed them at the desktop app or they
// arrived through a bridge (a paired Slack user, a Buzz mention, a phone).
// Bridges label theirs, so later rules (budgets, approvals, proposals) can
// tell the owner at the desk from everyone else. The label is kept in
// metadata `origin:<message id>` (no schema change), written with the
// message; a message without one was typed in the desktop app.
//
// Labels hold ids only (a Slack team, user and channel, a Buzz channel name,
// a phone member id), never message text.

export const ORIGIN_VIAS = ["slack", "buzz", "phone", "bridge"];
const ID = /^[\w.:#@-]{1,100}$/;
const FIELDS = { slack: ["team", "user", "channel"], buzz: ["channel"], phone: ["member"], bridge: [] };

export const originKey = (messageId) => `origin:${messageId}`;

// A bridge's label, cleaned: unknown ways in, or a claim to be the desktop
// app, become the generic "bridge" (never the owner's desk); unknown fields
// and anything that isn't a short id are dropped.
export function originLabel(value) {
  const via = ORIGIN_VIAS.includes(value?.via) ? value.via : "bridge";
  const label = { via };
  for (const field of FIELDS[via]) if (typeof value[field] === "string" && ID.test(value[field])) label[field] = value[field];
  return label;
}

// A stored label, read back. One that can't be read is a bridge's.
export function parseOrigin(text) {
  try {
    return originLabel(JSON.parse(text));
  } catch {
    return { via: "bridge" };
  }
}

// Only a message typed in the desktop app carries the owner's own authority
// (for approvals and proposals); everything from a bridge is a guest's until
// a later rule says otherwise.
export const ownerAuthority = (origin) => origin?.via === "desktop";
