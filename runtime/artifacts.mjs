import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { id, now } from "./store.mjs";

const MAX_FILE = 10 * 1024 * 1024;
const MAX_PREVIEW = 512 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function boundedRead(path) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE)
      throw new Error("Artifact must be a regular file of at most 10 MB");
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset !== stat.size)
      throw new Error("Artifact changed during reading");
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
const imageTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const textTypes = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".tsv",
  ".log",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".yaml",
  ".yml",
  ".xml",
  ".svg",
]);
const allowedTypes = new Set([
  ...textTypes,
  ...Object.keys(imageTypes),
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".zip",
]);

export function artifactPaths(output) {
  const blocks = [
    ...output.matchAll(/```anybot-artifacts\s*\n([\s\S]*?)\n```/g),
  ];
  if (!blocks.length) return [];
  if (blocks.length !== 1)
    throw new Error("Use one artifact manifest per response");
  let value;
  try {
    value = JSON.parse(blocks[0][1]);
  } catch {
    throw new Error("Artifact manifest is not valid JSON");
  }
  if (!Array.isArray(value.paths) || value.paths.length > 8)
    throw new Error("An artifact manifest may list at most 8 files");
  return [...new Set(value.paths)].map((path) => {
    if (
      typeof path !== "string" ||
      !path ||
      path.length > 500 ||
      isAbsolute(path) ||
      /[:\x00-\x1f]/.test(path) ||
      /^[\\/]/.test(path)
    )
      throw new Error("Artifact paths must be relative workspace paths");
    const parts = path.split(/[\\/]/);
    if (
      parts.some(
        (p) =>
          !p ||
          p === ".." ||
          p === "." ||
          /[ .]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p),
      )
    )
      throw new Error("Unsafe artifact path");
    if (!allowedTypes.has(extname(path).toLowerCase()))
      throw new Error("This artifact file type is not supported");
    return parts.join("/");
  });
}

export async function confinedFile(root, path) {
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, path);
  const rel = relative(canonicalRoot, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("File is outside its workspace");
  let current = canonicalRoot;
  for (const part of rel.split(/[\\/]/)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Symbolic links are not accepted as artifacts");
  }
  const actual = await realpath(target);
  const actualRel = relative(canonicalRoot, actual);
  if (actualRel.startsWith("..") || isAbsolute(actualRel))
    throw new Error("File escaped its workspace");
  return actual;
}

export class Artifacts {
  constructor(store, directory) {
    this.store = store;
    this.directory = join(directory, "artifacts");
  }
  list() {
    return this.store.all(
      "SELECT id,conversation,run,name,bytes,created FROM artifacts ORDER BY rowid",
    );
  }
  async capture(run, employee, output, signal, projectArtifactsFolder = "") {
    const paths = artifactPaths(output),
      entries = [];
    let total = 0;
    await mkdir(this.directory, { recursive: true });
    if (projectArtifactsFolder) {
      await mkdir(projectArtifactsFolder, { recursive: true });
    }
    for (const path of paths) {
      if (signal?.aborted) throw new Error("Run cancelled");
      const source = await confinedFile(employee.workspace, path);
      const handle = await open(source, "r");
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_FILE)
          throw new Error("Artifact must be a regular file of at most 10 MB");
        total += stat.size;
        if (total > 30 * 1024 * 1024)
          throw new Error("Artifact batch exceeds 30 MB");
        const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE + 1));
        let offset = 0;
        while (offset < buffer.length) {
          const r = await handle.read(
            buffer,
            offset,
            buffer.length - offset,
            null,
          );
          if (!r.bytesRead) break;
          offset += r.bytesRead;
        }
        if (offset !== stat.size)
          throw new Error(
            "Artifact changed during capture; try again after writing finishes",
          );
        bytes = buffer.subarray(0, offset);
      } finally {
        await handle.close();
      }
      const digest = hash(bytes),
        extension = extname(path).toLowerCase();
      const blob = digest + extension;
      try {
        await writeFile(join(this.directory, blob), bytes, {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      if (projectArtifactsFolder) {
        try {
          await writeFile(
            join(projectArtifactsFolder, basename(path)),
            bytes,
            { mode: 0o600 },
          );
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
      entries.push({
        id: id(),
        conversation: run.conversation,
        run: run.id,
        name: basename(path),
        blob,
        digest,
        bytes: bytes.length,
        created: now(),
      });
    }
    return entries;
  }
  save(entries) {
    for (const a of entries)
      this.store.run(
        "INSERT INTO artifacts(id,conversation,run,name,blob,digest,bytes,created) VALUES (?,?,?,?,?,?,?,?)",
        a.id,
        a.conversation,
        a.run,
        a.name,
        a.blob,
        a.digest,
        a.bytes,
        a.created,
      );
  }
  row(payload) {
    if (
      typeof payload?.id !== "string" ||
      typeof payload?.conversation !== "string"
    )
      throw new Error("Artifact and conversation IDs are required");
    const row = this.store.one(
      "SELECT * FROM artifacts WHERE id=? AND conversation=?",
      payload.id,
      payload.conversation,
    );
    if (!row) throw new Error("Artifact not found in this conversation");
    if (
      !/^[a-f0-9]{64}\.[a-z0-9]+$/.test(row.blob) ||
      !allowedTypes.has(extname(row.blob))
    )
      throw new Error("Invalid stored artifact reference");
    return row;
  }
  async bytes(row) {
    const path = await confinedFile(this.directory, row.blob);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_FILE)
      throw new Error("Stored artifact exceeds its size limit");
    const bytes = await boundedRead(path);
    if (bytes.length !== row.bytes || hash(bytes) !== row.digest)
      throw new Error("Stored artifact integrity check failed");
    return { bytes, path };
  }
  async preview(payload) {
    const row = this.row(payload),
      { bytes } = await this.bytes(row),
      extension = extname(row.name).toLowerCase();
    if (textTypes.has(extension))
      return {
        name: row.name,
        kind: "text",
        text: bytes.subarray(0, MAX_PREVIEW).toString("utf8"),
        truncated: bytes.length > MAX_PREVIEW,
      };
    if (imageTypes[extension] && bytes.length <= 2 * 1024 * 1024)
      return {
        name: row.name,
        kind: "image",
        url: `data:${imageTypes[extension]};base64,${bytes.toString("base64")}`,
      };
    return { name: row.name, kind: "file", bytes: bytes.length };
  }
  async resolve(payload) {
    return (await this.bytes(this.row(payload))).path;
  }
  async materialize(run, employee) {
    const selected = this.store.all(
      `SELECT a.* FROM artifacts a JOIN runs r ON r.id=a.run JOIN messages m ON m.id=r.message
      WHERE a.conversation=? AND m.rowid <= (SELECT rowid FROM messages WHERE id=?) ORDER BY a.rowid DESC LIMIT 8`,
      run.conversation,
      run.message,
    );
    if (!selected.length) return [];
    const inbox = join(employee.workspace, ".anybot-inbox");
    await mkdir(inbox, { recursive: true });
    if ((await lstat(inbox)).isSymbolicLink())
      throw new Error("Artifact inbox cannot be a symbolic link");
    const staged = [];
    for (const row of selected) {
      const { bytes } = await this.bytes(row);
      const destination = join(inbox, row.blob);
      try {
        await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const file = await confinedFile(
        employee.workspace,
        join(".anybot-inbox", row.blob),
      );
      if (hash(await boundedRead(file)) !== row.digest)
        throw new Error("An existing inbox artifact was modified");
      staged.push({
        id: row.id,
        name: row.name,
        path: `.anybot-inbox/${row.blob}`,
      });
    }
    return staged;
  }
}
