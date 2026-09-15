import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';

test('sidebar checks the database every minute and recovers after failure', async () => {
  const app = express(); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    await page.clock.install();
    await page.route('https://**', route => route.abort());
    let connected = true, requests = 0;
    await page.route('**/api/**', route => {
      if (route.request().url().includes('/connection-status')) {
        requests++;
        return route.fulfill({ status: connected ? 200 : 503, json: { connected } });
      }
      return route.fulfill({ status: 503, json: { error: 'Test offline' } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/products.html`);
    const status = page.locator('.workspace-connection [role=status]');
    await expect(status).toHaveAttribute('data-state', 'connected');
    assert.equal(requests, 1);
    connected = false;
    await page.clock.fastForward(60000);
    await expect(status).toHaveAttribute('data-state', 'offline');
    assert.equal(requests, 2);
    connected = true;
    await page.clock.fastForward(60000);
    await expect(status).toHaveAttribute('data-state', 'connected');
    assert.equal(requests, 3);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('shared navigation: all pages, active links, cross-page anchors and mobile menu', async () => {
  const app = express(); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.route('https://**', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Test offline' } }));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [file, active] of [['index', 'overview'], ['executive', 'executive'], ['customers', 'customers'], ['reports', 'reports'], ['products', 'products'], ['consignment', 'consignment']]) {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(`${base}/${file}.html`, { waitUntil: 'domcontentloaded' });
      await page.locator('.workspace-sidebar').waitFor();
      assert.equal(await page.locator('.workspace-links a').count(), 6);
      assert.equal(await page.locator('.workspace-links [aria-current]').getAttribute('data-page'), active);
      assert.ok((await page.locator('main').boundingBox()).x >= 246);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.locator('.workspace-links').isHidden());
      await page.locator('.workspace-toggle').click();
      assert.ok(await page.locator('.workspace-links').isVisible());
      assert.ok(await page.locator('.workspace-sidebar').evaluate(sidebar => sidebar.scrollWidth <= innerWidth));
      if (file !== 'index') assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), file);
      await page.keyboard.press('Escape');
      assert.ok(await page.locator('.workspace-links').isHidden());
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('[data-page="overview"]').click();
    await page.waitForURL('**/index.html#overview');
    for (const hash of ['charts', 'products']) {
      await page.goto(`${base}/index.html#${hash}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-page="overview"][aria-current="page"]').waitFor();
      assert.equal(await page.locator('[data-page="charts"], [data-page="bestsellers"]').count(), 0);
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
