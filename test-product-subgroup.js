import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installProducts } from './products.js';

// Run with node --env-file=.env --test test-product-subgroup.js (read-only SML).
test('subgroups filter products, pagination and exports consistently', async () => {
  const pool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 15000, options: '-c default_transaction_read_only=on' });
  const app = express();
  installProducts(app, pool);
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    const get = async path => {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      return response.json();
    };
    const all = await get('/api/products');
    const target = all.subgroups.find(g => Number(g.count) > 50);
    assert.ok(target, 'database has a subgroup spanning multiple pages');
    const params = new URLSearchParams({ subgroup: target.code });
    const first = await get('/api/products?' + params);
    assert.equal(first.matching, Number(target.count));
    assert.ok(first.rows.every(row => row.group_sub === target.code));
    const group = first.rows[0].group_main;
    params.set('group', group);
    const listing = await get('/api/products?' + params);
    assert.ok(listing.subgroups.some(g => g.code === target.code && g.name));
    const second = await get('/api/products?' + params + '&page=1');
    assert.ok(second.rows.length > 0);
    assert.ok(second.rows.every(row => row.group_sub === target.code && row.group_main === group));
    assert.ok(!second.rows.some(row => listing.rows.some(firstRow => firstRow.code === row.code)));
    const exported = await get('/api/products/export?scope=filtered&format=json&' + params);
    assert.equal(exported.products.length, listing.matching);
    assert.equal(exported.metadata.subgroup, target.code);
    assert.ok(exported.products.every(row => row.group_sub === target.code && row.group_main === group));
    const xlsx = await fetch(base + '/api/products/export?scope=filtered&format=xlsx&' + params);
    assert.equal(xlsx.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
    assert.equal(book.worksheets[0].rowCount - 1, listing.matching);
    const csv = await fetch(base + '/api/products/export?scope=filtered&format=csv&' + params);
    assert.equal(csv.status, 200);
    assert.equal(Number(csv.headers.get('X-Product-Count')), listing.matching);
    await csv.text();
    const unfiltered = await get('/api/products/export?scope=all&format=json&' + params);
    assert.equal(unfiltered.products.length, all.total);
    assert.equal(unfiltered.metadata.subgroup, '');
    assert.equal((await fetch(base + '/api/products?subgroup=a&subgroup=b')).status, 400);
    const injected = await get('/api/products?' + new URLSearchParams({ subgroup: "' OR 1=1 --" }));
    assert.equal(injected.matching, 0);

    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://**', route => route.abort());
    await page.route('**/api/auth/**', route => route.fulfill({ json: { user: { name: 'Test', username: 'test', role: 'super_admin' } } }));
    await page.goto(base + '/products.html');
    await expect(page.locator('#product-subgroup')).toBeEnabled();
    const change = async (selector, value) => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/products');
      await page.selectOption(selector, value);
      assert.equal((await response).status(), 200);
      await expect(page.locator('#search-products')).toBeEnabled();
    };
    await change('#product-group', group);
    await change('#product-subgroup', target.code);
    await expect(page.locator('#product-filtered-count')).toHaveText(`พบ ${listing.matching.toLocaleString('th-TH')} รายการ`);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('prplus-access', { detail: { role: 'super_admin' } })));
    await page.click('#open-export');
    await page.selectOption('#export-format', 'json');
    const download = page.waitForEvent('download');
    await page.click('#download-products');
    const contents = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    assert.equal(contents.metadata.subgroup, target.code);
    assert.equal(contents.products.length, listing.matching);
    await page.click('#close-export');
    for (const mode of ['light', 'dark']) {
      await page.locator(`[data-theme-mode="${mode}"]`).click();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width === 1440) assert.ok((await page.locator('#product-search').boundingBox()).width >= 220);
        await page.locator('#product-filters').screenshot({ path: `test-results/product-subgroups-${mode}-${width}.png` });
      }
    }
    const another = all.groups.find(g => g.code !== group).code;
    await change('#product-group', another);
    await expect(page.locator('#product-subgroup')).toHaveValue('');
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/products');
    await page.click('#clear-products');
    await response;
    await expect(page.locator('#product-subgroup')).toHaveValue('');
    await expect(page.locator('#product-group')).toHaveValue('');
    await expect(page.locator('#product-filtered-count')).toHaveText(`พบ ${all.total.toLocaleString('th-TH')} รายการ`);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
