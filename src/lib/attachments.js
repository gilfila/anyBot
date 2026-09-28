// Chat attachments in the composer and under messages. Pure; the runtime
// side lives in runtime/attachments.mjs.
export const MAX_ATTACHMENTS = 20;
// Thumbnails for dropped images are read in the renderer; skip big ones.
export const MAX_THUMBNAIL = 2 * 1024 * 1024;

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
export const isImageName = (name) => IMAGE.test(name || "");

export const baseName = (path) => String(path).split(/[\\/]/).filter(Boolean).at(-1) || String(path);

// Adds new items to the list: no duplicates (paths compare case-insensitively,
// as on Windows) and at most MAX_ATTACHMENTS. Returns { list, dropped }.
export function addAttachments(current, incoming) {
  const list = [...current];
  const seen = new Set(list.map((item) => item.path.toLowerCase()));
  let dropped = 0;
  for (const item of incoming) {
    if (!item?.path || seen.has(item.path.toLowerCase())) continue;
    if (list.length >= MAX_ATTACHMENTS) {
      dropped++;
      continue;
    }
    seen.add(item.path.toLowerCase());
    list.push({ name: baseName(item.path), kind: "file", ...item });
  }
  return { list, dropped };
}

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// A message's stored attachments (a JSON column; older rows have none).
export function messageAttachments(message) {
  try {
    const list = JSON.parse(message?.attachments || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
