import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installProducts } from './products.js';

// Integration check against the configured read-only SML database.
const pool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 15000, options: '-c default_transaction_read_only=on' });
const app = express();
installProducts(app, pool);
app.use(express.static('public'));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  for (const activity of ['all', 'active', 'inactive']) {
    for (const stock of ['in', 'out']) {
      const result = await fetch(`${base}/api/products?activity=${activity}&stock=${stock}`);
      assert.equal(result.status, 200);
      const listing = await result.json();
      const exported = await (await fetch(`${base}/api/products/export?format=json&scope=${activity}&stock=${stock}`)).json();
      assert.equal(exported.products.length, listing.matching);
      assert.ok(exported.products.every(p => p.balance_qty != null && (stock === 'in' ? Number(p.balance_qty) > 0 : Number(p.balance_qty) <= 0)));
    }
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/auth/**', route => route.fulfill({ json: { user: { name: 'Test', username: 'test' } } }));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.goto(base + '/products.html', { waitUntil: 'networkidle' });
  const ready = () => page.waitForFunction(() => !document.getElementById('search-products').disabled);
  await ready();
  assert.equal(await page.locator('#product-stock').count(), 1);
  await page.selectOption('#product-activity', 'active'); await ready();
  await page.selectOption('#product-stock', 'in'); await ready();
  await page.click('#open-export');
  assert.equal(await page.inputValue('#export-stock'), 'in');
  const expected = await (await fetch(base + '/api/products?activity=active&stock=in')).json();
  assert.ok((await page.textContent('#download-products')).includes(expected.matching.toLocaleString('th-TH')));
  const downloaded = page.waitForEvent('download');
  await page.click('#download-products');
  const file = await downloaded;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(await file.path()));
  assert.equal(workbook.worksheets[0].rowCount - 1, expected.matching);
  await page.selectOption('#export-scope', 'inactive'); await ready();
  assert.equal(await page.inputValue('#product-stock'), 'in');
  assert.equal(await page.inputValue('#product-activity'), 'inactive');
  await page.selectOption('#export-stock', 'out'); await ready();
  assert.equal(await page.inputValue('#product-stock'), 'out');
  await page.click('#close-export');
  await page.click('#clear-products'); await ready();
  assert.equal(await page.inputValue('#export-stock'), 'all');
  const group = await page.locator('#product-group option').nth(1).getAttribute('value');
  const response = page.waitForResponse(r => r.url().includes('/api/products?') && new URL(r.url()).searchParams.get('group') === group);
  await page.selectOption('#product-group', group);
  await response; await ready();
  await page.fill('#product-search', 'NO_SUCH_PRODUCT_987654321');
  await page.click('#search-products'); await ready();
  assert.equal(await page.locator('#product-table td').count(), 1);
  assert.equal(await page.locator('#product-table td').getAttribute('colspan'), '10');
  assert.deepEqual(errors, []);
  console.log('PASS: six stock/activity API combinations match exports; browser filters, Excel count, popup synchronization, clear, group auto-filter and empty results.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
}
