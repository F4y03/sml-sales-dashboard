import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from '@playwright/test';
import { installExecutive, shiftMonth, growth } from './executive.js';

test('comparison periods clamp month ends and handle missing bases', () => {
  assert.equal(shiftMonth('2024-03-31', -1), '2024-02-29');
  assert.equal(shiftMonth('2024-02-29', -12), '2023-02-28');
  assert.equal(growth(120, 100), 20);
  assert.equal(growth(0, 100), -100);
  assert.equal(growth(100, 0), null);
  assert.equal(growth(100, -10), null);
});

test('API validates dates, binds comparisons and does not mask failures', async () => {
  let calls = 0, fail = false;
  const app = express();
  installExecutive(app, { query: async (sql, params) => {
    calls++;
    assert.deepEqual(params, ['2024-03-01', '2024-03-31', '2024-02-01', '2024-02-29', '2023-03-01', '2023-03-31']);
    if (fail) throw Object.assign(new Error('offline'), { code: 'TEST_OFFLINE' });
    return { rows: [{ summary: { net: 120, previousNet: 100, yearNet: 0 } }] };
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/executive`;
  try {
    for (const query of ['', '?start=2024-02-30&end=2024-03-31', '?start=2024-04-01&end=2024-03-01', '?start=2020-01-01&end=2024-01-01', '?start[]=2024-03-01&end=2024-03-31']) {
      assert.equal((await fetch(url + query)).status, 400);
    }
    assert.equal(calls, 0);
    const response = await fetch(url + '?start=2024-03-01&end=2024-03-31');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.mom, 20); assert.equal(data.yoy, null);
    fail = true;
    assert.equal((await fetch(url + '?start=2024-03-01&end=2024-03-31')).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('browser: drilldowns, targets, alerts, safe text, mobile, errors and empty state', async () => {
  const app = express(); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const fixture = { net: 900, sales: 1000, returns: 100, profit: 100, revenue: 800, mom: -25, yoy: null, count: 2, start: '2026-09-01', end: '2026-09-08', previous: { start: '2026-08-01', end: '2026-08-08' }, year: { start: '2025-09-01', end: '2025-09-08' }, previousNet: 1200, yearNet: 0, updatedAt: new Date().toISOString(), products: [{ code: 'P1', name: '<img src=x onerror=alert(1)>', sales: 900, profit: 20, revenue: 800, stock: 2, unit: 'ชิ้น' }], branches: [{ name: 'สาขาหลัก', sales: 900 }], staff: [{ name: 'พนักงานหนึ่ง', sales: 900 }], declines: [{ name: 'สาขาหลัก', sales: 900, previous: 1200 }], bills: [{ docNo: 'INV1', date: '2026-09-08', flag: 44, total: 1000, lineTotal: 800 }], unusual: [{ docNo: 'INV1', date: '2026-09-08', flag: 44, total: 1000, lineTotal: 800, difference: 200 }] };
    fixture.salesInvoiceCount = 2;
    fixture.averageSale = 500;
    let failed = false, empty = false;
    await page.route('**/api/executive?**', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'ฐานข้อมูลไม่พร้อม' } : empty ? { ...fixture, count: 0, net: 0, sales: 0, returns: 0, profit: null, revenue: null, products: [], branches: [], staff: [], declines: [], bills: [], unusual: [] } : fixture }));
    await page.goto(`http://127.0.0.1:${server.address().port}/executive.html`);
    await page.locator('#summary:visible').waitFor();
    const controls = await page.locator('#start, #end, #target, #refresh').evaluateAll(inputs => inputs.map(input => ({ top: input.getBoundingClientRect().top, height: input.getBoundingClientRect().height })));
    assert.ok(controls.every(control => Math.abs(control.top - controls[0].top) < 1));
    assert.ok(controls.every(control => control.height === 44));
    assert.equal(await page.locator('#net').textContent(), '฿900');
    assert.equal(await page.locator('#products img').count(), 0);
    assert.equal(await page.locator('.alert').count(), 3);
    assert.equal(await page.locator('.alert-category').count(), 3);
    assert.equal(await page.locator('.alert-metric strong').count(), 3);
    await page.locator('.alert-action').last().click();
    assert.ok((await page.locator('#detail-body').textContent()).includes('INV1'));
    await page.click('#close');
    for (const value of ['0', '-1', 'abc', '1.001']) {
      await page.fill('#target', value);
      assert.equal(await page.locator('#target').evaluate(input => input.validity.valid), false);
      assert.equal(await page.locator('#achievement').textContent(), 'ยังไม่ตั้งเป้า');
    }
    for (const value of ['0.01', '1000', '1000000']) {
      await page.fill('#target', value);
      assert.equal(await page.locator('#target').evaluate(input => input.validity.valid), true);
    }
    await page.fill('#target', '1000');
    assert.equal(await page.locator('#achievement').textContent(), '90%');
    assert.equal(await page.locator('#target-hint').count(), 0);
    await page.fill('#target', '1000000.01');
    assert.equal(await page.locator('#target').evaluate(input => input.validity.valid), true);
    await page.fill('#target', '1500000');
    assert.equal(await page.locator('#target').inputValue(), '1,500,000');
    await page.fill('#target', '1,500,000.25');
    assert.equal(await page.locator('#target').inputValue(), '1,500,000.25');
    assert.equal(await page.locator('#target').evaluate(input => input.validity.valid), true);
    await page.fill('#target', '1500000');
    assert.equal(await page.locator('#achievement').textContent(), '0.06%');
    assert.equal(await page.locator('#sales-invoice-count').textContent(), '2 บิล');
    assert.ok((await page.locator('#average-sale').textContent()).includes('฿500'));
    for (const kind of ['net', 'activity', 'growth', 'target']) {
      await page.click(`[data-detail="${kind}"]`);
      assert.ok(await page.locator('#detail').isVisible());
      assert.ok((await page.locator('#detail-body').textContent()).includes('2026-09-01'));
      await page.click('#close');
    }
    await page.click('#staff-tab');
    assert.ok((await page.locator('#leaders').textContent()).includes('พนักงานหนึ่ง'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    failed = true; await page.click('#refresh');
    await page.waitForFunction(() => document.getElementById('status').textContent === 'ฐานข้อมูลไม่พร้อม');
    assert.ok(await page.locator('#summary').isHidden());
    failed = false; empty = true;
    fixture.salesInvoiceCount = 0; fixture.averageSale = null;
    await page.click('#refresh');
    await page.locator('#summary:visible').waitFor();
    assert.ok((await page.locator('#status').textContent()).includes('ไม่พบเอกสาร'));
    assert.equal(await page.locator('#sales-invoice-count').textContent(), '0 บิล');
    assert.ok((await page.locator('#average-sale').textContent()).includes('ยังไม่มีบิลขาย'));
    assert.equal(await page.locator('.alert').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
