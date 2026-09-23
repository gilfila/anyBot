import { defineConfig } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fake microphone for the voice tests: 0.6 s silence, 1.2 s of loud tone
// (heard as speech by the voice-activity detector), then 3 s of silence.
function speechWav() {
  const rate = 16000, parts = [0.6, 1.2, 3], samples = Math.round(rate * 4.8);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / rate, on = t > parts[0] && t < parts[0] + parts[1];
    pcm.writeInt16LE(on ? Math.round(Math.sin(2 * Math.PI * 300 * t) * 16000) : 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  const dir = join(tmpdir(), "anybot-playwright");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "speech.wav");
  writeFileSync(file, Buffer.concat([header, pcm]));
  return file;
}
const mediaArgs = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${speechWav()}%noloop`,
  "--autoplay-policy=no-user-gesture-required",
];

const systemChrome = process.env.PLAYWRIGHT_BROWSER_PATH ||
  (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "");
const launchOptions = {
  ...(systemChrome && existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
  args: mediaArgs,
};
export default defineConfig({
  testDir: "./tests",
  testMatch: "mobile.e2e.spec.mjs",
  workers: 1,
  timeout: 30000,
  use: {
    browserName: "chromium",
    launchOptions,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  reporter: "list",
});
