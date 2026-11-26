import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAuth, hashPassword } from '../src/middleware/auth.js';
import { createAccessStore } from '../src/models/accessStore.js';
import { installAccess } from '../src/middleware/access.js';
import { installOnlineOrders } from '../src/routes/online-orders.js';
import { createUserService } from '../src/services/userService.js';
import { loadUser } from '../src/services/permissionService.js';

const SECRET = 'cs_fixture_secret_never_in_responses';
const order = { id: 501, number: '501', status: 'processing', date_created_gmt: '2026-11-18T03:00:00', total: '1290.00', currency: 'THB',
  billing: { first_name: 'สมชาย', last_name: 'ใจดี', phone: '0812345678', email: 'a@example.com', address_1: '1 ถนนสุขุมวิท', city: 'กรุงเทพ', postcode: '10110' },
  shipping: { first_name: 'สมชาย', last_name: 'ใจดี', address_1: '1 ถนนสุขุมวิท', city: 'กรุงเทพ', postcode: '10110', phone: '' },
  payment_method_title: 'โอนผ่านธนาคาร', customer_note: 'ส่ง<b>ด่วน</b>', shipping_lines: [{ method_title: 'Kerry', total: '50' }],
  line_items: [{ name: 'ลำโพง', sku: 'SPK-1', quantity: 2, price: 620, subtotal: '1240', total: '1240', image: { src: 'https://proplusaudio.com/a.jpg' }, meta_data: [{ key: 'สี', value: 'ดำ', display_key: 'สี', display_value: 'ดำ' }, { key: '_hidden', value: 'x' }] }] };

async function fixture(t) {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, auth: init.headers.Authorization, body: init.body });
    const u = new URL(url), path = u.pathname.replace('/wp-json/wc/v3/', '');
    const json = (data, headers = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
    if (path === 'orders') return json([order], { 'x-wp-total': '1', 'x-wp-totalpages': '1' });
    if (path === 'orders/501') return json(init.method === 'PUT' ? { ...order, status: JSON.parse(init.body).status } : order);
    if (path === 'orders/501/notes') return json(init.method === 'POST' ? { id: 9, note: JSON.parse(init.body).note, customer_note: JSON.parse(init.body).customer_note } : [{ id: 1, note: '<p>ok</p>', customer_note: false, date_created_gmt: '2026-11-18T04:00:00' }]);
    return new Response('{"code":"rest_no_route"}', { status: 404 });
  };
  const store = createAccessStore(':memory:', env), app = express();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installOnlineOrders(app, store, auth.audit, { env: { WC_KEY: 'ck_fixture', WC_SECRET: SECRET }, fetchImpl });
  for (const p of ['/online-orders.html', '/order-permissions.html']) app.get(p, (_req, res) => res.send('page'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const request = (path, cookie = '', method = 'GET', body) => fetch(base + path, { redirect: 'manual', method, headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async username => { const r = await request('/api/auth/login', '', 'POST', { username, password: 'fixture-password-123' }); return r.headers.get('set-cookie')?.split(';')[0] || ''; };
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  const create = (username, role) => users.save(root, null, { username, full_name: username, role, is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  return { request, login, create, calls };
}

test('order menu: 403 without permission, admin can view/update, Super Admin grants view-only per user and it is logged', async t => {
  const f = await fixture(t);
  const sales = await f.create('sale1', 'sales'), exec = await f.create('exec1', 'executive');
  await f.create('admin1', 'admin');
  const [root, admin, saleC, execC] = [await f.login('root'), await f.login('admin1'), await f.login('sale1'), await f.login('exec1')];

  // No permission: every page/API is 403 even when typed directly.
  for (const cookie of [saleC, execC]) {
    for (const p of ['/online-orders.html', '/api/online-orders', '/api/online-orders/summary', '/api/online-orders/501', '/api/online-orders/sales?start=2026-11-01&end=2026-11-20', '/order-permissions.html', '/api/admin/order-permissions'])
      assert.equal((await f.request(p, cookie)).status, 403, p);
    assert.equal((await f.request('/api/online-orders/501/status', cookie, 'PUT', { status: 'completed' })).status, 403);
  }
  // Admin role: view + update, but cannot manage permissions.
  const list = await f.request('/api/online-orders', admin);
  assert.equal(list.status, 200);
  const listText = await list.text();
  assert.ok(!listText.includes(SECRET) && !listText.includes('ck_fixture'));
  assert.equal(JSON.parse(listText).orders[0].customer, 'สมชาย ใจดี');
  assert.equal((await f.request('/api/online-orders/501/status', admin, 'PUT', { status: 'completed' })).status, 200);
  assert.equal((await f.request('/api/online-orders/501/status', admin, 'PUT', { status: 'bogus' })).status, 400);
  assert.equal((await f.request('/order-permissions.html', admin)).status, 403);
  assert.equal((await f.request('/api/admin/order-permissions/' + sales.id, admin, 'PUT', { level: 'update' })).status, 403);
  assert.ok(f.calls.every(c => c.auth === 'Basic ' + Buffer.from('ck_fixture:' + SECRET).toString('base64') && c.url.startsWith('https://proplusaudio.com/wp-json/wc/v3/')));

  // Detail: plain-text customer note, hidden meta dropped, notes stripped of HTML.
  const detail = await (await f.request('/api/online-orders/501', admin)).json();
  assert.equal(detail.order.customerNote, 'ส่งด่วน');
  assert.deepEqual(detail.order.items[0].options, [{ name: 'สี', value: 'ดำ' }]);
  assert.equal(detail.notes[0].note, 'ok');
  const note = await f.request('/api/online-orders/501/notes', admin, 'POST', { kind: 'tracking', carrier: 'Kerry Express', tracking: 'TH123' });
  assert.equal(note.status, 201);
  assert.equal(JSON.parse(f.calls.at(-1).body).customer_note, true);
  await f.request('/api/online-orders/501/notes', admin, 'POST', { kind: 'serial', text: 'SN-1' });
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { note: 'Serial number: SN-1', customer_note: false });

  // Super Admin grants sales "view only": list works, updates stay 403.
  assert.equal((await f.request('/order-permissions.html', root)).status, 200);
  const granted = await f.request('/api/admin/order-permissions/' + sales.id, root, 'PUT', { level: 'view' });
  assert.equal(granted.status, 200);
  const g = await granted.json();
  assert.equal(g.user.effective, 'view');
  assert.equal(g.log[0].actor, 'root'); assert.equal(g.log[0].target, 'sale1'); assert.equal(g.log[0].to, 'view');
  assert.equal((await f.request('/api/online-orders', saleC)).status, 200);
  assert.equal((await f.request('/api/online-orders/501/status', saleC, 'PUT', { status: 'completed' })).status, 403);
  assert.equal((await f.request('/api/online-orders/501/notes', saleC, 'POST', { kind: 'internal', text: 'x' })).status, 403);
  // Upgrade to update, then revoke.
  await f.request('/api/admin/order-permissions/' + sales.id, root, 'PUT', { level: 'update' });
  assert.equal((await f.request('/api/online-orders/501/status', saleC, 'PUT', { status: 'processing' })).status, 200);
  await f.request('/api/admin/order-permissions/' + sales.id, root, 'PUT', { level: 'none' });
  assert.equal((await f.request('/api/online-orders', saleC)).status, 403);
  // Super Admin's own row cannot be changed; executive (no role grant) untouched.
  assert.equal((await f.request('/api/admin/order-permissions/1', root, 'PUT', { level: 'none' })).status, 400);
  const all = await (await f.request('/api/admin/order-permissions', root)).json();
  assert.equal(all.users.find(u => u.id === exec.id).effective, 'none');
  assert.equal(all.users.find(u => u.username === 'admin1').roleLevel, 'update');
  assert.equal(all.log.length, 3);
});

test('missing WooCommerce keys answer a Thai 503 instead of calling the site', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const store = createAccessStore(':memory:', env), app = express(); app.use(express.json());
  const auth = installAuth(app, env, store); installAccess(app);
  let called = false;
  installOnlineOrders(app, store, auth.audit, { env: {}, fetchImpl: async () => { called = true; } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username: 'root', password: 'fixture-password-123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await fetch(base + '/api/online-orders', { headers: { cookie } });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /WC_KEY/);
  assert.equal(called, false);
});

test('รายงานบัญชี (website): marketplace_accounting required; workbook has the same sheet layout', async t => {
  const { default: ExcelJS } = await import('exceljs');
  const { wooAccountingData } = await import('../src/services/wooAccounting.js');
  const f = await fixture(t);
  await f.create('admin2', 'admin');
  const [root, admin] = [await f.login('root'), await f.login('admin2')];
  const q = '/api/online-orders/accounting-report?start=2026-11-01&end=2026-11-20';
  assert.equal((await f.request(q, admin)).status, 403); // admin sees orders but has no accounting permission
  assert.equal((await f.request('/api/online-orders/accounting-report?start=2026-11-20&end=2026-11-01', root)).status, 400);
  const r = await f.request(q, root);
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map(s => s.name).sort(), ['ขายรายสินค้า', 'ชำระเงินในช่วงนี้', 'ทะเบียนขายรายออเดอร์', 'ยังไม่ชำระเงิน', 'รายการที่ต้องตรวจ', 'สรุป', 'หมายเหตุ'].sort());
  const reg = wb.getWorksheet('ทะเบียนขายรายออเดอร์');
  assert.equal(reg.getRow(2).getCell(reg.getRow(1).values.indexOf('เลขออเดอร์')).value, '501');
  const d = wooAccountingData([
    { id: 1, number: '1', status: 'completed', date_created_gmt: '2026-11-01T20:00:00', line_items: [{ sku: 'A', name: 'A', quantity: 2, total: '200' }], shipping_total: '50', total: '250', refunds: [] },
    { id: 2, number: '2', status: 'cancelled', date_created_gmt: '2026-11-02T01:00:00', line_items: [{ sku: 'A', name: 'A', quantity: 1, total: '100' }], total: '100', refunds: [] },
    { id: 3, number: '3', status: 'processing', date_created_gmt: '2026-11-02T01:00:00', line_items: [{ sku: '', name: 'B', quantity: 1, total: '80' }], total: '80', refunds: [{ total: '-30' }] },
  ], { now: Date.parse('2026-11-20T00:00:00Z') });
  assert.equal(d.rows[0].date, '2026-11-02'); // 20:00Z = next day in Bangkok
  assert.deepEqual([d.summary[0].sales, d.summary[0].orders, d.summary[0].cancelled, d.summary[0].refund], [280, 2, 1, 30]);
  assert.equal(d.productRows.find(p => p.sku === 'A').quantity, 2); // cancelled order not counted
  assert.match(d.review.find(x => x.orderId === '3').reasons, /ไม่มี SKU/);
});

test('ตรวจการชำระเงิน: verify queue, slip links, confirm only for pending/on-hold, update permission required', async t => {
  const { findSlips } = await import('../src/routes/online-orders.js');
  const f = await fixture(t);
  const viewer = await f.create('viewer1', 'sales');
  const root = await f.login('root');
  // fixture 501 = processing + bank transfer, not yet confirmed -> sits in ตรวจชำระ, not in รอจัดส่ง
  const v = await (await f.request('/api/online-orders?status=verify', root)).json();
  assert.equal(new URL(f.calls.at(-1).url).searchParams.get('status'), 'on-hold,pending');
  assert.deepEqual(v.orders.map(o => o.id), [501]);
  assert.equal((await (await f.request('/api/online-orders?status=processing', root)).json()).total, 0);
  const { needsVerify, VERIFIED_KEY } = await import('../src/routes/online-orders.js');
  assert.equal(needsVerify({ ...order, meta_data: [{ key: VERIFIED_KEY, value: 'root' }] }), false);
  assert.equal(needsVerify({ ...order, payment_method: 'cod', payment_method_title: 'เก็บเงินปลายทาง' }), false);
  await f.request('/api/online-orders?status=closed', root);
  assert.equal(new URL(f.calls.at(-1).url).searchParams.get('status'), 'cancelled,refunded,failed');
  const ok = await f.request('/api/online-orders/501/payment', root, 'POST', { action: 'confirm' });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(f.calls.find(x => x.method === 'PUT').body).meta_data[0].key, VERIFIED_KEY);
  assert.equal((await f.request('/api/online-orders/501/payment', root, 'POST', { action: 'bogus' })).status, 400);
  await f.request('/api/admin/order-permissions/' + viewer.id, root, 'PUT', { level: 'view' });
  assert.equal((await f.request('/api/online-orders/501/payment', await f.login('viewer1'), 'POST', { action: 'confirm' })).status, 403);
  assert.deepEqual(findSlips({ meta_data: [{ key: '_payment_slip', value: 'https://proplusaudio.com/wp-content/uploads/slip-1.jpg' }, { key: 'color', value: 'https://x.com/a.jpg' }, { key: '_slip', value: 'http://insecure/a.png' }] },
    [{ note: 'แนบสลิป <a href="https://proplusaudio.com/u/s2.png">ดู</a>' }]),
  ['https://proplusaudio.com/wp-content/uploads/slip-1.jpg', 'https://proplusaudio.com/u/s2.png']);
});
