import test from "node:test";
import assert from "node:assert/strict";
import { CARD_H, CARD_W, OWNER_H, layoutOrg, linkPath } from "../src/lib/org-layout.js";

const leaf = (id) => ({ id, children: [] });
const h = (n) => (n.id === "owner" ? OWNER_H : CARD_H);
const overlaps = (a, b) => a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + h(b) && b.y < a.y + h(a);

test("a big team stacks in one column under its manager", () => {
  const team = { id: "lead", children: ["a", "b", "c", "d", "e"].map(leaf) };
  const { nodes, links, width } = layoutOrg({ id: "owner", children: [team] });
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const xs = new Set(["a", "b", "c", "d", "e"].map((id) => at[id].x));
  assert.equal(xs.size, 1, "one column");
  assert.ok(at.b.y > at.a.y && at.e.y > at.d.y, "top to bottom in order");
  assert.ok(width < 3 * CARD_W, "narrow");
  assert.ok(links.filter((l) => l.kind === "stack").every((l) => /H\d/.test(linkPath(l))));
});

test("one or two plain reports still sit side by side", () => {
  const { nodes } = layoutOrg({ id: "owner", children: [{ id: "lead", children: [leaf("a"), leaf("b")] }] });
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  assert.equal(at.a.y, at.b.y);
  assert.notEqual(at.a.x, at.b.x);
});

test("a team with sub-teams keeps its leaders side by side and nothing overlaps", () => {
  const sub = { id: "sublead", children: ["x", "y", "z"].map(leaf) };
  const dev = { id: "dev", children: [leaf("a"), leaf("b"), sub] };
  const tree = { id: "owner", children: [{ id: "chief", children: [dev, { id: "ops", children: ["p", "q", "r", "s"].map(leaf) }] }, leaf("coach")] };
  const { nodes, links } = layoutOrg(tree);
  assert.equal(nodes.length, 15);
  assert.equal(links.length, 14);
  for (const a of nodes) for (const b of nodes) if (a !== b) assert.ok(!overlaps(a, b), `${a.id} overlaps ${b.id}`);
});

test("the 45-bot Life Org fits in a few columns", async () => {
  let org;
  try {
    org = JSON.parse(await (await import("node:fs/promises")).readFile("C:/Users/Tony/Desktop/claudeProjects/lifeOrg/org.json", "utf8"));
  } catch {
    return; // Only on Tony's PC.
  }
  const build = (key) => ({ id: key, children: org.employees.filter((e) => (e.manager || "owner") === key).map((e) => build(e.key)) });
  const { nodes, width } = layoutOrg(build("owner"));
  assert.equal(nodes.length, org.employees.length + 1);
  assert.ok(width < 12 * CARD_W, `width ${width}`);
  for (const a of nodes) for (const b of nodes) if (a !== b) assert.ok(!overlaps(a, b), `${a.id} overlaps ${b.id}`);
});
