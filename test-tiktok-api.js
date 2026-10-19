// TikTok Shop API: signing, order mapping, connect/callback/sync over HTTP with a fake TikTok (no network).
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
import { installTikTokShop } from './tiktok-shop.js';
import { bangkokDate, bangkokDayStart, mapTikTokOrder, signRequest } from './src/services/tiktokShopApi.js';

const PII = { name: 'ทดสอบ ผู้รับ', phone_number: '(+66)812345678', full_address: '99/1 ถนนทดสอบ' };
const at = (day, hh = 10) => Math.floor(Date.parse(`${day}T${String(hh).padStart(2, '0')}:00:00+07:00`) / 1000);
const line = (sku_id, seller_sku, original_price, seller_discount = '0') => ({ id: sku_id + Math.random(), sku_id, seller_sku, product_name: 'ลำโพง', sku_name: 'สีดำ', original_price, seller_discount, platform_discount: '50' });
const address = province => ({ ...PII, district_info: [{ address_level: 'L0', address_name: 'Thailand' }, { address_level: 'L1', address_name: province }, { address_level: 'L2', address_name: 'เมือง' }] });
const ORDERS = [
  { id: '580000000000000001', status: 'COMPLETED', create_time: at('2026-10-01'), recipient_address: address('ชลบุรี'), buyer_email: 'x@example.com',
    line_items: [line('111', 'SKU-A', '300'), line('111', 'SKU-A', '300'), line('222', 'SKU-B', '40', '5')] },
  { id: '580000000000000002', status: 'CANCELLED', create_time: at('2026-10-01'), recipient_address: address('ระยอง'), line_items: [line('111', 'SKU-A', '300')] },
  { id: '580000000000000003', status: 'IN_TRANSIT', create_time: at('2026-10-02', 23), recipient_address: address('ชลบุรี'), line_items: [line('111', 'SKU-A', '300')] },
  { id: '580000000000000004', status: 'DELIVERED', create_time: at('2026-10-02'), recipient_address: address('ชลบุรี'), line_items: [line('222', 'SKU-B', '40')] },
];
const RETURNS = [
  { order_id: '580000000000000004', return_status: 'RETURN_OR_REFUND_REQUEST_COMPLETE', refund_amount: { refund_total: '40' } },
  { order_id: '580000000000000003', return_status: 'RETURN_OR_REFUND_REQUEST_CANCEL', refund_amount: { refund_total: '300' } },
];

test('signature: secret-wrapped path + sorted params + body, sign/access_token excluded', () => {
  const query = { timestamp: '1700000000', app_key: 'k', shop_cipher: 'c', access_token: 'ignored', sign: 'ignored' };
  const expected = createHmac('sha256', 's').update('s' + '/order/202309/orders/search' + 'app_keyk' + 'shop_cipherc' + 'timestamp1700000000' + '{"a":1}' + 's').digest('hex');
  assert.equal(signRequest('s', '/order/202309/orders/search', query, '{"a":1}'), expected);
});

test('dates: create_time is read as the Bangkok calendar day', () => {
  assert.equal(bangkokDate(at('2026-10-02', 23)), '2026-10-02');
  assert.equal(bangkokDate(Date.parse('2026-10-01T18:30:00Z') / 1000), '2026-10-02'); // 01:30 Bangkok
  assert.equal(bangkokDayStart('2026-10-02'), Date.parse('2026-10-01T17:00:00Z'));
});

test('mapping: units grouped per SKU, seller discount deducted, platform discount not, statuses bucketed, no PII', () => {
  const o = mapTikTokOrder(ORDERS[0]);
  assert.equal(o.sales, 635);
  assert.equal(o.status, 'completed');
  assert.equal(o.province, 'ชลบุรี');
  assert.deepEqual(o.items.map(i => [i.sku, i.quantity, i.sales]), [['SKU-A', 2, 600], ['SKU-B', 1, 35]]);
  assert.equal(mapTikTokOrder(ORDERS[1]).status, 'cancelled');
  assert.equal(mapTikTokOrder(ORDERS[2], [RETURNS[1]]).status, 'pending'); // cancelled return request is ignored
  const returned = mapTikTokOrder(ORDERS[3], [RETURNS[0]]);
  assert.equal(returned.status, 'returned');
  assert.equal(returned.refund, 40);
  const json = JSON.stringify(ORDERS.map(x => mapTikTokOrder(x)));
  for (const value of [...Object.values(PII), 'x@example.com']) assert.ok(!json.includes(value));
  assert.equal(mapTikTokOrder({ id: 'bad id!', line_items: [] }), null);
});

function fakeTikTok() {
  const calls = [];
  let tokenNo = 0;
  const reply = data => new Response(JSON.stringify({ code: 0, message: 'Success', data }), { headers: { 'content-type': 'application/json' } });
  const token = () => { tokenNo++; return reply({ access_token: 'access-' + tokenNo, access_token_expire_in: Math.floor(Date.now() / 1000) + 7 * 86400, refresh_token: 'refresh-' + tokenNo, refresh_token_expire_in: Math.floor(Date.now() / 1000) + 60 * 86400, seller_name: 'Proplus Audio' }); };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers || {}, body });
    if (u.pathname === '/api/v2/token/get') return u.searchParams.get('auth_code') === 'good-code' ? token() : new Response(JSON.stringify({ code: 36004004, message: 'invalid auth code' }));
    if (u.pathname === '/api/v2/token/refresh') return token();
    if (u.searchParams.get('sign') !== signRequest('secret', u.pathname, Object.fromEntries(u.searchParams), init.body || '')) return new Response(JSON.stringify({ code: 106001, message: 'Invalid signature' }));
    if (u.pathname === '/authorization/202309/shops') return reply({ shops: [{ id: '7496225617718250195', name: 'Proplus Audio', cipher: 'ROW_cipher', region: 'TH' }] });
    if (u.pathname === '/order/202309/orders/search') {
      const inRange = ORDERS.filter(o => o.create_time >= body.create_time_ge && o.create_time < body.create_time_lt);
      const page = u.searchParams.get('page_token') === 'p2' ? inRange.slice(2) : inRange.slice(0, 2);
      return reply({ orders: page, next_page_token: u.searchParams.get('page_token') === 'p2' || inRange.length <= 2 ? '' : 'p2', total_count: inRange.length });
    }
    // First Finance call is rate limited once: the client must back off and retry.
    if (u.pathname === '/finance/202309/statements' && !calls.some((c, i) => i < calls.length - 1 && c.path === u.pathname))
      return new Response(JSON.stringify({ code: 36009004, message: 'Too many requests. This API has exceeded its request rate limit.' }));
    if (u.pathname === '/finance/202309/statements') return reply({ statements: [{ id: 'st1', statement_time: at('2026-10-05') }], next_page_token: '' });
    if (u.pathname === '/finance/202309/statements/st1/statement_transactions') return reply({ statement_transactions: [
      { id: 'tx1', type: 'ORDER', order_id: '580000000000000001', fee_amount: '-63.5', settlement_amount: '571.5' },
      { id: 'tx2', type: 'ADJUSTMENT', order_id: '', fee_amount: '-10', settlement_amount: '-10' }], next_page_token: '' });
    if (u.pathname === '/return_refund/202309/returns/search') return reply({ return_orders: RETURNS.filter(r => body.order_ids.includes(r.order_id)) });
    return new Response(JSON.stringify({ code: 404, message: 'unknown' }));
  };
  return { calls, fetchImpl };
}

test('HTTP: Super Admin connects, uploader syncs without seeing figures, re-sync never double counts', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false',
    TIKTOK_APP_KEY: 'appkey', TIKTOK_APP_SECRET: 'secret', TIKTOK_SERVICE_ID: '7696151036102461205' };
  const store = createAccessStore(':memory:', env), app = express(), tiktok = fakeTikTok();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installMarketplace(app, store, auth.audit);
  installTikTokShop(app, store, auth.audit, env, { fetchImpl: tiktok.fetchImpl });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  await users.save(root, null, { username: 'admin1', full_name: 'admin1 ชื่อเต็ม', role: 'admin', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  await users.save(root, null, { username: 'sales1', full_name: 'sales1', role: 'sales', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  const login = async username => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const get = (cookie, path) => fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const post = (cookie, path, body) => fetch(base + path, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify(body) });
  const owner = await login('root'), admin = await login('admin1'), sales = await login('sales1');
  store.run("INSERT INTO marketplace_shops(name,active,created_at) VALUES('Proplus',1,'2026-10-01')");

  assert.equal((await get(admin, '/api/tiktok/connect')).status, 403);
  assert.equal((await get(sales, '/api/tiktok/status')).status, 403);
  assert.equal((await post(admin, '/api/tiktok/sync', { start: '2026-10-01', end: '2026-10-02' })).status, 400); // not connected yet

  const connect = await get(owner, '/api/tiktok/connect');
  assert.equal(connect.status, 303);
  const authorize = new URL(connect.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, 'https://services.tiktokshop.com/open/authorize');
  assert.equal(authorize.searchParams.get('service_id'), '7696151036102461205');
  const state = authorize.searchParams.get('state');
  assert.match((await get(admin, `/api/tiktok/callback?code=good-code&state=${state}`)).status.toString(), /403/); // other user cannot finish it
  const done = await get(owner, `/api/tiktok/callback?code=good-code&state=${state}`);
  assert.equal(done.headers.get('location'), '/tiktok-sales.html?tiktok=connected#tiktok-api');
  assert.equal((await get(owner, `/api/tiktok/callback?code=good-code&state=${state}`)).headers.get('location'), '/tiktok-sales.html?tiktok=expired#tiktok-api'); // single use

  const conn = store.get('SELECT * FROM tiktok_connections');
  assert.equal(conn.shop_cipher, 'ROW_cipher');
  assert.ok(!conn.access_token.includes('access-') && !conn.refresh_token.includes('refresh-')); // sealed, not plain text
  const status = await (await get(admin, '/api/tiktok/status')).json();
  assert.equal(status.connections[0].shop, 'Proplus');
  assert.ok(!JSON.stringify(status).includes('access-'));

  for (let i = 0; i < 2; i++) {
    const sync = await post(admin, '/api/tiktok/sync', { start: '2026-10-01', end: '2026-10-02' });
    assert.equal(sync.status, 200);
    assert.deepEqual(await sync.json(), { ok: true, message: 'ดึงข้อมูลจาก TikTok สำเร็จ' }); // no counts or totals
  }
  const search = tiktok.calls.find(c => c.path === '/order/202309/orders/search');
  assert.equal(search.headers['x-tts-access-token'], 'access-1');
  assert.equal(search.query.shop_cipher, 'ROW_cipher');
  assert.equal(search.body.create_time_ge, bangkokDayStart('2026-10-01') / 1000);
  assert.equal(search.body.create_time_lt, bangkokDayStart('2026-10-03') / 1000);
  assert.ok(tiktok.calls.some(c => c.query.page_token === 'p2'));

  const s = marketplaceSummary(store, { platform: 'tiktok', start: '2026-10-01', end: '2026-10-31' });
  assert.equal(s.platforms[0].sales, 935); // 635 + 300 (pending); cancelled and returned excluded
  assert.equal(s.platforms[0].orders, 2);
  assert.equal(s.platforms[0].allOrders, 4);
  // Finance API: fee as a positive deduction, net payout as settled; the order-less adjustment is skipped.
  assert.deepEqual(store.all("SELECT txn_id,order_id,fees,net_payout FROM marketplace_settlements WHERE platform='tiktok'").map(r => ({ ...r })),
    [{ txn_id: 'tx1', order_id: '580000000000000001', fees: 63.5, net_payout: 571.5 }]);
  assert.equal(tiktok.calls.find(c => c.path === '/finance/202309/statements').query.statement_time_ge, String(bangkokDayStart('2026-10-01') / 1000));
  assert.deepEqual(Object.fromEntries(s.statuses.map(x => [x.status, x.orders])), { cancelled: 1, completed: 1, pending: 1, returned: 1 });
  const history = await (await get(admin, '/api/marketplace/uploads')).json();
  assert.match(history.uploads[0].fileName, /^TikTok API 2026-10-01 ถึง 2026-10-02/);
  assert.equal(history.uploads[0].uploadedBy, 'admin1 ชื่อเต็ม');

  // Access token close to expiry: refreshed before the call and stored sealed.
  store.run('UPDATE tiktok_connections SET access_expires=?', Date.now() + 60000);
  assert.equal((await post(admin, '/api/tiktok/sync', { start: '2026-10-01', end: '2026-10-01' })).status, 200);
  assert.ok(tiktok.calls.some(c => c.path === '/api/v2/token/refresh' && c.query.refresh_token === 'refresh-1'));
  assert.equal(tiktok.calls.filter(c => c.path === '/order/202309/orders/search').at(-1).headers['x-tts-access-token'], 'access-2');

  assert.equal((await post(admin, '/api/tiktok/sync', { start: '2026-01-01', end: '2026-10-01' })).status, 400); // > 92 days
  assert.equal((await post(admin, '/api/tiktok/sync', { start: '2026-10-02', end: '2026-10-01' })).status, 400);
  assert.equal((await fetch(base + '/api/tiktok/connections/7496225617718250195', { method: 'DELETE', headers: { cookie: admin, 'X-PRPlus-Request': '1' } })).status, 403);
  assert.equal((await fetch(base + '/api/tiktok/connections/7496225617718250195', { method: 'DELETE', headers: { cookie: owner, 'X-PRPlus-Request': '1' } })).status, 200);
  assert.equal(marketplaceSummary(store, { platform: 'tiktok', start: '2026-10-01', end: '2026-10-31' }).platforms[0].sales, 935); // data stays
});
