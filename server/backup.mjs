import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, lstat, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "anybot.sqlite",
  "anybot.sqlite-shm",
  "anybot.sqlite-wal",
  "mobile-membership.json",
  "members.json",
  "mobile-audit.jsonl",
];
const DIRECTORIES = ["artifacts", "workspaces"];

async function copyChecked(source, target, manifest, relative) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Backup refuses symbolic link: ${relative}`);
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source))
      await copyChecked(path.join(source, entry), path.join(target, entry), manifest, path.join(relative, entry));
    return;
  }
  if (!info.isFile()) throw new Error(`Backup refuses special file: ${relative}`);
  const bytes = await readFile(source);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  manifest.push({ path: relative.replaceAll(path.sep, "/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}

export async function backupDataDirectory({ source, destination, now = new Date() }) {
  const sourceDir = path.resolve(source), destinationDir = path.resolve(destination);
  const stamp = now.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupDir = path.join(destinationDir, `anybot-backup-${stamp}`);
  const partialDir = `${backupDir}.partial`;
  await mkdir(destinationDir, { recursive: true });
  await mkdir(partialDir, { recursive: true });
  const manifest = [];
  try {
    for (const name of FILES) {
      try { await copyChecked(path.join(sourceDir, name), path.join(partialDir, name), manifest, name); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    for (const name of DIRECTORIES) {
      try { await copyChecked(path.join(sourceDir, name), path.join(partialDir, name), manifest, name); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    await writeFile(path.join(partialDir, "manifest.json"), JSON.stringify({ version: 1, created: now.toISOString(), source: sourceDir, files: manifest }, null, 2), { flag: "wx" });
    await rename(partialDir, backupDir);
    return { directory: backupDir, files: manifest };
  } catch (error) {
    await rm(partialDir, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), source = args[args.indexOf("--source") + 1], destination = args[args.indexOf("--destination") + 1];
  if (!source || !destination) throw new Error("Usage: node server/backup.mjs --source <dataDir> --destination <backupDir>");
  console.log(JSON.stringify(await backupDataDirectory({ source, destination }), null, 2));
}
