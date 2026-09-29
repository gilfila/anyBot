// Files and folders the owner attaches to a chat message (dropped, picked,
// or pasted in the composer). A message stores them as JSON records; a run
// gets copies of the files in its bot's inbox and the folders by path.
import { copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { id } from "./store.mjs";

export const MAX_ATTACHMENTS = 20;
// Larger files stay where they are; the bot is told their path instead.
export const MAX_COPY = 50 * 1024 * 1024;
const MAX_PREVIEW = 2 * 1024 * 1024;
const MAX_PASTE = 20 * 1024 * 1024;
const LISTING = 50;

const types = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
// Images a harness can take natively (Codex --image) and the chat can thumbnail.
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const mimeOf = (name) => types[extname(name).toLowerCase()] || "";
export const isImage = (record) => record.kind === "file" && imageTypes.has(record.mime);

// Checks what the renderer sent and records what is on disk now.
export function validate(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_ATTACHMENTS)
    throw new Error(`Attach at most ${MAX_ATTACHMENTS} files or folders`);
  const records = [];
  const seen = new Set();
  for (const item of list) {
    const path = typeof item === "string" ? item : item?.path;
    if (typeof path !== "string" || !path.trim() || path.length > 2000 || !isAbsolute(path))
      throw new Error("Attachments must be absolute paths");
    const full = resolve(path);
    if (seen.has(full.toLowerCase())) continue;
    seen.add(full.toLowerCase());
    let info;
    try {
      info = statSync(full);
    } catch {
      throw new Error(`Attachment not found: ${basename(full)}`);
    }
    if (!info.isFile() && !info.isDirectory()) throw new Error(`Not a file or folder: ${basename(full)}`);
    const name = basename(full) || full;
    records.push(
      info.isDirectory()
        ? { path: full, name, kind: "folder", size: 0, mime: "" }
        : { path: full, name, kind: "file", size: info.size, mime: mimeOf(name) },
    );
  }
  return records;
}

export const parse = (value) => {
  try {
    const list = JSON.parse(value || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

// A short marker for transcripts: "[attached: a.png, specs/]".
export const summary = (list) =>
  list.length ? `[attached: ${list.map((a) => (a.kind === "folder" ? `${a.name}/` : a.name)).join(", ")}]` : "";

// Copies a message's files into <workspace>/.anybot-inbox/<message>/ and
// describes everything for the prompt. Never throws for one bad attachment:
// the bot is told what couldn't be delivered.
export async function materialize(message, list, workspace) {
  if (!list.length) return [];
  const inbox = join(workspace, ".anybot-inbox");
  await mkdir(inbox, { recursive: true });
  if ((await lstat(inbox)).isSymbolicLink()) throw new Error("Attachment inbox cannot be a symbolic link");
  const folder = join(inbox, message);
  const used = new Set();
  const out = [];
  for (const record of list) {
    const entry = { name: record.name, kind: record.kind, mime: record.mime || undefined, size: record.size || undefined };
    try {
      const info = await stat(record.path);
      if (record.kind === "folder") {
        if (!info.isDirectory()) throw new Error("no longer a folder");
        const names = (await readdir(record.path, { withFileTypes: true })).map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
        out.push({ ...entry, path: record.path, contents: names.slice(0, LISTING), more: Math.max(0, names.length - LISTING) || undefined });
        continue;
      }
      if (!info.isFile()) throw new Error("no longer a file");
      if (info.size > MAX_COPY) {
        out.push({ ...entry, size: info.size, path: record.path, note: "too large to copy; read it in place" });
        continue;
      }
      let name = record.name;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${basename(record.name, extname(record.name))} (${n})${extname(record.name)}`;
      used.add(name.toLowerCase());
      await mkdir(folder, { recursive: true });
      try {
        await copyFile(record.path, join(folder, name), constants.COPYFILE_EXCL);
      } catch (error) {
        // A retried run finds its copy already there.
        if (error.code !== "EEXIST") throw error;
      }
      out.push({ ...entry, size: info.size, path: `.anybot-inbox/${message}/${name}`, original: record.path });
    } catch (error) {
      out.push({ ...entry, path: record.path, missing: true, note: `not delivered: ${error.message}` });
    }
  }
  return out;
}

// What the harness can take natively: folders to allow (attached ones plus
// `folders`, the project's; each once), images to attach.
export function harnessInputs(delivered, workspace, folders = []) {
  const key = (path) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
  const dirs = new Map();
  for (const dir of [...delivered.filter((a) => a.kind === "folder" && !a.missing).map((a) => a.path), ...folders])
    if (!dirs.has(key(dir))) dirs.set(key(dir), dir);
  return {
    addDirs: [...dirs.values()],
    images: delivered
      .filter((a) => isImage(a) && !a.missing && !a.note)
      .map((a) => (isAbsolute(a.path) ? a.path : join(workspace, a.path))),
  };
}

export async function preview(record) {
  const path = typeof record === "string" ? record : record?.path;
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("Attachment path must be absolute");
  const mime = mimeOf(path);
  if (!imageTypes.has(mime)) return { kind: "file" };
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_PREVIEW) return { kind: "file" };
  return { kind: "image", url: `data:${mime};base64,${(await readFile(path)).toString("base64")}` };
}

// A pasted clipboard image has no file yet: store it under the app's data.
export async function savePasted(directory, { data, mime }) {
  const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" }[mime];
  if (!extension) throw new Error("Only pasted images can be attached");
  if (typeof data !== "string" || data.length > Math.ceil(MAX_PASTE / 3) * 4) throw new Error("Pasted image is too large");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) throw new Error("Pasted image is empty");
  const folder = join(directory, "attachments");
  await mkdir(folder, { recursive: true });
  const path = join(folder, `pasted-${new Date().toISOString().slice(0, 10)}-${id().slice(0, 8)}${extension}`);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  return { path };
}
