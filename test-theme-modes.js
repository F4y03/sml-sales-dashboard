import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { installAuth, hashPassword } from './auth.js';
import { findContrastIssues } from './test-support/theme-contrast.js';

test('two themes work on every page, login assets are public, choice persists and mobile controls fit', async () => {
  const app = express(); app.use(express.json());
  installAuth(app, { AUTH_USERNAME: 'test', AUTH_PASSWORD_HASH: await hashPassword('theme-test-password'), AUTH_COOKIE_SECURE: 'false' });
  app.use('/api', (req, res) => res.status(503).json({ error: 'Test offline' }));
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const asset of ['/theme-mode.js', '/theme-modes.css']) assert.equal((await fetch(base + asset, { redirect: 'manual' })).status, 200);
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => route.abort());
    await page.route('**/api/dashboard?**', route => route.fulfill({json:{totalSales:100,itemSales:100,totalInvoices:1,products:[],warehouses:[],daily:[{day:'2026-09-01',sales:100}],updatedAt:'2026-09-01T08:00:00Z'}}));
    await page.route('**/api/analytics?**', route => route.fulfill({json:{mode:'group',title:'Test sales',rows:[{name:'Test',value:100}],start:'2026-09-01',end:'2026-09-01',updatedAt:'2026-09-01T08:00:00Z'}}));
    await page.goto(base + '/login.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('[data-theme-mode="light"]').click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('#username').fill('test');
    await page.locator('#password').fill('theme-test-password');
    await page.locator('#submit').click();
    await page.waitForURL('**/executive.html');
    for (const file of ['index', 'customers', 'products', 'reports', 'executive', 'login']) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${base}/${file}.html`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      for (const mode of ['dark', 'light']) {
        await page.locator(`[data-theme-mode="${mode}"]`).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), mode);
        const surface = page.locator('.card:not(.featured),.panel,.form-panel').first();
        await expect(surface).toHaveCSS('background-color', mode === 'dark' ? 'rgb(20, 20, 22)' : 'rgb(255, 255, 255)');
        if(file === 'index') {
          await expect.poll(() => page.evaluate(() => window.Chart.getChart('daily-chart')?.options.scales.y.ticks.color)).toBe(mode === 'dark' ? '#b0b1b8' : '#656973');
          assert.deepEqual(await page.evaluate(() => window.Chart.getChart('daily-chart').data.datasets[0].data), [100]);
        }
        await expect.poll(() => page.evaluate(findContrastIssues), { message: `${file}: ${mode} text contrast` }).toEqual([]);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.theme-switch')).toBeVisible();
      assert.ok(await page.locator('.theme-switch').evaluate(el => el.getBoundingClientRect().right <= innerWidth), file);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {message:`${file} mobile layout`}).toBe(true);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
});

test('executive detail and explanation dialogs keep readable surfaces and text in both themes', async () => {
  const app = express(); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('https://**', route => route.abort());
    const bill = { docNo: 'INV1', date: '2026-09-08', flag: 44, total: 1000, lineTotal: 800, difference: 200 };
    const fixture = {
      net: 900, sales: 1000, returns: 100, mom: -25, yoy: 10, count: 2, salesInvoiceCount: 2, averageSale: 500,
      start: '2026-09-01', end: '2026-09-08', previous: { start: '2026-08-01', end: '2026-08-08' },
      year: { start: '2025-09-01', end: '2025-09-08' }, previousNet: 1200, yearNet: 800, updatedAt: new Date().toISOString(),
      products: [{ code: 'P1', name: 'ลำโพงทดสอบ', sales: 900, profit: 20, revenue: 800, stock: 2, unit: 'ชิ้น' }],
      branches: [], staff: [], declines: [], bills: [bill], unusual: [bill],
    };
    await page.route('**/api/executive?**', route => route.fulfill({ json: fixture }));
    await page.goto(`http://127.0.0.1:${server.address().port}/executive.html`);
    await expect(page.locator('#summary')).toBeVisible();
    const triggers = await page.locator('[data-detail],[data-help],.alert-action').all();
    for (const trigger of triggers) {
      await trigger.click();
      const dialog = page.locator('dialog[open]');
      if (await dialog.locator('.help-source summary').count()) await dialog.locator('.help-source summary').click();
      for (const mode of ['dark', 'light']) {
        await page.evaluate(mode => window.dashboardTheme.setMode(mode), mode);
        await expect(dialog.locator('.panel-heading')).toHaveCSS('background-color', mode === 'dark' ? 'rgb(20, 20, 22)' : 'rgb(255, 255, 255)');
        assert.deepEqual(await dialog.evaluate(findContrastIssues), [], `${mode}: ${await dialog.locator('h2').textContent()}`);
        const stat = dialog.locator('.detail-stat').first();
        if (await stat.count()) await expect(stat).toHaveCSS('background-color', mode === 'dark' ? 'rgb(28, 28, 32)' : 'rgb(248, 249, 251)');
      }
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-detail="net"]').click();
    await page.evaluate(() => window.dashboardTheme.setMode('dark'));
    const dialog = page.locator('#detail');
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
    assert.deepEqual(await dialog.evaluate(findContrastIssues), []);
    await page.locator('#close').click();
    await expect(dialog).not.toBeVisible();
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
});

test('customer detail and shared help dialog keep readable inherited text when switching themes', async () => {
  const app = express(); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('https://**', route => route.abort());
    const customer = { code: 'C1', name: 'ลูกค้าทดสอบ', invoiceCount: 1, net: 100 };
    const detail = { customer, itemNet: 100,
      products: [{ code: 'P1', name: 'ลำโพง', category: 'ระบบเสียง', quantity: 1, unit: 'ชิ้น', total: 100, lastPurchased: '2026-09-08' }],
      categories: [{ code: 'G1', name: 'ระบบเสียง', total: 100 }],
    };
    await page.route('**/api/customer-insights**', route => route.fulfill({ json: route.request().url().includes('/products?')
      ? detail : { customers: [customer], updatedAt: new Date().toISOString() } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/customers.html`);
    await page.locator('#customer-rows button').first().click();
    await expect(page.locator('#detail-content')).toBeVisible();
    for (const mode of ['dark', 'light']) {
      await page.evaluate(mode => window.dashboardTheme.setMode(mode), mode);
      const dialog = page.locator('#customer-detail');
      await expect(dialog.locator('.detail-heading')).toHaveCSS('background-color', mode === 'dark' ? 'rgb(20, 20, 22)' : 'rgb(255, 255, 255)');
      assert.deepEqual(await dialog.evaluate(findContrastIssues), [], mode);
    }
    await page.locator('#detail-close').click();
    await page.locator('[data-insight-help="net"]').click();
    for (const mode of ['dark', 'light']) {
      await page.evaluate(mode => window.dashboardTheme.setMode(mode), mode);
      assert.deepEqual(await page.locator('#insight-help-dialog').evaluate(findContrastIssues), [], mode);
    }
    await page.locator('.insight-help-done').click();
    await expect(page.locator('#insight-help-dialog')).not.toBeVisible();
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
});
