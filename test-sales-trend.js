import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { installSalesTrend } from './sales-trend.js';

test('monthly endpoint validates years and chart switches between daily and monthly with retry and themes', async () => {
  const app = express(); let failed = false;
  installSalesTrend(app, { query: async (sql, params) => {
    assert.match(sql, /trans_flag = 44 AND last_status = 0/);
    if (sql.includes('SELECT DISTINCT')) return { rows: [{ year: 2025 }, { year: 2024 }] };
    assert.deepEqual(params, ['2025-01-01', '2026-01-01']);
    if (failed) throw Object.assign(new Error('offline'), { code: 'TEST_OFFLINE' });
    return { rows: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, sales: i === 1 ? 0 : (i + 1) * 1000 })) };
  } });
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    for (const year of ['', 'abc', '2025 OR 1=1', '1899', '2101', '2025.5']) assert.equal((await fetch(`${base}/api/sales-trend?year=${encodeURIComponent(year)}`)).status, 400);
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors=[]; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => route.abort());
    await page.route('**/api/dashboard?**', route => route.fulfill({json:{totalSales:100,itemSales:100,totalInvoices:1,products:[],warehouses:[],daily:[{day:'2026-09-01',sales:100}],updatedAt:new Date().toISOString()}}));
    await page.goto(base+'/index.html');
    await page.locator('#trend-mode').selectOption('monthly');
    await expect(page.locator('#monthly-status')).toContainText('76,000');
    assert.deepEqual(await page.locator('#trend-year option').evaluateAll(options => options.map(o => o.textContent)), ['2568', '2567']);
    assert.deepEqual(await page.evaluate(() => Chart.getChart('monthly-chart').data.datasets[0].data), [1000,0,3000,4000,5000,6000,7000,8000,9000,10000,11000,12000]);
    await expect(page.locator('#daily-trend-wrap')).not.toBeVisible();
    for (const mode of ['light','dark']) {
      await page.locator(`[data-theme-mode="${mode}"]`).click();
      assert.equal(await page.evaluate(() => Chart.getChart('monthly-chart').data.datasets[0].borderColor), mode === 'dark' ? '#f4f4f5' : '#191b20');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/monthly-chart-mobile.png', fullPage: true });
    await page.locator('#trend-mode').selectOption('daily');
    await expect(page.locator('#daily-chart')).toBeVisible();
    failed = true;
    await page.locator('#trend-mode').selectOption('monthly');
    await expect(page.locator('#monthly-retry')).toBeVisible();
    assert.equal(await page.evaluate(() => !!Chart.getChart('monthly-chart')), false);
    failed = false; await page.locator('#monthly-retry').click();
    await expect(page.locator('#monthly-status')).toContainText('76,000');
    const futureYear = new Date().getFullYear() + 1;
    await page.route(`**/api/sales-trend?year=${futureYear}`, route => route.fulfill({ json: {
      year: futureYear, months: Array.from({length:12}, (_,i) => ({month:i+1, sales:i===0 ? 500 : 0})), updatedAt:new Date().toISOString(),
    } }));
    await page.evaluate(year => document.getElementById('trend-year').append(new Option(String(year+543),String(year))), futureYear);
    await page.locator('#trend-year').selectOption(String(futureYear));
    await expect(page.locator('#monthly-status')).toContainText('500');
    assert.deepEqual(await page.evaluate(() => Chart.getChart('monthly-chart').data.datasets[0].data), [500,...Array(11).fill(null)]);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
