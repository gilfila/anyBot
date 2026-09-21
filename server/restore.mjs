import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, lstat, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function copyVerified(source, target, expected) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Restore refuses unexpected file: ${expected.path}`);
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== expected.bytes || hash !== expected.sha256)
    throw new Error(`Backup manifest mismatch: ${expected.path}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

export async function restoreBackup({ backup, destination }) {
  const backupDir = path.resolve(backup), destinationDir = path.resolve(destination);
  const manifest = JSON.parse(await readFile(path.join(backupDir, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Unsupported or malformed backup manifest");
  try { await stat(destinationDir); throw new Error("Restore destination already exists; choose a new data directory"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const partial = `${destinationDir}.partial`;
  await mkdir(partial, { recursive: true });
  try {
    for (const expected of manifest.files)
      await copyVerified(path.join(backupDir, expected.path), path.join(partial, expected.path), expected);
    await writeFile(path.join(partial, "restore-manifest.json"), JSON.stringify({ restoredFrom: backupDir, sourceManifest: manifest }, null, 2), { flag: "wx" });
    await rename(partial, destinationDir);
    return { directory: destinationDir, files: manifest.files.length };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), backup = args[args.indexOf("--backup") + 1], destination = args[args.indexOf("--destination") + 1];
  if (!backup || !destination) throw new Error("Usage: node server/restore.mjs --backup <backupDir> --destination <newDataDir>");
  console.log(JSON.stringify(await restoreBackup({ backup, destination }), null, 2));
}
