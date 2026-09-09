import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installCustomerInsights } from './customer-insights.js';

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('customer API validates dates and codes, binds exact customer codes, and reports missing data and failures', async () => {
  const app = express();
  const calls = [];
  let fail = false, missing = false;
  installCustomerInsights(app, { query: async (sql, params) => {
    calls.push(params);
    if (fail) throw Object.assign(new Error('private database details'), { code: 'TEST_OFFLINE' });
    return { rows: [{ insights: params.length === 3 ? { customer: missing ? null : { code: params[2] }, products: [], categories: [], itemNet: 0 } : { customers: [] } }] };
  } });
  const { server, base } = await listen(app);
  try {
    for (const endpoint of ['', '/products']) {
      for (const query of ['', '?start=2026-02-30&end=2026-03-01', '?start=2026-10-01&end=2026-09-09', '?start=2020-01-01&end=2026-09-09', '?start=2026-09-01&start=2026-09-02&end=2026-09-09']) {
        assert.equal((await fetch(`${base}/api/customer-insights${endpoint}${query}`)).status, 400);
      }
    }
    const period = '?start=2026-09-01&end=2026-09-09';
    for (const code of ['', '&code=C1&code=C2', `&code=${'x'.repeat(201)}`]) {
      assert.equal((await fetch(`${base}/api/customer-insights/products${period}${code}`)).status, 400);
    }
    assert.equal(calls.length, 0);
    const response = await fetch(`${base}/api/customer-insights${period}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).customers, []);
    assert.deepEqual(calls[0], ['2026-09-01', '2026-09-09']);
    for (const code of ['', "C&' OR 1=1 --", 'ลูกค้า/01']) {
      const result = await fetch(`${base}/api/customer-insights/products${period}&${new URLSearchParams({ code })}`);
      assert.equal(result.status, 200);
      assert.equal((await result.json()).customer.code, code);
      assert.deepEqual(calls.at(-1), ['2026-09-01', '2026-09-09', code]);
    }
    missing = true;
    assert.equal((await fetch(`${base}/api/customer-insights/products${period}&code=C1`)).status, 404);
    fail = true;
    for (const endpoint of ['', '/products']) {
      const result = await fetch(`${base}/api/customer-insights${endpoint}${period}&code=C1`);
      assert.equal(result.status, 503);
      assert.ok(!(await result.text()).includes('private database'));
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('browser: HTML 404, HTML fallback and broken JSON show actionable errors and recover after retry', async () => {
  const app = express();
  app.use(express.static('public'));
  const { server, base } = await listen(app);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const customer = { code: 'C1', name: 'ลูกค้าทดสอบ', invoiceCount: 1, net: 100 };
    const html = { status: 404, contentType: 'text/html', body: '<!DOCTYPE html><html><body>Cannot GET /api/customer-insights</body></html>' };
    let masterResponse = html, detailResponse = html;
    await page.route('**/api/customer-insights**', route => route.fulfill(route.request().url().includes('/products?') ? detailResponse : masterResponse));
    await page.goto(`${base}/customers.html`);
    await expect(page.locator('#status')).toContainText('ไม่พบ API ลูกค้า');
    await expect(page.locator('#status')).toContainText('รีสตาร์ตเซิร์ฟเวอร์');
    await expect(page.locator('#customer-dashboard')).toBeHidden();
    masterResponse = { ...html, status: 200 };
    await page.locator('#refresh').click();
    await expect(page.locator('#status')).toContainText('เซิร์ฟเวอร์ส่งข้อมูลผิดรูปแบบ');
    masterResponse = { status: 200, contentType: 'application/json', body: '{"customers":' };
    await page.locator('#refresh').click();
    await expect(page.locator('#status')).toContainText('ข้อมูลจากเซิร์ฟเวอร์ไม่สมบูรณ์');
    masterResponse = { status: 200, json: { customers: [customer], updatedAt: '2026-09-09T08:00:00Z' } };
    await page.locator('#refresh').click();
    await expect(page.locator('#customer-dashboard')).toBeVisible();
    await expect(page.locator('#customer-detail')).toBeHidden();
    await page.locator('#customer-rows button').first().click();
    await expect(page.locator('#detail-status')).toContainText('ไม่พบ API ลูกค้า');
    await expect(page.locator('#detail-retry')).toBeVisible();
    await expect(page.locator('#detail-content')).toBeHidden();
    detailResponse = { status: 200, json: { customer, products: [], categories: [], itemNet: 0 } };
    await page.locator('#detail-retry').click();
    await expect(page.locator('#detail-content')).toBeVisible();
    await expect(page.locator('#detail-title')).toContainText(customer.name);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('browser: filters, chart/table master-detail, pagination, safe text, races, errors and responsive layout', async () => {
  const app = express();
  app.use(express.static('public'));
  const { server, base } = await listen(app);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const dialog = page.locator('#customer-detail');
    const closePopup = async () => {
      if (await dialog.isVisible()) {
        await page.locator('#detail-close').click();
        await expect(dialog).toBeHidden();
      }
    };
    const openCustomer = async trigger => {
      await closePopup();
      await trigger.click();
      await expect(dialog).toBeVisible();
    };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const names = ['บริษัท เสียงดี โปรเฟสชันแนล จำกัด', 'บริษัท มิวสิค พลัส จำกัด', 'ห้างหุ้นส่วน แสงสีเสียง', 'บริษัท ออดิโอ โซลูชัน จำกัด', 'ร้าน สยามมิวสิค', 'บริษัท ไลฟ์ซาวด์ จำกัด', 'ร้าน บ้านเครื่องเสียง', 'บริษัท สตูดิโอ โปร จำกัด', 'บริษัท พีเอ เซ็นเตอร์ จำกัด', 'ร้าน เมโลดี้ มิวสิค', '<img src=x onerror=alert(1)>', 'ลูกค้าไม่ระบุรหัส'];
    const customers = names.map((name, index) => ({ code: index === 11 ? '' : `C${String(index + 1).padStart(3, '0')}`, name, invoiceCount: 24 - index, net: 286450 - index * 22000 }));
    const productNames = ['ลำโพงแอคทีฟ 12 นิ้ว', 'ไมโครโฟนไร้สาย ดิจิทัล', 'มิกเซอร์ดิจิทัล 16 แชนแนล', 'เพาเวอร์แอมป์ 2 แชนแนล', 'สายสัญญาณ XLR', 'ขาตั้งไมโครโฟน', 'ลำโพงมอนิเตอร์', 'หัวต่อสัญญาณ', '<svg onload=alert(1)>'];
    const detailsFor = customer => ({
      customer,
      products: productNames.map((name, index) => ({ code: `P${index}`, name, category: index % 2 ? 'ไมโครโฟนและอุปกรณ์' : 'ระบบเสียง', quantity: index + 1, unit: index === 4 ? 'กล่อง' : 'ชิ้น', total: index === 0 ? 600 : 50, lastPurchased: index === 8 ? null : '2026-09-09' })),
      categories: [{ code: 'G1', name: 'ระบบเสียง', total: 750 }, { code: 'G2', name: 'ไมโครโฟนและอุปกรณ์', total: 250 }], itemNet: 1000
    });
    let failMaster = false, failDetail = false, empty = false, noProducts = false, negative = false;
    let holdDetail = null;
    const requests = [];
    await page.route('**/api/customer-insights**', async route => {
      const url = new URL(route.request().url());
      requests.push(url);
      if (url.pathname.endsWith('/products')) {
        const code = url.searchParams.get('code');
        if (holdDetail?.code === code) {
          holdDetail.route = route;
          return;
        }
        const customer = customers.find(item => item.code === code);
        const data = detailsFor(customer);
        if (noProducts) Object.assign(data, { products: [], categories: [], itemNet: 0 });
        if (negative) data.categories = [{ code: 'G1', name: 'คืนสินค้า', total: -500 }, { code: 'G2', name: 'ยอดศูนย์', total: 0 }];
        await route.fulfill({ status: failDetail ? 503 : 200, json: failDetail ? { error: 'โหลดสินค้าทดสอบไม่สำเร็จ' } : data });
      } else await route.fulfill({ status: failMaster ? 503 : 200, json: failMaster ? { error: 'ฐานข้อมูลทดสอบไม่พร้อม' } : { customers: empty ? [] : customers, updatedAt: '2026-09-09T08:00:00Z' } });
    });
    await page.goto(`${base}/customers.html`);
    await expect(page.locator('#customer-dashboard')).toBeVisible();
    await expect(dialog).toBeHidden();
    assert.ok(!requests.some(url => url.pathname.endsWith('/products')), 'load products only after a customer click');
    await openCustomer(page.locator('#customer-rows button').first());
    await expect(page.locator('#detail-content')).toBeVisible();
    assert.equal(await page.locator('#customer-chart button').count(), 10);
    assert.equal(await page.locator('#customer-rows tr').count(), 10);
    assert.equal(await page.locator('#product-rows tr').count(), 8);
    await expect(page.locator('#detail-title')).toContainText(names[0]);
    await expect(page.locator('#category-legend')).toContainText('75%');
    await expect(page.locator('#category-legend')).toContainText('25%');
    await expect(page.locator('#customer-count')).toHaveText('12');

    await closePopup();
    await page.locator('#customer-rows button').nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#detail-title')).toContainText(names[1]);
    await expect(page.locator('#customer-chart button').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await openCustomer(page.locator('#customer-chart button').nth(2));
    await expect(page.locator('#detail-content')).toBeVisible();
    await expect(page.locator('#detail-title')).toContainText(names[2]);
    await expect(page.locator('#customer-rows tr').nth(2)).toHaveClass('selected');
    await closePopup();
    await page.locator('#customer-next').click();
    assert.equal(await page.locator('#customer-rows tr').count(), 2);
    await openCustomer(page.locator('#customer-rows button').first());
    await expect(page.locator('#detail-content')).toBeVisible();
    await expect(page.locator('#detail-title')).toContainText('<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('main img').count(), 0);
    await page.locator('#product-next').click();
    assert.equal(await page.locator('#product-rows tr').count(), 1);
    assert.equal(await page.locator('#product-rows svg').count(), 0);
    await expect(page.locator('#product-rows')).toContainText('ไม่มีบิลขายในช่วงนี้');
    await expect(page.locator('#product-next')).toBeDisabled();

    await closePopup();
    await page.locator('#customer-search').fill('c002');
    await expect(dialog).toBeHidden();
    await openCustomer(page.locator('#customer-rows button').first());
    await expect(page.locator('#detail-title')).toContainText(names[1]);
    await expect(page.locator('#customer-count')).toHaveText('1');
    assert.equal(await page.locator('#customer-chart button').count(), 1);
    await closePopup();
    await page.locator('#customer-search').fill('บ้านเครื่องเสียง');
    await openCustomer(page.locator('#customer-rows button').first());
    await expect(page.locator('#detail-title')).toContainText(names[6]);
    await closePopup();
    await page.locator('#customer-search').fill('%');
    await expect(page.locator('#customer-count')).toHaveText('0');
    await expect(page.locator('#detail-content')).toBeHidden();
    await expect(page.locator('#total-net')).toHaveText('฿0.00');
    await page.locator('#customer-search').fill('ไม่ระบุรหัส');
    await openCustomer(page.locator('#customer-rows button').first());
    await expect(page.locator('#detail-content')).toBeVisible();
    assert.ok(requests.some(url => url.pathname.endsWith('/products') && url.searchParams.get('code') === ''));
    await closePopup();
    await page.locator('#customer-search').fill('');
    await openCustomer(page.locator('#customer-chart button').first());
    await expect(page.locator('#detail-content')).toBeVisible();

    // Inspect both layouts with realistic fixture labels and full tables.
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/customers-desktop.png', fullPage: true });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}px`);
      assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), `dialog overflow at ${width}px`);
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/customers-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1080 });

    // Native dialog focus stays inside; closing returns to the actual customer trigger.
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.locator('#customer-chart button').first()).toBeFocused();
      await openCustomer(page.locator('#customer-chart button').first());
      await expect(page.locator('#detail-close')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
      await page.locator('#detail-title').click();
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      await page.mouse.move(bounds.x + 30, bounds.y + 30);
      await page.mouse.down();
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await expect(dialog).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(dialog).toBeHidden();
      await expect(page.locator('#customer-chart button').first()).toBeFocused();
      assert.ok(!(await page.locator('body').getAttribute('class')).includes('customer-dialog-open'));
      await openCustomer(page.locator('#customer-chart button').first());
    }

    // A late response after closing a popup must not replace the next customer's products.
    holdDetail = { code: 'C002' };
    await openCustomer(page.locator('#customer-chart button').nth(1));
    await expect(page.locator('#customer-detail')).toHaveAttribute('aria-busy', 'true');
    await closePopup();
    await expect(dialog).toBeHidden();
    await openCustomer(page.locator('#customer-rows tr').nth(2).locator('td').last());
    await expect(page.locator('#detail-content')).toBeVisible();
    assert.ok(holdDetail.route);
    await holdDetail.route.fulfill({ json: detailsFor(customers[1]) }).catch(() => {});
    holdDetail = null;
    await expect(page.locator('#detail-title')).toContainText(names[2]);

    // Changing dates keeps the popup closed; the next click uses the updated range.
    await closePopup();
    await page.locator('#start').fill('2026-08-01');
    await page.locator('#end').fill('2026-08-31');
    await expect(page.locator('#customer-dashboard')).toBeVisible();
    await expect(dialog).toBeHidden();
    await openCustomer(page.locator('#customer-chart button').nth(2));
    await expect(page.locator('#detail-content')).toBeVisible();
    await expect.poll(() => requests.at(-1)?.searchParams.get('end')).toBe('2026-08-31');
    assert.equal(requests.at(-1).searchParams.get('start'), '2026-08-01');
    assert.equal(requests.at(-1).searchParams.get('code'), 'C003');
    await closePopup();
    await page.locator('#end').fill('2026-07-31');
    await expect(page.locator('#customer-dashboard')).toBeHidden();
    assert.equal(await page.locator('#end').evaluate(input => input.validity.valid), false);
    await page.locator('#end').fill('2026-08-31');
    await expect(page.locator('#customer-dashboard')).toBeVisible();
    await expect(dialog).toBeHidden();

    failDetail = true;
    await openCustomer(page.locator('#customer-chart button').first());
    await expect(page.locator('#detail-retry')).toBeVisible();
    await expect(page.locator('#detail-content')).toBeHidden();
    await expect(page.locator('#customer-dashboard')).toBeVisible();
    failDetail = false;
    await page.locator('#detail-retry').click();
    await expect(page.locator('#detail-content')).toBeVisible();
    negative = true;
    await openCustomer(page.locator('#customer-chart button').nth(1));
    await expect(page.locator('#category-empty')).toBeVisible();
    await expect(page.locator('#category-legend')).toContainText('-500.00');
    assert.equal(await page.locator('#category-chart circle').count(), 1);
    assert.ok(!(await page.locator('#category-legend').textContent()).includes('NaN'));
    negative = false;
    noProducts = true;
    await openCustomer(page.locator('#customer-chart button').nth(2));
    await expect(page.locator('#product-rows')).toContainText('ไม่พบรายการสินค้า');
    await expect(page.locator('#product-next')).toBeDisabled();

    await closePopup();
    failMaster = true;
    await page.locator('#refresh').click();
    await expect(page.locator('#status')).toHaveText('ฐานข้อมูลทดสอบไม่พร้อม');
    await expect(page.locator('#customer-dashboard')).toBeHidden();
    failMaster = false;
    empty = true;
    await page.locator('#refresh').click();
    await expect(page.locator('#customer-dashboard')).toBeVisible();
    await expect(page.locator('#customer-count')).toHaveText('0');
    await expect(page.locator('#detail-content')).toBeHidden();
    assert.equal(await page.locator('#customer-chart button').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
