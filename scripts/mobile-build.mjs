import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const root = process.cwd();
const isWindows = process.platform === "win32";
const env = { ...process.env };

function firstDirectory(candidates) {
  return candidates.filter(Boolean).find((candidate) => existsSync(candidate));
}

if (isWindows) {
  env.ANDROID_HOME ||= firstDirectory([
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Android", "Sdk"),
  ]);
  env.ANDROID_SDK_ROOT ||= env.ANDROID_HOME;
  env.JAVA_HOME ||= firstDirectory([
    env.JAVA_HOME,
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    "C:\\Program Files\\Android\\Android Studio\\jre",
  ]);
}
for (const [key, value] of Object.entries(env)) {
  if (value === undefined) delete env[key];
}

function run(command, args, cwd = root) {
  const actualCommand = isWindows
    ? process.env.ComSpec || "cmd.exe"
    : command;
  const actualArgs = isWindows
    ? ["/d", "/s", "/c", command, ...args]
    : args;
  return new Promise((resolve, reject) => {
    const child = spawn(actualCommand, actualArgs, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve(code ?? (signal ? 1 : 0)),
    );
  });
}

const npm = isWindows ? "npm.cmd" : "npm";
const gradle = isWindows ? "gradlew.bat" : "./gradlew";
const syncCode = await run(npm, ["run", "mobile:sync"]);
if (syncCode !== 0) process.exit(syncCode);

if (!env.ANDROID_HOME) {
  console.error(
    "Android SDK not found. Set ANDROID_HOME or install the Android Studio SDK.",
  );
  process.exit(1);
}
if (!env.JAVA_HOME) {
  console.error(
    "Android Studio JDK not found. Set JAVA_HOME or install Android Studio.",
  );
  process.exit(1);
}

console.log(`Using Android SDK: ${env.ANDROID_HOME}`);
console.log(`Using Java runtime: ${env.JAVA_HOME}`);
const buildCode = await run(gradle, ["assembleDebug"], join(root, "android"));
if (buildCode !== 0) process.exit(buildCode);

const apk = join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const releaseDirectory = join(root, "release");
const releaseApk = join(releaseDirectory, "anyBot-mobile-debug.apk");
await mkdir(releaseDirectory, { recursive: true });
await copyFile(apk, releaseApk);
const digest = createHash("sha256").update(await readFile(releaseApk)).digest("hex").toUpperCase();
console.log(`Android APK: ${releaseApk}`);
console.log(`SHA-256: ${digest}`);
