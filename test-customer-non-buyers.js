import express from 'express';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('non-buyers: search, pagination, empty results, dates and themes', async () => {
  const app = express();
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const nonBuyers = Array.from({ length: 12 }, (_, i) => ({ code: `00${i}`, name: i === 11 ? '<img src=x onerror=alert(1)>' : `ลูกค้า ${i}`, lastPurchased: i === 0 ? null : '2026-07-01', daysSincePurchase: i === 0 ? null : 70 }));
    await page.route('**/api/customer-insights/non-buyers?**', route => route.fulfill({ json: { nonBuyers: new URL(route.request().url()).searchParams.get('start') === '2026-08-01' ? [] : nonBuyers, updatedAt: new Date().toISOString() } }));
    await page.route('**/api/customer-insights?**', route => route.fulfill({ json: { customers: [], updatedAt: new Date().toISOString() } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/customers.html`);
    await expect(page.locator('#non-buyer-count')).toHaveText('12 ราย');
    await expect(page.locator('#non-buyer-rows tr')).toHaveCount(10);
    await expect(page.locator('#non-buyer-rows').first()).toContainText('ไม่เคยมีบิลขาย');
    await expect(page.locator('#non-buyer-rows tr').nth(1)).toContainText('70 วัน');
    await page.locator('#non-buyer-next').click();
    await expect(page.locator('#non-buyer-rows tr')).toHaveCount(2);
    await expect(page.locator('#non-buyer-rows img')).toHaveCount(0);
    await page.locator('#non-buyer-search').fill('0011');
    await expect(page.locator('#non-buyer-count')).toHaveText('1 ราย');
    await expect(page.locator('#non-buyer-prev')).toBeDisabled();
    await page.locator('#non-buyer-search').fill('missing');
    await expect(page.locator('#non-buyer-count')).toHaveText('0 ราย');
    await page.locator('#non-buyer-search').fill('');
    await expect(page.locator('#non-buyer-rows tr')).toHaveCount(10);
    await mkdir('test-results', { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#non-buyer-title').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `test-results/non-buyers-${theme}-${width}.png` });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    }
    await page.locator('#start').fill('2026-08-01');
    await page.locator('#end').fill('2026-08-31');
    await expect(page.locator('#non-buyer-count')).toHaveText('0 ราย');
    await expect(page.locator('#non-buyer-start')).toHaveValue('2026-08-01');
    await expect(page.locator('#non-buyer-end')).toHaveValue('2026-08-31');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
