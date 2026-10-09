// Marketplace (Shopee / Lazada / TikTok) upload + summary. Fixtures are synthetic and mirror the column layout of
// the Seller Center sample exports described in MARKETPLACE.md; no real customer data is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import ExcelJS from 'exceljs';
import { installAuth, hashPassword } from './auth.js';
import { createAccessStore } from './src/models/accessStore.js';
import { installAccess } from './src/middleware/access.js';
import { createUserService } from './src/services/userService.js';
import { loadUser } from './src/services/permissionService.js';
import { installMarketplace, marketplaceSummary } from './marketplace.js';
import { parseMarketplaceFile, parseDate } from './src/services/marketplaceParser.js';

const PII = ['ทดสอบ ผู้รับ', '0812345678', '99/1 ถนนทดสอบ', 'buyer@example.com'];

const tiktokHeader = ['Order ID', 'Order Status', 'Order Substatus', 'Cancelation/Return Type', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity', 'Sku Quantity of return', 'SKU Subtotal Before Discount', 'SKU Seller Discount', 'Order Refund Amount', 'Created Time', 'Recipient', 'Phone #', 'Province', 'Detail Address'];
const tiktokCsv = () => [
  tiktokHeader,
  ['Platform unique order ID.', 'Current order status.', '', '', 'Platform SKU ID.', '', '', '', 'SKU sold quantity in the order.', '', '', '', '', 'Order created time.', '', '', '', ''],
  ['900000000000000001', 'เสร็จสมบูรณ์', 'เสร็จสมบูรณ์', '', '111', 'SKU-A', 'สาย LAN "CAT5"', '', '2', '0', '600', '0', '', '30/09/2026 22:19:31', PII[0], PII[1], 'ปัตตานี', PII[2]],
  ['900000000000000001', 'เสร็จสมบูรณ์', 'เสร็จสมบูรณ์', '', '222', 'SKU-B', 'ปลายหัวแร้ง', '', '1', '0', '40', '5', '', '30/09/2026 22:19:31', PII[0], PII[1], 'ปัตตานี', PII[2]],
  ['900000000000000002', 'ยกเลิกแล้ว', 'ยกเลิกแล้ว', 'Cancel', '111', 'SKU-A', 'สาย LAN "CAT5"', '', '1', '1', '300', '0', '300', '01/09/2026 10:00:00', PII[0], PII[1], 'ชลบุรี', PII[2]],
  ['900000000000000003', 'จัดส่งแล้ว', 'อยู่ระหว่างขนส่ง', '', '111', 'SKU-A', 'สาย LAN "CAT5"', '', '1', '0', '300', '0', '', '02/09/2026 10:00:00', PII[0], PII[1], 'ชลบุรี', PII[2]],
].map(row => row.map(v => /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\r\n');

async function xlsx(sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) workbook.addWorksheet(name).addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const lazadaFile = () => xlsx({
  'Balance Transactions': [['Transaction Number', 'Transaction Time', 'Type', 'Sub Type', 'Amount', 'Remarks'], ['5026', '28 Sep 2026 10:21:19', 'Withdrawal', 'Auto', '-103.04', '']],
  sheet1: [
    ['orderItemId', 'createTime', 'orderNumber', 'customerName', 'customerEmail', 'shippingAddress3', 'shippingPhone', 'billingAddr3', 'sellerSku', 'unitPrice', 'sellerDiscountTotal', 'itemName', 'status', 'refundAmount'],
    ['5001', '30 Sep 2026 19:16', '7000000000000001', PII[0], PII[3], 'ป*i', PII[1], 'ปทุมธานี/ Pathum Thani', 'SKU-A', '38.00', '', 'คาปาซิเตอร์', 'confirmed', ''],
    ['5002', '30 Sep 2026 19:16', '7000000000000001', PII[0], PII[3], 'ป*i', PII[1], 'ปทุมธานี/ Pathum Thani', 'SKU-A', '38.00', '-3', 'คาปาซิเตอร์', 'canceled', ''],
    ['5003', '01 Sep 2026 08:00', '7000000000000002', PII[0], PII[3], '', PII[1], 'ลพบุรี/ Lopburi', 'SKU-C', '100', '', 'ลำโพง', 'shipped', ''],
    ['5004', '02 Sep 2026 08:00', '7000000000000003', PII[0], PII[3], '', PII[1], 'ลพบุรี/ Lopburi', 'SKU-C', '100', '', 'ลำโพง', 'canceled', ''],
  ],
});
const shopeeFile = () => xlsx({
  Income: [
    ['ชื่อผู้ใช้ (ผู้ขาย)', 'จาก', 'ถึง'], ['shop', '2026-09-01', '2026-09-30'], [], [], ['ยอดรวม (฿)'],
    ['ลำดับที่', 'หมายเลขคำสั่งซื้อ', 'รหัสคืนสินค้า', 'ชื่อผู้ใช้ (ผู้ซื้อ)', 'วันที่ทำการสั่งซื้อ', 'สินค้าราคาปกติ', 'ส่วนลดสินค้าจากผู้ขาย', 'จำนวนเงินที่ทำการคืนให้ผู้ซื้อ', 'ค่าคอมมิชชั่น ams', 'ค่าคอมมิชชั่น', 'ค่าบริการ', 'ค่าธุรกรรมการชำระเงิน', 'จำนวนเงินทั้งหมดที่โอนแล้ว (฿)'],
    [1, '2609020K2WK5B7', '', 'buyer1', '2026-09-02', 60, 0, 0, 0, -8, 0, -3, 49],
    [2, '260919ES9NB0VD', '', 'buyer2', '2026-09-19', 160, -10, 0, 0, -23, 0, -6, 121],
    [3, '260920RETURN01', 'R123', 'buyer3', '2026-09-20', 80, 0, -80, 0, 0, 0, 0, 0],
  ],
  'Transaction Report': [['วันที่', 'ประเภทการทำธุรกรรม', 'คำอธิบาย', 'รหัสคำสั่งซื้อ', 'รูปแบบธุรกรรม', 'จำนวนเงิน', 'สถานะ', 'ยอดเงินหลังทำธุรกรรมเสร็จสิ้น']],
});
const tiktokSettlement = () => xlsx({
  'รายละเอียดคำสั่งซื้อ': [
    ['หมายเลขคำสั่งซื้อ/การปรับ', 'ประเภทธุรกรรม', 'ยอดการชำระเงินทั้งหมด', 'รายได้ทั้งหมด', 'ค่าธรรมเนียมทั้งหมด', 'หมายเลขคำสั่งซื้อที่เกี่ยวข้อง'],
    ['900000000000000001', 'คำสั่งซื้อ', '560.84', '635', '-74.16', '900000000000000001'],
    ['900000000000099999', 'Other adjustment', '-5', '0', '-5', '900000000000000001'],
  ],
});

test('date parsing covers each platform format, พ.ศ. and rejects garbage', () => {
  assert.equal(parseDate('30/09/2026 22:19:31'), '2026-09-30');
  assert.equal(parseDate('30 Sep 2026 19:16'), '2026-09-30');
  assert.equal(parseDate('2026/09/29'), '2026-09-29');
  assert.equal(parseDate('2026-09-02'), '2026-09-02');
  assert.equal(parseDate('02/09/2569'), '2026-09-02');
  assert.equal(parseDate(new Date(Date.UTC(2026, 8, 30, 23, 0))), '2026-09-30');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('Order created time.'), null);
});

test('TikTok CSV: description row skipped, multi-SKU order grouped, statuses bucketed, PII not returned', async () => {
  const parsed = await parseMarketplaceFile({ buffer: Buffer.from('﻿' + tiktokCsv()), fileName: 'orders.csv', platform: 'tiktok' });
  assert.deepEqual(parsed.kinds, ['orders']);
  assert.equal(parsed.orders.length, 3);
  const [done, cancelled, pending] = parsed.orders;
  assert.equal(done.status, 'completed');
  assert.equal(done.sales, 635); // 600 + (40 - 5 seller discount)
  assert.equal(done.items.length, 2);
  assert.equal(done.items[0].name, 'สาย LAN "CAT5"');
  assert.equal(done.province, 'ปัตตานี');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(pending.status, 'pending');
  const json = JSON.stringify(parsed);
  for (const secret of PII) assert.ok(!json.includes(secret), 'PII leaked: ' + secret);
});

test('wrong platform, unknown, old .xls and info-only files get clear Thai messages', async () => {
  const lazada = await lazadaFile();
  await assert.rejects(parseMarketplaceFile({ buffer: lazada, fileName: 'a.xlsx', platform: 'shopee' }), /เป็นไฟล์ของ Lazada แต่เลือกแพลตฟอร์ม Shopee/);
  await assert.rejects(parseMarketplaceFile({ buffer: Buffer.from(tiktokCsv()), fileName: 'a.csv', platform: 'lazada' }), /เป็นไฟล์ของ TikTok Shop/);
  await assert.rejects(parseMarketplaceFile({ buffer: Buffer.from('a,b\n1,2'), fileName: 'a.csv', platform: 'shopee' }), /ไม่พบหัวคอลัมน์ของไฟล์ Shopee/);
  await assert.rejects(parseMarketplaceFile({ buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), fileName: 'a.xls', platform: 'shopee' }), /\.xls รุ่นเก่า/);
  await assert.rejects(parseMarketplaceFile({ buffer: Buffer.from('hello'), fileName: 'a.pdf', platform: 'shopee' }), /รองรับเฉพาะไฟล์/);
  const balanceOnly = await xlsx({ b: [['Transaction Number', 'Transaction Time', 'Type', 'Sub Type', 'Amount']] });
  await assert.rejects(parseMarketplaceFile({ buffer: balanceOnly, fileName: 'b.xlsx', platform: 'lazada' }), /เงินเข้า–ออกของ Lazada/);
  const badDate = tiktokCsv().replace('02/09/2026 10:00:00', 'เมื่อวาน');
  await assert.rejects(parseMarketplaceFile({ buffer: Buffer.from(badDate), fileName: 'a.csv', platform: 'tiktok' }), /วันที่สั่งซื้อในไฟล์ไม่ถูกต้อง/);
});

test('Lazada item rows: cancelled items excluded, masked province falls back to billing province', async () => {
  const parsed = await parseMarketplaceFile({ buffer: await lazadaFile(), fileName: 'l.xlsx', platform: 'lazada' });
  const byId = Object.fromEntries(parsed.orders.map(o => [o.orderId, o]));
  assert.equal(byId['7000000000000001'].status, 'completed');
  assert.equal(byId['7000000000000001'].sales, 38);
  assert.equal(byId['7000000000000001'].province, 'ปทุมธานี');
  assert.equal(byId['7000000000000002'].status, 'pending');
  assert.equal(byId['7000000000000003'].status, 'cancelled');
  assert.ok(!JSON.stringify(parsed).includes(PII[3]));
});

test('Shopee income: header below title rows, fees and net payout per order, refund = returned', async () => {
  const parsed = await parseMarketplaceFile({ buffer: await shopeeFile(), fileName: 'income.xlsx', platform: 'shopee' });
  assert.deepEqual(parsed.kinds, ['income']);
  assert.deepEqual(parsed.orders.map(o => [o.orderId, o.status, o.sales]), [['2609020K2WK5B7', 'completed', 60], ['260919ES9NB0VD', 'completed', 150], ['260920RETURN01', 'returned', 80]]);
  assert.deepEqual(parsed.settlements.map(s => [s.fees, s.netPayout]), [[11, 49], [29, 121], [0, 0]]);
});

test('store: re-upload never double counts; summary totals, top products and fee coverage', async () => {
  const store = createAccessStore(':memory:');
  const { saveMarketplaceUpload } = await import('./marketplace.js');
  const user = { id: null, full_name: 'แอดมินทดสอบ' };
  const save = async (platform, buffer, fileName) => saveMarketplaceUpload(store, { platform, fileName, sha256: fileName, user, parsed: await parseMarketplaceFile({ buffer, fileName, platform }) });
  assert.equal((await save('tiktok', Buffer.from(tiktokCsv()), 'tt.csv')).duplicate, false);
  assert.equal((await save('tiktok', Buffer.from(tiktokCsv()), 'tt.csv')).duplicate, true);
  await save('tiktok', await tiktokSettlement(), 'tt-settle.xlsx');
  await save('lazada', await lazadaFile(), 'lz.xlsx');
  await save('shopee', await shopeeFile(), 'sp.xlsx');
  assert.equal(store.get("SELECT COUNT(*) AS n FROM marketplace_orders WHERE platform='tiktok'").n, 3);
  assert.equal(store.get('SELECT COUNT(*) AS n FROM marketplace_uploads').n, 5);
  const all = marketplaceSummary(store, { platform: 'all', start: '2026-09-01', end: '2026-09-30' });
  const by = Object.fromEntries(all.platforms.map(p => [p.platform, p]));
  assert.equal(by.tiktok.sales, 935); // 635 completed + 300 pending; cancelled excluded
  assert.equal(by.tiktok.orders, 2);
  assert.equal(by.tiktok.fees, 79.16);
  assert.equal(by.tiktok.ordersWithFees, 1);
  assert.equal(by.lazada.sales, 138);
  assert.equal(by.lazada.ordersWithFees, 0); // no fee data: shown as "ไม่มีข้อมูล", never as 0
  assert.equal(by.shopee.sales, 210);
  assert.equal(by.shopee.ordersWithItems, 0);
  assert.equal(all.topProducts[0].sku, 'SKU-A');
  assert.equal(all.topProducts[0].quantity, 4); // TikTok 2 + 1 pending + Lazada 1 (cancelled unit excluded)
  assert.deepEqual(all.topProducts[0].platforms.sort(), ['lazada', 'tiktok']);
  const stored = JSON.stringify(store.all('SELECT * FROM marketplace_orders')) + JSON.stringify(store.all('SELECT * FROM marketplace_order_items'));
  for (const secret of PII) assert.ok(!stored.includes(secret));
  const lazadaOnly = marketplaceSummary(store, { platform: 'lazada', start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(lazadaOnly.platforms.map(p => p.platform), ['lazada']);
  store.close();
});

test('HTTP: admin uploads but sees no numbers and cannot open the dashboard; owner sees everything', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const store = createAccessStore(':memory:', env), app = express();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installMarketplace(app, store, auth.audit);
  for (const path of ['/marketplace.html', '/marketplace-upload.html']) app.get(path, (req, res) => res.send('page'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  const create = (username, role) => users.save(root, null, { username, full_name: username + ' ชื่อเต็ม', role, is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  await create('admin1', 'admin');
  await create('exec1', 'executive');
  const login = async username => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const upload = (cookie, platform, body, fileName, headers = {}) => fetch(`${base}/api/marketplace/upload?platform=${platform}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fileName), 'X-PRPlus-Request': '1', ...headers }, body });
  const get = (cookie, path) => fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const admin = await login('admin1'), owner = await login('root'), exec = await login('exec1');
  const summaryPath = '/api/marketplace/summary?platform=all&start=2026-09-01&end=2026-09-30';

  const ok = await upload(admin, 'tiktok', tiktokCsv(), 'คำสั่งซื้อ TikTok.csv');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, message: 'อัปโหลดสำเร็จ', duplicate: false });
  const wrong = await upload(admin, 'shopee', tiktokCsv(), 'x.csv');
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /TikTok Shop/);
  assert.equal((await upload(admin, 'tiktok', tiktokCsv(), 'x.csv', { 'X-PRPlus-Request': '' })).status, 403);
  assert.equal((await upload(exec, 'tiktok', tiktokCsv(), 'x.csv')).status, 403);

  assert.equal((await get(admin, summaryPath)).status, 403);
  assert.equal((await get(admin, '/marketplace.html')).status, 403);
  assert.equal((await get(admin, '/marketplace-upload.html')).status, 200);
  const history = await (await get(admin, '/api/marketplace/uploads')).json();
  assert.deepEqual(Object.keys(history.uploads[0]).sort(), ['createdAt', 'fileName', 'id', 'platform', 'uploadedBy']);
  assert.equal(history.uploads[0].fileName, 'คำสั่งซื้อ TikTok.csv');
  assert.equal(history.uploads[0].uploadedBy, 'admin1 ชื่อเต็ม');

  assert.equal((await get(exec, summaryPath)).status, 403); // not granted by default; owner can tick it per role
  const summary = await get(owner, summaryPath);
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).platforms[0].sales, 935);
  assert.equal((await get(owner, '/api/marketplace/summary?platform=all&start=2026-09-30&end=2026-09-01')).status, 400);
  assert.equal((await get(owner, '/api/marketplace/summary?platform=ebay&start=2026-09-01&end=2026-09-30')).status, 400);
});
