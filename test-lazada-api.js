// Lazada Open Platform: signing, order mapping, connect/callback/sync over HTTP with a fake Lazada (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import { installAuth, hashPassword } from './auth.js';
import { createAccessStore } from './src/models/accessStore.js';
import { installAccess } from './src/middleware/access.js';
import { createUserService } from './src/services/userService.js';
import { loadUser } from './src/services/permissionService.js';
import { installMarketplace, marketplaceSummary } from './marketplace.js';
import { installLazadaShop } from './lazada-shop.js';
import { lazadaDate, mapLazadaOrder, mapLazadaTransaction, parseLazadaJson, signRequest } from './src/services/lazadaApi.js';

const PII = { first_name: 'ทดสอบ', last_name: 'ผู้รับ', phone: '0812345678', address1: '99/1 ถนนทดสอบ' };
const ship = province => ({ ...PII, address3: province, address4: 'เมือง', country: 'Thailand' });
const ORDERS = [
  { order_id: 1001001001, order_number: 1001001001, created_at: '2026-10-01 10:00:00 +0700', statuses: ['delivered'], address_shipping: ship('ชลบุรี'), customer_first_name: 'ทดสอบ' },
  { order_id: 1001001002, order_number: 1001001002, created_at: '2026-10-01 11:00:00 +0700', statuses: ['canceled'], address_shipping: ship('ระยอง') },
  { order_id: 1001001003, order_number: 1001001003, created_at: '2026-10-02 23:30:00 +0700', statuses: ['shipped', 'canceled'], address_shipping: ship('ชลบุรี/Chonburi') },
  { order_id: 1001001004, order_number: 1001001004, created_at: '2026-10-02 09:00:00 +0700', statuses: ['returned'], address_shipping: ship('*****') },
];
const item = (order_item_id, sku, item_price, voucher_seller, status) => ({ order_item_id, sku, shop_sku: 'LZ-' + sku, name: 'ลำโพง', variation: 'สีดำ', item_price, voucher_seller, voucher_platform: 50, status });
const ITEMS = {
  1001001001: [item(1, 'SKU-A', 300, 0, 'delivered'), item(2, 'SKU-A', 300, 0, 'delivered'), item(3, 'SKU-B', 40, 5, 'delivered')],
  1001001002: [item(4, 'SKU-A', 300, 0, 'canceled')],
  1001001003: [item(5, 'SKU-A', 300, 0, 'shipped'), item(6, 'SKU-B', 40, 0, 'canceled')],
  1001001004: [item(7, 'SKU-B', 40, 0, 'returned')],
};

test('signature: path + sorted key/value, sign excluded, upper-case hex', () => {
  const params = { timestamp: '1700000000000', app_key: 'k', sign_method: 'sha256', access_token: 't', sign: 'ignored' };
  const expected = createHmac('sha256', 's').update('/orders/get' + 'access_tokent' + 'app_keyk' + 'sign_methodsha256' + 'timestamp1700000000000').digest('hex').toUpperCase();
  assert.equal(signRequest('s', '/orders/get', params), expected);
});

test('ids beyond 2^53 survive JSON parsing; created_at is read as the Bangkok day', () => {
  assert.equal(parseLazadaJson('{"data":{"order_id":12345678901234567,"x":1}}').data.order_id, '12345678901234567');
  assert.equal(lazadaDate('2026-10-02 23:30:00 +0700'), '2026-10-02');
  assert.equal(lazadaDate('2026-10-01 18:30:00 +0000'), '2026-10-02'); // 01:30 Bangkok
  assert.equal(lazadaDate('bad'), null);
});

test('mapping: units grouped per order, seller voucher deducted, platform voucher not, cancelled items not counted, no PII', () => {
  const o = mapLazadaOrder(ORDERS[0], ITEMS[1001001001]);
  assert.equal(o.sales, 635);
  assert.equal(o.status, 'completed');
  assert.equal(o.province, 'ชลบุรี');
  assert.deepEqual(o.items.map(i => [i.sku, i.quantity, i.sales]), [['SKU-A', 1, 300], ['SKU-A', 1, 300], ['SKU-B', 1, 35]]);
  assert.equal(mapLazadaOrder(ORDERS[1], ITEMS[1001001002]).status, 'cancelled');
  const partial = mapLazadaOrder(ORDERS[2], ITEMS[1001001003]);
  assert.deepEqual([partial.status, partial.sales, partial.province], ['pending', 300, 'ชลบุรี']);
  const returned = mapLazadaOrder(ORDERS[3], ITEMS[1001001004]);
  assert.deepEqual([returned.status, returned.province], ['returned', null]);
  const json = JSON.stringify(ORDERS.map(x => mapLazadaOrder(x, ITEMS[x.order_id])));
  for (const value of Object.values(PII)) assert.ok(!json.includes(value));
  assert.equal(mapLazadaOrder({ order_number: 'bad id!', created_at: '2026-10-01 10:00:00 +0700' }), null);
});

test('finance lines: per order, net = Σ amount and fees = product lines − net (same as the statement file)', () => {
  const rows = [
    // Real API shape: every line of one item shares transaction_number and orderItem_no; fee_type tells them apart.
    { order_no: '1001001001', transaction_number: 'i1', orderItem_no: 'i1', fee_type: '3', fee_name: 'Item Price Credit', transaction_date: '19 Oct 2026', amount: '635.00' },
    { order_no: '1001001001', transaction_number: 'i1', orderItem_no: 'i1', fee_type: '16', fee_name: 'Commission', transaction_date: '19 Oct 2026', amount: '-40.50' },
    { order_no: '1001001001', transaction_number: 'i1', orderItem_no: 'i1', fee_type: '17', fee_name: 'Payment Fee', transaction_date: '19 Oct 2026', amount: '-20' },
    { order_no: '', transaction_number: 't4', fee_name: 'Adjustment', amount: '-10' },
  ].map(mapLazadaTransaction).filter(Boolean);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(r => r.txnId)).size, 3); // distinct keys, so saving never overwrites a line
  const sum = key => Math.round(rows.reduce((s, r) => s + r[key], 0) * 100) / 100;
  assert.equal(sum('netPayout'), 574.5);
  assert.equal(sum('fees'), 60.5);
});

function fakeLazada() {
  const calls = [];
  let tokenNo = 0;
  const raw = body => new Response(body, { headers: { 'content-type': 'application/json' } });
  const reply = data => raw(JSON.stringify({ code: '0', data, request_id: 'r' }));
  const token = () => { tokenNo++; return raw(JSON.stringify({ code: '0', access_token: 'access-' + tokenNo, expires_in: 7 * 86400, refresh_token: 'refresh-' + tokenNo, refresh_expires_in: 30 * 86400,
    account: 'owner@example.com', country_user_info: [{ country: 'th', seller_id: '100200300', user_id: '9', short_code: 'THABC123' }] })); };
  let financeCalls = 0;
  const fetchImpl = async url => {
    const u = new URL(url), q = Object.fromEntries(u.searchParams), path = u.pathname.replace(/^\/rest/, '');
    calls.push({ host: u.host, path, query: q });
    if (q.sign !== signRequest('secret', path, q)) return raw(JSON.stringify({ code: 'IncompleteSignature', message: 'The request signature does not conform to platform standards' }));
    if (path === '/auth/token/create') return q.code === 'good-code' ? token() : raw(JSON.stringify({ code: 'InvalidCode', message: 'invalid code' }));
    if (path === '/auth/token/refresh') return token();
    if (path === '/seller/get') return reply({ seller_id: 100200300, name: 'Proplus Audio Lazada', short_code: 'THABC123', email: 'owner@example.com' });
    if (path === '/orders/get') {
      const from = Date.parse(q.created_after), to = Date.parse(q.created_before);
      const inRange = ORDERS.filter(o => { const t = Date.parse(o.created_at.replace(' ', 'T').replace(' +0700', '+07:00')); return t >= from && t <= to; });
      return reply({ count: inRange.length, countTotal: inRange.length, orders: q.offset === '0' ? inRange : [] });
    }
    if (path === '/orders/items/get') {
      const ids = JSON.parse(q.order_ids);
      // Big order ids come back as bare JSON numbers.
      return raw('{"code":"0","data":[' + ids.map(id => `{"order_id":${id},"order_items":${JSON.stringify(ITEMS[id] || [])}}`).join(',') + ']}');
    }
    if (path === '/finance/transaction/details/get') {
      if (++financeCalls === 1) return raw(JSON.stringify({ code: 'ApiCallLimit', message: 'The request has exceeded the limit' })); // retried
      return reply([
        { order_no: 1001001001, transaction_number: 1001, orderItem_no: 1001, fee_type: 3, fee_name: 'Item Price Credit', transaction_date: '05 Oct 2026', amount: '635.00' },
        { order_no: 1001001001, transaction_number: 1001, orderItem_no: 1001, fee_type: 16, fee_name: 'Commission', transaction_date: '05 Oct 2026', amount: '-63.50' },
        { order_no: '', transaction_number: 't9', fee_name: 'Adjustment', amount: '-10' }]);
    }
    return raw(JSON.stringify({ code: 'InvalidApi', message: 'unknown' }));
  };
  return { calls, fetchImpl };
}

test('HTTP: Super Admin connects, uploader syncs without seeing figures, re-sync never double counts', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false',
    LAZADA_APP_KEY: 'appkey', LAZADA_APP_SECRET: 'secret', LAZADA_REDIRECT_URI: 'https://dashboard.example/api/lazada/callback' };
  const store = createAccessStore(':memory:', env), app = express(), lazada = fakeLazada();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installMarketplace(app, store, auth.audit);
  installLazadaShop(app, store, auth.audit, env, { fetchImpl: lazada.fetchImpl });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  await users.save(root, null, { username: 'admin1', full_name: 'admin1 ชื่อเต็ม', role: 'admin', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: ['lazada_sync'] }, 'test');
  await users.save(root, null, { username: 'admin2', full_name: 'admin2', role: 'admin', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  const login = async username => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const get = (cookie, path) => fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const post = (cookie, path, body) => fetch(base + path, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify(body) });
  const owner = await login('root'), admin = await login('admin1'), plainAdmin = await login('admin2');
  assert.equal((await get(plainAdmin, '/api/lazada/status')).status, 403);
  assert.equal((await post(plainAdmin, '/api/lazada/sync', { start: '2026-10-01', end: '2026-10-02' })).status, 403);
  assert.equal((await get(admin, '/api/lazada/connect')).status, 403);
  assert.equal((await post(admin, '/api/lazada/sync', { start: '2026-10-01', end: '2026-10-02' })).status, 400); // not connected yet

  // No dashboard shop yet: connecting creates "Lazada".
  const connect = await get(owner, '/api/lazada/connect');
  assert.equal(connect.status, 303);
  const authorize = new URL(connect.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, 'https://api.lazada.co.th/oauth/authorize');
  assert.equal(authorize.searchParams.get('client_id'), 'appkey');
  assert.equal(authorize.searchParams.get('redirect_uri'), env.LAZADA_REDIRECT_URI);
  const state = authorize.searchParams.get('state');
  assert.equal((await get(admin, `/api/lazada/callback?code=good-code&state=${state}`)).status, 403);
  assert.equal((await get(owner, `/api/lazada/callback?code=good-code&state=${state}`)).headers.get('location'), '/marketplace.html?lazada=connected#lazada');
  assert.equal((await get(owner, `/api/lazada/callback?code=good-code&state=${state}`)).headers.get('location'), '/marketplace.html?lazada=expired#lazada'); // single use

  const conn = store.get('SELECT * FROM lazada_connections');
  assert.deepEqual([conn.seller_id, conn.short_code, conn.shop_name], ['100200300', 'THABC123', 'Proplus Audio Lazada']);
  assert.ok(!conn.access_token.includes('access-') && !conn.refresh_token.includes('refresh-')); // sealed
  const status = await (await get(admin, '/api/lazada/status')).json();
  assert.equal(status.connections[0].shop, 'Lazada');
  assert.ok(!JSON.stringify(status).includes('access-') && !JSON.stringify(status).includes('owner@example.com'));

  for (let i = 0; i < 2; i++) {
    const sync = await post(admin, '/api/lazada/sync', { start: '2026-10-01', end: '2026-10-02' });
    assert.equal(sync.status, 200);
    assert.deepEqual(await sync.json(), { ok: true, message: 'ดึงข้อมูลจาก Lazada สำเร็จ' }); // no counts or totals
  }
  const search = lazada.calls.find(c => c.path === '/orders/get');
  assert.equal(search.host, 'api.lazada.co.th');
  assert.equal(search.query.access_token, 'access-1');
  assert.equal(search.query.created_after, '2026-10-01T00:00:00+07:00');
  assert.equal(search.query.created_before, '2026-10-02T23:59:59+07:00');

  const s = marketplaceSummary(store, { platform: 'lazada', start: '2026-10-01', end: '2026-10-31' });
  assert.equal(s.platforms[0].sales, 935); // 635 + 300 (pending, cancelled item excluded); cancelled and returned orders excluded
  assert.equal(s.platforms[0].orders, 2);
  assert.equal(s.platforms[0].allOrders, 4);
  assert.deepEqual(Object.fromEntries(s.statuses.map(x => [x.status, x.orders])), { cancelled: 1, completed: 1, pending: 1, returned: 1 });
  const fees = store.get("SELECT SUM(fees) AS fees,SUM(net_payout) AS net FROM marketplace_settlements WHERE platform='lazada' AND order_id='1001001001'");
  assert.deepEqual({ ...fees }, { fees: 63.5, net: 571.5 });
  assert.equal(store.get("SELECT COUNT(*) AS n FROM marketplace_settlements WHERE platform='lazada'").n, 2); // order-less line skipped
  assert.equal(store.get("SELECT shop_id FROM marketplace_shop_codes WHERE platform='lazada' AND code='THABC123'").shop_id, conn.shop_id);
  const history = await (await get(admin, '/api/marketplace/uploads')).json();
  assert.match(history.uploads[0].fileName, /^Lazada API 2026-10-01 ถึง 2026-10-02/);

  // Access token close to expiry: refreshed before the call.
  store.run('UPDATE lazada_connections SET access_expires=?', Date.now() + 60000);
  assert.equal((await post(admin, '/api/lazada/sync', { start: '2026-10-01', end: '2026-10-01' })).status, 200);
  assert.ok(lazada.calls.some(c => c.path === '/auth/token/refresh' && c.query.refresh_token === 'refresh-1'));
  assert.equal(lazada.calls.filter(c => c.path === '/orders/get').at(-1).query.access_token, 'access-2');

  assert.equal((await post(admin, '/api/lazada/sync', { start: '2026-01-01', end: '2026-10-01' })).status, 400); // > 92 days
  assert.equal((await fetch(base + '/api/lazada/connections/100200300', { method: 'DELETE', headers: { cookie: admin, 'X-PRPlus-Request': '1' } })).status, 403);
  assert.equal((await fetch(base + '/api/lazada/connections/100200300', { method: 'DELETE', headers: { cookie: owner, 'X-PRPlus-Request': '1' } })).status, 200);
  assert.equal(marketplaceSummary(store, { platform: 'lazada', start: '2026-10-01', end: '2026-10-31' }).platforms[0].sales, 935); // data stays
});
