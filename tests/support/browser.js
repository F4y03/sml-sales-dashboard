import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

// One way to start the test browser: installed Chrome (or CHROME_PATH), else PLAYWRIGHT_CHANNEL, else Playwright's own.
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export function launchBrowser(options = {}) {
  const target = existsSync(chrome) ? { executablePath: chrome }
    : process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {};
  return chromium.launch({ headless: true, ...target, ...options });
}
