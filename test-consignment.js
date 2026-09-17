import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, summarize, headers, regionFor } from './public/consignment-data.js';
import express from 'express';
import { chromium } from '@playwright/test';
const csv = lines => [headers.join(','), ...lines].join('\n');
test('latest customer/product snapshots, month gaps and intersecting slicers', () => {
  const rows = parseCSV(csv(['2026-01-01,ฝหย-001,,ลำโพง,รับเข้า,100,100','2026-03-01,ฝหย-001,,ลำโพง,เบิกออก,20,80','2026-03-01,ฝหย-001,,ลำโพง,รับเข้า,5,85','2026-01-02,ฝกจ,,ลำโพง,รับเข้า,50,50','2026-03-02,ฝหย-001,,ไมค์,รับเข้า,10,10']));
  const all = summarize(rows); assert.equal(all.balance,145); assert.equal(all.withdrawal,20); assert.equal(all.byMonth.get('2026-02'),0);
  assert.equal(summarize(rows,new Set(['ฝหย-001'])).balance,95);
  assert.equal(summarize(rows,new Set(['ฝหย-001']),new Set(['ภาคกลาง'])).count,0);
  assert.equal(regionFor('ฝอย-12'),'ภาคตะวันออกเฉียงเหนือ'); assert.equal(regionFor('ฝใหม่'),'ไม่ระบุภูมิภาค');
});
test('CSV quotes, invalid dates, negative balances and malformed numbers', () => {
  const line = '2026-01-01,ฝหย,,"สินค้า, รุ่น ""A""",รับเข้า,1,-1';
  assert.equal(parseCSV(csv([line]))[0].product,'สินค้า, รุ่น "A"');
  assert.equal(summarize(parseCSV(csv([line]))).balance,-1);
  assert.throws(() => parseCSV(csv([line.replace('2026-01-01','2026-02-30')])));
  assert.throws(() => parseCSV(csv([line.replace(',1,-1',',x,-1')])));
  assert.throws(() => parseCSV(csv([line.replace(',1,-1',',-1,-1')])));
  assert.throws(() => parseCSV(headers.join(',')));
});
