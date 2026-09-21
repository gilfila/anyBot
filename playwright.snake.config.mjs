import { test } from '@playwright/test';
import { existsSync } from 'node:fs';

const systemChrome = process.env.PLAYWRIGHT_BROWSER_PATH ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '');
const launchOptions = systemChrome && existsSync(systemChrome)
  ? { executablePath: systemChrome }
  : undefined;

export default {
  testDir: './tests',
  testMatch: 'snake.e2e.spec.mjs',
  timeout: 15_000,
  use: { baseURL: 'http://127.0.0.1:4180', headless: true, ...(launchOptions ? { launchOptions } : {}) },
  webServer: {
    command: 'node tests/snake-server.mjs',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 15_000,
    gracefulShutdown: { signal: 'SIGINT', timeout: 1_000 },
  },
};
