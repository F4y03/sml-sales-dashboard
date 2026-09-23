import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';

const daysIn = (start, end) => (Date.parse(end) - Date.parse(start)) / 864e5 + 1;

test('year growth covers every comparison day with a 62-day backend limit', async () => {
  const app = express();
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date('2026-09-23T12:00:00') });
    const requests = [], errors = [];
    let failedDay = null;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const start = url.searchParams.get('start'), end = url.searchParams.get('end');
      if (url.pathname === '/api/sales-trend/daily') {
        requests.push({ start, end });
        if (daysIn(start, end) > 62) return route.fulfill({ status: 400, json: { error: 'ช่วงวันที่ไม่ถูกต้อง' } });
        if (failedDay && start <= failedDay && end >= failedDay) return route.fulfill({ status: 503, json: { error: 'Comparison unavailable' } });
        return route.fulfill({ json: { daily: [{ day: start, sales: daysIn(start, end) * 50 }] } });
      }
      if (url.pathname === '/api/dashboard') return route.fulfill({ json: {
        totalSales: daysIn(start, end) * 100, itemSales: daysIn(start, end) * 100,
        totalInvoices: daysIn(start, end), products: [], warehouses: [],
        daily: [{ day: start, sales: 100 }, { day: end, sales: 100 }],
      } });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { rows: [], years: [] } });
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await expect(page.locator('#growth-link')).toBeEnabled();
    requests.length = 0;
    await page.locator('[data-preset="year"]').click();
    await expect(page.locator('#overview-yoy')).toContainText('+100.00%');
    const total = daysIn('2026-01-01', '2026-09-23') * 100;
    const previous = daysIn('2025-12-01', '2026-08-23') * 50;
    await expect(page.locator('#overview-mom')).toContainText(`+${((total / previous - 1) * 100).toFixed(2)}%`);
    await expect(page.locator('#growth-link')).toBeEnabled();
    await page.locator('#growth-link').click();
    await expect(page.locator('#growth-details')).toContainText('1 ธ.ค. 2568 – 23 ส.ค. 2569');
    await page.keyboard.press('Escape');
    assert.ok(requests.every(r => daysIn(r.start, r.end) <= 62));

    // Leap year: sequential chunks must cover all 366 days, with no overlap or gaps.
    requests.length = 0;
    const result = await page.evaluate(() => window.overviewTop.loadRange('2024-01-01', '2024-12-31', {
      dashboard: { totalSales: 36600, itemSales: 36600, totalInvoices: 366, daily: [] },
    }));
    assert.equal(result.previous.byDoc, daysIn('2023-12-01', '2024-11-30') * 50);
    assert.equal(result.lastYear.byDoc, 365 * 50);
    const coverage = new Map();
    for (const { start, end } of requests) {
      assert.ok(daysIn(start, end) <= 62);
      for (let date = Date.parse(start); date <= Date.parse(end); date += 864e5) {
        const day = new Date(date).toISOString().slice(0, 10);
        coverage.set(day, (coverage.get(day) || 0) + 1);
      }
    }
    for (let date = Date.parse('2023-01-01'); date <= Date.parse('2024-11-30'); date += 864e5) {
      const day = new Date(date).toISOString().slice(0, 10);
      assert.equal(coverage.get(day), day >= '2023-12-01' && day <= '2023-12-31' ? 2 : 1, day);
    }
    // A failed chunk invalidates the whole comparison; never show growth from a partial sum.
    failedDay = '2025-04-01';
    await page.locator('[data-preset="year"]').click();
    await expect(page.locator('#growth-link')).toBeEnabled();
    await expect(page.locator('#overview-yoy')).toContainText('YoY –');
    await expect(page.locator('#overview-mom')).toContainText('%');
    await page.locator('#growth-link').click();
    await expect(page.locator('#growth-details')).toContainText('โหลดยอดไม่สำเร็จ');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
