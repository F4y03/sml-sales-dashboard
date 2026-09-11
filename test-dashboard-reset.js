import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';

test('clear restores the initial month and reloads both charts after a single-day selection', async () => {
  const app = express();
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    await page.clock.install({ time: new Date('2026-09-10T12:00:00') });
    const requests = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/dashboard' || url.pathname === '/api/analytics') {
        const start = url.searchParams.get('start'), end = url.searchParams.get('end');
        requests.push({ path: url.pathname, start, end });
        const days = start === end ? [end] : [start, end];
        const data = url.pathname === '/api/dashboard'
          ? { totalSales: days.length * 100, totalInvoices: days.length, itemSales: days.length * 90, products: [{ code: 'P001', name: 'Test product', quantity: 2, unit: 'pcs', sales: 90, invoices: [{ date: end, docNo: 'INV001', quantity: 2, sales: 90 }] }], warehouses: [], daily: days.map(day => ({ day, sales: 100 })), updatedAt: '2026-09-10T12:00:00' }
          : { mode: 'group', title: 'Sales', note: '', start, end, updatedAt: '2026-09-10T12:00:00', rows: [{ name: 'Group', value: days.length * 100 }] };
        return route.fulfill({ json: data });
      }
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await expect(page.locator('.quick-periods #clear-day')).toHaveCount(0);
    await expect(page.locator('.dashboard-filter-actions #clear-day')).toBeVisible();
    const clearBounds = await page.locator('#clear-day').boundingBox();
    const applyBounds = await page.locator('#apply').boundingBox();
    assert.ok(clearBounds.x < applyBounds.x && Math.abs(clearBounds.y - applyBounds.y) < 2, 'clear sits beside apply');
    await expect.poll(() => page.evaluate(() => window.Chart.getChart('daily-chart')?.data?.labels.length)).toBe(2);
    for (let index = 0; index < 6; index++) {
      await page.locator('#product-rows tr').first().locator('td').nth(index).click();
      await expect(page.locator('#product-invoices')).toBeVisible();
      await expect(page.locator('#product-invoice-rows')).toContainText('INV001');
      await page.locator('#close-product-invoices').click();
    }
    await page.locator('#product-rows .quantity-link').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#product-invoices')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#total-sales')).toHaveText('฿200');
    await expect(page.locator('#item-sales')).toHaveText('฿180');
    // Reproduce the dashboard's framework reset, which removes native dialog margins.
    await page.addStyleTag({ content: '* { margin: 0; padding: 0; }' });
    await page.locator('#item-sales-help').click();
    await expect(page.locator('.insight-help-breakdown')).toContainText('฿20.00');
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const bounds = await page.locator('#insight-help-dialog').boundingBox();
      assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 2, 'dialog centered horizontally');
      assert.ok(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) < 2, 'dialog centered vertically');
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'dialog stays within viewport');
    }
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const quickDay of ['day-today', 'day-yesterday']) {
      await page.locator(`#${quickDay}`).click();
      await expect.poll(() => page.evaluate(() => window.Chart.getChart('daily-chart')?.data?.labels.length)).toBe(1);
      await expect(page.locator('#total-sales')).toHaveText('฿100');
      await expect(page.locator('#item-sales')).toHaveText('฿90');
      await page.locator('#clear-day').click();
      await expect(page.locator('#period')).toHaveValue('month');
      await expect(page.locator('#start')).toHaveValue('2026-09-01');
      await expect(page.locator('#end')).toHaveValue('2026-09-10');
      await expect(page.locator('#day-today')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#day-yesterday')).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => page.evaluate(() => window.Chart.getChart('daily-chart')?.data?.labels.length)).toBe(2);
      await expect.poll(() => page.evaluate(() => window.Chart.getChart('analysis-chart')?.data?.datasets[0].data[0])).toBe(200);
      await expect(page.locator('#item-sales')).toHaveText('฿180');
      assert.deepEqual(requests.filter(r => r.path === '/api/dashboard').at(-1), { path: '/api/dashboard', start: '2026-09-01', end: '2026-09-10' });
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
