import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('explanations: every trigger, current values, keyboard, backdrop, mobile and separate product actions', async () => {
  const app = express(); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1' || (url.pathname.endsWith('.js') && !url.pathname.endsWith('insights-help.js'))) return route.abort();
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/customers.html`);
    await page.evaluate(() => {
      ['customer-dashboard', 'product-view', 'performance-dashboard'].forEach(id => document.getElementById(id).hidden = false);
      document.getElementById('total-net').textContent = '฿4,621,087.71';
      document.getElementById('matching-count').textContent = '171 ราย';
      window.productClicks = 0;
      document.querySelector('.performance-kpi').addEventListener('click', () => window.productClicks++);
    });
    const triggers = page.locator('[data-insight-help]');
    await expect(triggers).toHaveCount(11);
    const dialog = page.locator('#insight-help-dialog');
    for (let index = 0; index < 11; index++) {
      const trigger = triggers.nth(index);
      await trigger.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('h2')).not.toBeEmpty();
      assert.ok(!(await dialog.innerText()).includes('???'));
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
    assert.equal(await page.evaluate(() => window.productClicks), 0);
    await page.locator('.performance-kpi').first().click();
    assert.equal(await page.evaluate(() => window.productClicks), 1);
    await page.locator('[data-insight-help=net]').focus();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.insight-help-value')).toContainText('฿4,621,087.71');
    await mkdir('test-results', { recursive: true });
    await dialog.screenshot({ path: 'test-results/insights-help-desktop.png' });
    await page.locator('.insight-help-done').click();
    await page.evaluate(() => document.getElementById('total-net').textContent = '฿123.00');
    await page.locator('[data-insight-help=net]').click();
    await expect(dialog.locator('.insight-help-value')).toContainText('฿123.00');
    await page.mouse.click(1, 1);
    await expect(dialog).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-insight-help=net]').click();
    assert.ok(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth));
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(e => e.contains(document.activeElement)));
    await dialog.screenshot({ path: 'test-results/insights-help-mobile.png' });
    await page.getByRole('button', { name: 'ปิดคำอธิบาย', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
