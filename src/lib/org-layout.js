// Org chart layout. Pure; OrgPage.jsx draws it.
//
// A manager's reports that have no reports of their own ("leaves") stack in
// a column under the manager, like a classic org chart; reports that lead
// teams of their own sit side by side. That keeps a 40-bot org a few columns
// wide instead of one very long row. With only one or two leaves and no
// branches, they sit side by side as before.
export const CARD_W = 236;
export const CARD_H = 144;
export const OWNER_H = 64;
export const GAP_X = 28; // between side-by-side blocks
export const GAP_Y = 64; // between a manager and the row below
export const STACK_GAP = 12; // between stacked cards
export const INDENT = 28; // stacked cards sit right of the rail

// tree: { id, children: [...] }. Returns { nodes: [{ id, x, y, data }],
// links: [{ source, target, kind: "tree" | "stack" }], width, height }.
export function layoutOrg(tree, { margin = 24 } = {}) {
  const heightOf = (node) => (node.id === "owner" ? OWNER_H : CARD_H);

  // Size of each subtree, and how its children are arranged.
  const measure = (node) => {
    const children = node.children || [];
    const leaves = children.filter((c) => !(c.children || []).length);
    const branches = children.filter((c) => (c.children || []).length);
    const stack = leaves.length > 2 || (leaves.length > 1 && branches.length > 0);
    const blocks = [];
    if (stack) blocks.push({ kind: "stack", items: leaves });
    for (const child of children)
      if (!stack || branches.includes(child)) blocks.push({ kind: "tree", node: child, size: measure(child) });
    for (const block of blocks)
      if (block.kind === "stack")
        block.size = { width: INDENT + CARD_W, height: block.items.length * CARD_H + (block.items.length - 1) * STACK_GAP };
    const rowWidth = blocks.reduce((sum, b) => sum + b.size.width, 0) + Math.max(0, blocks.length - 1) * GAP_X;
    const rowHeight = Math.max(0, ...blocks.map((b) => b.size.height));
    node._blocks = blocks;
    node._size = {
      width: Math.max(CARD_W, rowWidth),
      height: heightOf(node) + (blocks.length ? GAP_Y + rowHeight : 0),
    };
    return node._size;
  };

  const nodes = [];
  const links = [];
  const place = (node, left, top) => {
    const size = node._size;
    const x = left + (size.width - CARD_W) / 2;
    const entry = { id: node.id, x, y: top, data: { id: node.id } };
    nodes.push(entry);
    const blocks = node._blocks;
    const rowWidth = blocks.reduce((sum, b) => sum + b.size.width, 0) + Math.max(0, blocks.length - 1) * GAP_X;
    let cursor = left + (size.width - rowWidth) / 2;
    const rowTop = top + heightOf(node) + GAP_Y;
    for (const block of blocks) {
      if (block.kind === "stack") {
        block.items.forEach((item, i) => {
          const child = { id: item.id, x: cursor + INDENT, y: rowTop + i * (CARD_H + STACK_GAP), data: { id: item.id } };
          nodes.push(child);
          links.push({ source: entry, target: child, kind: "stack", rail: cursor + INDENT / 2 });
        });
      } else {
        const child = place(block.node, cursor, rowTop);
        links.push({ source: entry, target: child, kind: "tree" });
      }
      cursor += block.size.width + GAP_X;
    }
    return entry;
  };

  measure(tree);
  place(tree, margin, margin);
  return {
    nodes,
    links,
    width: tree._size.width + margin * 2,
    height: tree._size.height + margin * 2,
  };
}

// SVG path for a link: an elbow from the manager's bottom edge, then down
// the rail and into the side of a stacked card, or down to a card's top.
export function linkPath(link) {
  const { source, target } = link;
  const sx = source.x + CARD_W / 2;
  const sy = source.y + (source.id === "owner" ? OWNER_H : CARD_H);
  const mid = sy + GAP_Y / 2;
  if (link.kind === "stack") {
    const ty = target.y + CARD_H / 2;
    return `M${sx},${sy} V${mid} H${link.rail} V${ty} H${target.x}`;
  }
  const tx = target.x + CARD_W / 2;
  return `M${sx},${sy} V${mid} H${tx} V${target.y}`;
}
