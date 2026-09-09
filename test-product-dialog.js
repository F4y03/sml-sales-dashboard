import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from '@playwright/test';

test('product dialog: backdrop closes, content and drag do not, focus returns', async () => {
  const app = express();
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.route('**/api/products?**', route => route.fulfill({ json: {
      rows: [{ code: 'P001', name_1: 'สินค้าทดสอบ' }], fields: [{ key: 'code', label: 'รหัสสินค้า' }, { key: 'name_1', label: 'ชื่อสินค้า' }],
      groups: [], page: 0, pageSize: 50, matching: 1, total: 1, updatedAt: new Date().toISOString()
    } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/products.html`);
    const opener = page.locator('#product-table button').first();
    const dialog = page.locator('#product-detail');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await opener.click();
      await page.locator('#detail-title').click();
      assert.ok(await dialog.isVisible());
      const bounds = await dialog.boundingBox();
      await page.mouse.click(bounds.x + 3, bounds.y + 3);
      assert.ok(await dialog.isVisible());
      await page.mouse.move(bounds.x + 40, bounds.y + 40);
      await page.mouse.down();
      await page.mouse.move(2, 2);
      await page.mouse.up();
      assert.ok(await dialog.isVisible());
      await page.mouse.click(2, 2);
      assert.ok(await dialog.isHidden());
      assert.ok(await opener.evaluate(button => button === document.activeElement));
      await opener.click();
      await page.keyboard.press('Escape');
      assert.ok(await dialog.isHidden());
      await opener.click();
      await page.locator('#close-detail').click();
      assert.ok(await dialog.isHidden());
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
