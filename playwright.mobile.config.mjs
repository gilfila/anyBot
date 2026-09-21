import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChrome = process.env.PLAYWRIGHT_BROWSER_PATH ||
  (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "");
const launchOptions = systemChrome && existsSync(systemChrome)
  ? { executablePath: systemChrome }
  : undefined;
export default defineConfig({
  testDir: "./tests",
  testMatch: "mobile.e2e.spec.mjs",
  workers: 1,
  timeout: 30000,
  use: {
    browserName: "chromium",
    ...(launchOptions ? { launchOptions } : {}),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  reporter: "list",
});
