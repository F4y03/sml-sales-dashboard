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
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-09-10T12:00:00') });
    const requests = [];
    let comparisonFails = false;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/sales-trend/daily') {
        return comparisonFails
          ? route.fulfill({ status: 503, json: { error: 'Comparison unavailable' } })
          : route.fulfill({ json: { daily: [{ day: url.searchParams.get('start'), sales: 100 }] } });
      }
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
    await expect(page.locator('.ov-presets #clear-day')).toHaveCount(0);
    await expect(page.locator('.ov-filter-actions #clear-day')).toBeVisible();
    const clearBounds = await page.locator('#clear-day').boundingBox();
    const applyBounds = await page.locator('#apply').boundingBox();
    assert.ok(clearBounds.x < applyBounds.x && Math.abs(clearBounds.y - applyBounds.y) < 2, 'clear sits beside apply');
    await expect.poll(() => page.evaluate(() => window.salesTrend.debug().daily?.days.length)).toBe(2);
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
    await expect(page.locator('#total-sales')).toHaveText('฿200.00');
    await expect(page.locator('#item-sales')).toHaveText('฿180.00');
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
      await expect.poll(() => page.evaluate(() => window.salesTrend.debug().daily?.days.length)).toBe(1);
      await expect(page.locator('#total-sales')).toHaveText('฿100.00');
      await expect(page.locator('#item-sales')).toHaveText('฿90.00');
      await expect(page.locator('#overview-spark .ov-spark-line')).toHaveAttribute('d', 'M0,37.0L240,4.0');
      await expect(page.locator('#overview-spark circle')).toHaveCount(0);
      await expect(page.locator('#overview-spark')).toHaveAttribute('aria-label', /ข้อมูล 1 วัน/);
      await expect(page.locator('#daily-chart .tg-single-bar')).toHaveCount(1);
      assert.ok(Number(await page.locator('#daily-chart .tg-single-bar').getAttribute('height')) > 0);
      await expect(page.locator('#daily-chart .tg-line')).toHaveCount(0);
      await expect(page.locator('#daily-chart')).toContainText('฿100.00');
      await page.locator('#clear-day').click();
      await expect(page.locator('[data-preset="month"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#start')).toHaveValue('2026-09-01');
      await expect(page.locator('#end')).toHaveValue('2026-09-10');
      await expect(page.locator('#day-today')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#day-yesterday')).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => page.evaluate(() => window.salesTrend.debug().daily?.days.length)).toBe(2);
      await expect(page.locator('#donut-legend .donut-amount').first()).toHaveText('฿200');
      await expect(page.locator('#item-sales')).toHaveText('฿180.00');
      await expect(page.locator('#overview-spark circle')).toHaveCount(0);
      await expect(page.locator('#daily-chart .tg-single-bar')).toHaveCount(0);
      await expect(page.locator('#daily-chart .tg-line')).toHaveCount(1);
      assert.deepEqual(requests.filter(r => r.path === '/api/dashboard').at(-1), { path: '/api/dashboard', start: '2026-09-01', end: '2026-09-10' });
    }
    await expect(page.locator('#overview-growth-mom')).toContainText('1–10 ส.ค. 69');
    await expect(page.locator('#overview-yoy')).toContainText('1–10 ก.ย. 68');
    for (const [start, end, expected] of [
      ['2026-03-31', '2026-03-31', '28 ก.พ. 69'],
      ['2026-09-30', '2026-10-05', '30 ส.ค.–5 ก.ย. 69'],
      ['2025-12-30', '2026-01-05', '30 พ.ย.–5 ธ.ค. 68'],
      ['2025-12-30', '2026-02-05', '30 พ.ย. 68–5 ม.ค. 69'],
    ]) {
      await page.locator('#start').fill(start);
      await page.locator('#end').fill(end);
      await page.locator('#apply').click();
      await expect(page.locator('#overview-growth-mom')).toContainText(expected);
    }
    await page.locator('#clear-day').click();
    await expect(page.locator('#overview-growth-mom')).toContainText('1–10 ส.ค. 69');
    for (const mode of ['light', 'dark']) {
      await page.locator(`[data-theme-mode="${mode}"]`).click();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${mode} at ${width}px fits`);
        await expect(page.locator('#total-sales')).toBeVisible();
        await page.locator('#overview-top').screenshot({ path: `test-results/overview-${mode}-${width}.png` });
      }
    }
    await page.locator('#growth-link').click();
    await expect(page.locator('#growth-details')).toContainText('฿100.00');
    await page.keyboard.press('Escape');
    comparisonFails = true;
    await page.locator('#day-today').click();
    await expect(page.locator('#growth-link')).toBeEnabled();
    await expect(page.locator('#total-sales')).toHaveText('฿100.00');
    await expect(page.locator('#overview-mom')).toHaveText('–');
    await page.locator('#growth-link').click();
    await expect(page.locator('#growth-details')).toContainText('โหลดยอดไม่สำเร็จ');
    await page.keyboard.press('Escape');
    // Late comparisons from an earlier selection must not restore its cards.
    const held = [];
    await page.route('**/api/sales-trend/daily?**', route => {
      if (new URL(route.request().url()).searchParams.get('start').startsWith('2025-')) held.push(route);
      else return route.fallback();
    });
    await page.locator('#clear-day').click();
    await expect.poll(() => held.length).toBe(1);
    await expect(page.locator('#total-sales')).toHaveText('฿200.00');
    await expect(page.locator('#growth-link')).toBeDisabled();
    await page.locator('#day-yesterday').click();
    await expect.poll(() => held.length).toBe(2);
    await expect(page.locator('#total-sales')).toHaveText('฿100.00');
    await held[1].fulfill({ json: { daily: [{ sales: 50 }] } });
    await expect(page.locator('#overview-growth-mom')).toContainText('9 ส.ค. 69');
    await held[0].fulfill({ json: { daily: [{ sales: 1 }] } });
    await expect(page.locator('#overview-growth-mom')).toContainText('9 ส.ค. 69');
    await expect(page.locator('#total-sales')).toHaveText('฿100.00');
    await page.unroute('**/api/sales-trend/daily?**');
    comparisonFails = false;
    await page.route('**/api/dashboard?**', route => route.fulfill({ json: {
      totalSales: 0, itemSales: 0, totalInvoices: 0, products: [], warehouses: [], daily: [],
    } }));
    await page.locator('#clear-day').click();
    await expect(page.locator('#total-sales')).toHaveText('฿0.00');
    await expect(page.locator('#bills-avg')).toHaveText('เฉลี่ยต่อบิล –');
    await expect(page.locator('#overview-spark path')).toHaveCount(0);
    await page.unroute('**/api/dashboard?**');
    await page.route('**/api/dashboard?**', route => route.fulfill({ status: 503, json: { error: 'Dashboard unavailable' } }));
    await page.locator('#day-today').click();
    await expect(page.locator('#status')).toHaveText('Dashboard unavailable');
    await expect(page.locator('#total-sales')).toHaveText('—');
    await expect(page.locator('#export')).toBeDisabled();
    await expect(page.locator('#growth-link')).toBeDisabled();
    await expect(page.locator('.ov-kpis')).toHaveAttribute('aria-busy', 'false');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
