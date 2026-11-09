// Accounting workbook: figures, missing-data handling and who may download it. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import ExcelJS from 'exceljs';
import { installAuth, hashPassword } from '../src/middleware/auth.js';
import { createAccessStore } from '../src/models/accessStore.js';
import { installAccess } from '../src/middleware/access.js';
import { createUserService } from '../src/services/userService.js';
import { loadUser } from '../src/services/permissionService.js';
import { installMarketplace, marketplaceSummary, saveMarketplaceUpload } from '../src/routes/marketplace.js';
import { accountingData, buildAccountingWorkbook } from '../src/services/marketplaceAccounting.js';

const order = (orderId, orderDate, status, sales, extra = {}) => ({ orderId, orderDate, status, statusRaw: status, sales, refund: 0, province: null, source: 'test', items: null, ...extra });
function seed(store) {
  saveMarketplaceUpload(store, { platform: 'shopee', fileName: 'a', sha256: 'a', user: { full_name: 'x' }, parsed: { kinds: ['orders'],
    orders: [
      order('S1', '2026-09-01', 'completed', 100, { items: [{ lineKey: '1', sku: 'sku-a', name: 'สินค้า A', quantity: 2, sales: 100, status: 'completed' }] }),
      order('S2', '2026-09-02', 'completed', 50),
      order('S3', '2026-09-03', 'cancelled', 70),
      order('S4', '2026-09-04', 'returned', 40, { refund: 40 }),
      order('S5', '2026-07-01', 'completed', 999),
    ],
    settlements: [
      { txnId: 't1', orderId: 'S1', fees: 12, netPayout: 88, detail: { commission_fee: 10 } },
      { txnId: 't3', orderId: 'S3', fees: 1, netPayout: -1 },
    ] } });
}

test('figures tie to the dashboard, follow the filters, and missing money stays empty', async () => {
  const store = createAccessStore(':memory:');
  seed(store);
  const filter = { platform: 'all', shop: 'all', start: '2026-09-01', end: '2026-09-30', now: Date.parse('2026-09-30T00:00:00Z') };
  const data = accountingData(store, filter), row = data.summary[0];
  const dash = marketplaceSummary(store, filter).platforms[0];
  assert.equal(row.sales, dash.sales);
  assert.equal(row.orders, dash.orders);
  assert.equal(row.fees, dash.fees);
  assert.equal(row.net, dash.netPayout);
  assert.equal(data.orders.length, 4, 'order outside the period is excluded');
  assert.equal(data.orders.find(o => o.orderId === 'S2').fees, null, 'no settlement is empty, not 0');
  assert.deepEqual(data.unsettled.map(o => o.orderId), ['S2']);
  assert.deepEqual(data.fees.map(f => [f.type, f.amount]).sort(), [['commission_fee', 10], ['ไม่มีรายละเอียดประเภท', 3]], 'fee types tie to total fees');
  assert.match(data.review.find(o => o.orderId === 'S3').reasons, /ยกเลิกแล้วแต่มีรายการเงิน/);
  assert.match(data.review.find(o => o.orderId === 'S4').reasons, /คืนสินค้า/);
  assert.equal(data.soldWithoutItems, 1);

  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildAccountingWorkbook(store, filter, { by: 'ทดสอบ' }));
  assert.deepEqual(book.worksheets.map(s => s.name), ['สรุป', 'ทะเบียนขายรายออเดอร์', 'ไม่มีข้อมูลการเงิน', 'ค่าธรรมเนียมตามประเภท', 'ขายรายสินค้า', 'รายการที่ต้องตรวจ', 'หมายเหตุ']);
  const register = book.getWorksheet('ทะเบียนขายรายออเดอร์');
  assert.equal(register.rowCount, 5);
  assert.equal(register.getRow(3).getCell('J').value, null, 'blank cell for missing net');
  store.close();
});

test('HTTP: only Super Admin and users Super Admin picked can download; reviewers never', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const store = createAccessStore(':memory:', env), app = express();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installMarketplace(app, store, auth.audit);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  seed(store);
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  const create = (username, role, additionalPermissions = []) => users.save(root, null, { username, full_name: username, role, is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions }, 'test');
  await create('exec1', 'executive');
  await create('acct1', 'executive', ['marketplace_accounting']);
  await create('rev1', 'reviewer', ['marketplace_accounting']);
  const login = async username => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const download = async (username, query = 'platform=all&shop=all&start=2026-09-01&end=2026-09-30') => (await fetch(`${base}/api/marketplace/accounting-report?${query}`, { headers: { cookie: await login(username) } })).status;
  assert.equal(await download('root'), 200);
  assert.equal(await download('acct1'), 200);
  assert.equal(await download('exec1'), 403, 'seeing online sales is not enough');
  assert.equal(await download('rev1'), 403);
  assert.equal(await download('root', 'start=bad&end=2026-09-30'), 400);
  assert.ok(store.get("SELECT 1 FROM activity_logs WHERE action='marketplace.accounting_report'"), 'download is logged');
});
