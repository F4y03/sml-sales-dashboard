import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { installReports } from './reports.js';

test('SML categories preserve report types, filter both lists, search and open shortcuts', async () => {
  const reports = [
    { roworder: 1, menuid: '1002', menuname: 'Stock', report_type: 1 },
    { roworder: 2, menuid: '4007', menuname: 'Sales', report_type: 3 },
    { roworder: 3, menuid: 'CUSTOM', menuname: 'Custom', report_type: 0 },
  ];
  const app = express();
  installReports(app, { query: async () => ({ rows: reports }) });
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const result = await (await fetch(base + '/api/reports')).json();
    assert.deepEqual(result.reports.map(r => r.reportType), [1, 3, 0]);
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/\/api\/reports\/[13]$/, route => {
      const report = reports.find(r => String(r.roworder) === route.request().url().split('/').at(-1));
      return route.fulfill({ json: { key: report.roworder, id: report.menuid, name: report.menuname, supported: true, conditions: [], datasets: [{ index: 0, fields: [{ label: 'Amount' }] }] } });
    });
    let runs = 0;
    await page.route('**/api/reports/*/run', route => {
      runs++;
      return route.fulfill({ json: { id: '1002', name: 'Stock', filters: {}, dataset: 0, fields: [{ label: 'Amount', type: 'Number' }], rows: [[42]], page: 0, hasMore: false, updatedAt: new Date().toISOString() } });
    });
    await page.route('**/api/reports/2', route => route.fulfill({ json: { key: 2, id: '4007', name: 'Sales', supported: true, conditions: [{name:'from_date',type:'Date',label:'From date'},{name:'to_date',type:'Date',label:'To date'}], datasets: [{index:0,fields:[{label:'Date'}]}] } }));
    await page.goto(base + '/reports.html');
    await expect(page.locator('#report-select optgroup option')).toHaveCount(3);
    await expect(page.locator('.report-main aside')).toHaveCount(0);
    await page.locator('[data-category="1"]').click();
    await expect(page.locator('#result-body')).toContainText('42');
    await expect(page.locator('#report-settings')).not.toHaveAttribute('open', '');
    assert.equal(runs, 1);
    await page.locator('[data-category="all"]').click();
    await page.locator('#report-select').selectOption('2');
    await expect(page.locator('#report-select')).toHaveValue('2');
    await expect(page.locator('#result-card')).toBeVisible();
    await page.locator('#report-settings summary').click();
    await page.locator('[name=from_date]').fill('2026-09-01');
    await expect(page.locator('#result-card')).toBeHidden();
    await page.locator('#run-report').click();
    await expect(page.locator('#result-card')).toBeVisible();
    await page.locator('#report-settings summary').click();
    await page.screenshot({path:'test-results/reports-simple-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'test-results/reports-simple-mobile.png',fullPage:true});
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
