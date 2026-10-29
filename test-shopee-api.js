// Shopee Open Platform v2: signing, order/item mapping, retention, connect/callback/sync over HTTP with a fake Shopee (no network).
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
import { installShopeeShop, purgeShopeeBuyerData } from './shopee-shop.js';
import { HOSTS, createShopeeClient, mapShopeeEscrow, mapShopeeItem, mapShopeeOrder, redactUrl, shopeeEnv, shopeeOrderStatus, signShopee } from './src/services/shopeeApi.js';

const PII = { name: 'ท***บ', phone: '******78', full_address: '99/1 ถนนทดสอบ' };
const ts = iso => Date.parse(iso) / 1000;
const line = (item_id, model_id, sku, price, qty) => ({ item_id, model_id, item_name: 'ลำโพง', model_name: 'สีดำ', item_sku: 'P-' + sku, model_sku: sku,
  model_original_price: price + 50, model_discounted_price: price, model_quantity_purchased: qty });
const ORDERS = [
  { order_sn: '261001AAA0001', order_status: 'COMPLETED', create_time: ts('2026-10-01T10:00:00+07:00'), buyer_username: 'buyer1', item_list: [line(1, 11, 'SKU-A', 300, 2), line(2, 0, 'SKU-B', 35, 1)], recipient_address: { ...PII, state: 'ชลบุรี', zipcode: '20000' } },
  { order_sn: '261001AAA0002', order_status: 'CANCELLED', create_time: ts('2026-10-01T11:00:00+07:00'), item_list: [line(1, 11, 'SKU-A', 300, 1)], recipient_address: { ...PII, state: 'ร**ง', zipcode: '*****' } },
  { order_sn: '261002AAA0003', order_status: 'SHIPPED', create_time: ts('2026-10-02T23:30:00+07:00'), item_list: [line(1, 11, 'SKU-A', 300, 1)], recipient_address: { ...PII, state: 'ช***i', zipcode: '20000' } },
  { order_sn: '261002AAA0004', order_status: 'TO_RETURN', create_time: ts('2026-10-02T09:00:00+07:00'), item_list: [line(2, 0, 'SKU-B', 40, 1)], recipient_address: { ...PII, state: '****', zipcode: '****' } },
];

test('signature: public = partner_id+path+timestamp, shop = + access_token + shop_id, lower-case hex HMAC-SHA256', () => {
  const pub = signShopee('key', { partnerId: 1250244, path: '/api/v2/shop/auth_partner', timestamp: 1700000000 });
  assert.equal(pub, createHmac('sha256', 'key').update('1250244/api/v2/shop/auth_partner1700000000').digest('hex'));
  assert.match(pub, /^[0-9a-f]{64}$/);
  const shop = signShopee('key', { partnerId: 1250244, path: '/api/v2/order/get_order_list', timestamp: 1700000000, accessToken: 'tok', shopId: '555' });
  assert.equal(shop, createHmac('sha256', 'key').update('1250244/api/v2/order/get_order_list1700000000tok555').digest('hex'));
  assert.notEqual(pub, signShopee('other', { partnerId: 1250244, path: '/api/v2/shop/auth_partner', timestamp: 1700000000 }));
  assert.notEqual(shop, signShopee('key', { partnerId: 1250244, path: '/api/v2/order/get_order_list', timestamp: 1700000001, accessToken: 'tok', shopId: '555' }));
});

test('environment picks the host; secrets are redacted from URLs', () => {
  assert.equal(shopeeEnv(undefined), 'sandbox');
  assert.equal(shopeeEnv(' LIVE '), 'live');
  assert.equal(shopeeEnv('production'), 'sandbox'); // only the exact word "live" goes live
  assert.equal(createShopeeClient({ partnerId: 1, partnerKey: 'k', env: 'live' }).authorizeUrl('https://x/cb').startsWith(HOSTS.live + '/api/v2/shop/auth_partner?'), true);
  assert.equal(redactUrl('https://h/p?partner_id=1&sign=abc&access_token=tok&shop_id=5'), 'https://h/p?partner_id=1&sign=***&access_token=***&shop_id=5');
});

test('mapping: sales = discounted price × qty, statuses like the export, province only when not masked, no PII', () => {
  const o = mapShopeeOrder(ORDERS[0]);
  assert.deepEqual([o.orderId, o.orderDate, o.status, o.sales, o.province], ['261001AAA0001', '2026-10-01', 'completed', 635, 'ชลบุรี']);
  assert.deepEqual(o.items.map(i => [i.sku, i.quantity, i.sales]), [['SKU-A', 2, 600], ['SKU-B', 1, 35]]);
  assert.deepEqual([mapShopeeOrder(ORDERS[1]).status, mapShopeeOrder(ORDERS[1]).province], ['cancelled', null]);
  assert.deepEqual([mapShopeeOrder(ORDERS[2]).status, mapShopeeOrder(ORDERS[2]).province, mapShopeeOrder(ORDERS[2]).orderDate], ['pending', 'ชลบุรี', '2026-10-02']);
  assert.deepEqual([mapShopeeOrder(ORDERS[3]).status, mapShopeeOrder(ORDERS[3]).province], ['returned', null]);
  assert.equal(shopeeOrderStatus('IN_CANCEL'), 'pending');
  const json = JSON.stringify(ORDERS.map(mapShopeeOrder));
  for (const value of [...Object.values(PII), 'buyer1']) assert.ok(!json.includes(value));
  assert.equal(mapShopeeOrder({ order_sn: 'bad id!', create_time: 1 }), null);
  assert.equal(mapShopeeEscrow({ order_sn: '261001AAA0001', order_income: { escrow_amount: 10 } }), null); // no fee fields: blank, not 0
});

test('items: one row per model, missing stock is null (not 0)', () => {
  const rows = mapShopeeItem({ item_id: 9, item_sku: 'P1', item_name: 'ไมค์', item_status: 'NORMAL', has_model: true, models: [
    { model_id: 91, model_sku: 'P1-R', model_name: 'แดง', price_info: [{ current_price: 199 }], stock_info_v2: { summary_info: { total_available_stock: 0 } } },
    { model_id: 92, model_sku: 'P1-B', model_name: 'ดำ', price_info: [{ current_price: 199 }] }] });
  assert.deepEqual(rows.map(r => [r.modelId, r.price, r.stock]), [['91', 199, 0], ['92', 199, null]]);
  assert.deepEqual(mapShopeeItem({ item_id: 8, item_name: 'สาย', has_model: false, price_info: [{ current_price: 50 }], stock_info_v2: { summary_info: { total_available_stock: 7 } } })
    .map(r => [r.modelId, r.price, r.stock]), [['0', 50, 7]]);
});

function fakeShopee() {
  const calls = [];
  let tokenNo = 0, rateLimited = false, expireOnce = false;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ok = response => json({ error: '', message: '', request_id: 'r', response });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), q = Object.fromEntries(u.searchParams), path = u.pathname, body = init.body ? JSON.parse(init.body) : {};
    calls.push({ host: u.host, path, query: q, body, method: init.method });
    const shopLevel = !!q.access_token;
    if (q.sign !== signShopee('partner-secret', { partnerId: q.partner_id, path, timestamp: q.timestamp, accessToken: q.access_token || '', shopId: q.shop_id || '' }))
      return json({ error: 'error_sign', message: 'Wrong sign.' }, 403);
    if (path === '/api/v2/auth/token/get') return body.code === 'good-code' && body.shop_id === 555
      ? json({ error: '', access_token: 'access-' + ++tokenNo, refresh_token: 'refresh-' + tokenNo, expire_in: 14400 }) : json({ error: 'error_param', message: 'invalid code' }, 400);
    if (path === '/api/v2/auth/access_token/get') return json({ error: '', access_token: 'access-' + ++tokenNo, refresh_token: 'refresh-' + tokenNo, expire_in: 14400, shop_id: 555 });
    if (!shopLevel) return json({ error: 'error_param' }, 400);
    if (expireOnce) { expireOnce = false; return json({ error: 'invalid_acceess_token', message: 'Invalid access_token.' }, 403); }
    if (path === '/api/v2/shop/get_shop_info') return json({ error: '', shop_name: 'SK Sales Shopee', region: 'TH', status: 'NORMAL' });
    if (path === '/api/v2/order/get_order_list') {
      if (!rateLimited) { rateLimited = true; return json({ error: 'error_too_many_request', message: 'Too many requests' }, 429); } // retried
      const inRange = ORDERS.filter(o => o.create_time >= Number(q.time_from) && o.create_time <= Number(q.time_to));
      const page = q.cursor ? inRange.slice(2) : inRange.slice(0, 2);
      return ok({ more: !q.cursor && inRange.length > 2, next_cursor: q.cursor ? '' : 'c2', order_list: page.map(o => ({ order_sn: o.order_sn })) });
    }
    if (path === '/api/v2/order/get_order_detail') return ok({ order_list: ORDERS.filter(o => q.order_sn_list.split(',').includes(o.order_sn)) });
    if (path === '/api/v2/payment/get_escrow_detail') return ok({ order_sn: q.order_sn, order_income: { escrow_amount: 560.5, commission_fee: 40, service_fee: 30, seller_transaction_fee: 4.5 } });
    if (path === '/api/v2/product/get_item_list') return ok({ item: [{ item_id: 9, item_status: 'NORMAL' }], has_next_page: false, total_count: 1 });
    if (path === '/api/v2/product/get_item_base_info') return ok({ item_list: [{ item_id: 9, item_sku: 'P1', item_name: 'ไมค์', item_status: 'NORMAL', has_model: true }] });
    if (path === '/api/v2/product/get_model_list') return ok({ model: [{ model_id: 91, model_sku: 'P1-R', model_name: 'แดง', price_info: [{ current_price: 199 }], stock_info_v2: { summary_info: { total_available_stock: 4 } } }] });
    return json({ error: 'error_not_found' }, 404);
  };
  return { calls, fetchImpl, expire: () => { expireOnce = true; } };
}

test('HTTP: Super Admin connects, permitted user syncs without figures, token refresh, no double counting', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false',
    SHOPEE_PARTNER_ID: '1250244', SHOPEE_PARTNER_KEY: 'partner-secret', SHOPEE_ENV: 'sandbox', SHOPEE_REDIRECT_URL: 'https://dashboard.example/api/shopee/callback' };
  const store = createAccessStore(':memory:', env), app = express(), shopee = fakeShopee();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installMarketplace(app, store, auth.audit);
  const installed = installShopeeShop(app, store, auth.audit, env, { fetchImpl: shopee.fetchImpl, sleep: async () => {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { installed.close(); await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  await users.save(root, null, { username: 'admin1', full_name: 'admin1 ชื่อเต็ม', role: 'admin', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: ['shopee_sync'] }, 'test');
  await users.save(root, null, { username: 'admin2', full_name: 'admin2', role: 'admin', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  const login = async username => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const get = (cookie, path) => fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const post = (cookie, path, body) => fetch(base + path, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify(body) });
  const owner = await login('root'), admin = await login('admin1'), plainAdmin = await login('admin2');
  assert.equal((await get(plainAdmin, '/api/shopee/status')).status, 403);
  assert.equal((await get(plainAdmin, '/api/shopee/items')).status, 403);
  assert.equal((await post(plainAdmin, '/api/shopee/sync', { start: '2026-10-01', end: '2026-10-02' })).status, 403);
  assert.equal((await get(admin, '/api/shopee/connect')).status, 403);
  assert.equal((await post(admin, '/api/shopee/sync', { start: '2026-10-01', end: '2026-10-02' })).status, 400); // not connected yet

  const connect = await get(owner, '/api/shopee/connect');
  assert.equal(connect.status, 303);
  const authorize = new URL(connect.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, HOSTS.sandbox + '/api/v2/shop/auth_partner');
  assert.equal(authorize.searchParams.get('partner_id'), '1250244');
  assert.equal(authorize.searchParams.get('sign'), signShopee('partner-secret', { partnerId: 1250244, path: '/api/v2/shop/auth_partner', timestamp: authorize.searchParams.get('timestamp') }));
  const redirect = new URL(authorize.searchParams.get('redirect'));
  assert.equal(redirect.origin + redirect.pathname, 'https://dashboard.example/api/shopee/callback');
  const state = redirect.searchParams.get('state');
  const cb = `/api/shopee/callback?state=${state}&code=good-code&shop_id=555`;
  assert.equal((await get(admin, cb)).status, 403);
  assert.equal((await get(owner, cb)).headers.get('location'), '/marketplace.html?shopee=connected#shopee');
  assert.equal((await get(owner, cb)).headers.get('location'), '/marketplace.html?shopee=expired#shopee'); // single use

  const conn = store.get('SELECT * FROM shopee_connections');
  assert.deepEqual([conn.shop_id, conn.env, conn.shop_name], ['555', 'sandbox', 'SK Sales Shopee']);
  assert.ok(!conn.access_token.includes('access-') && !conn.refresh_token.includes('refresh-')); // sealed
  const status = await (await get(admin, '/api/shopee/status')).json();
  assert.equal(status.env, 'sandbox');
  assert.equal(status.connections[0].shop, 'Shopee');
  assert.ok(!JSON.stringify(status).includes('access-') && !JSON.stringify(status).includes('refresh-'));

  for (let i = 0; i < 2; i++) {
    const sync = await post(admin, '/api/shopee/sync', { start: '2026-10-01', end: '2026-10-02' });
    assert.equal(sync.status, 200);
    assert.deepEqual(await sync.json(), { ok: true, message: 'ดึงข้อมูลจาก Shopee สำเร็จ' }); // no counts or totals
  }
  const list = shopee.calls.find(c => c.path === '/api/v2/order/get_order_list' && c.query.time_from);
  assert.equal(list.host, new URL(HOSTS.sandbox).host);
  assert.equal(list.query.access_token, 'access-1');
  assert.equal(list.query.time_from, String(ts('2026-10-01T00:00:00+07:00')));
  assert.equal(list.query.time_to, String(ts('2026-10-03T00:00:00+07:00') - 1));
  assert.ok(shopee.calls.some(c => c.path === '/api/v2/order/get_order_list' && c.query.cursor === 'c2')); // cursor paging

  const s = marketplaceSummary(store, { platform: 'shopee', start: '2026-10-01', end: '2026-10-31' });
  assert.equal(s.platforms[0].sales, 935); // 635 + 300 pending; cancelled and returned excluded
  assert.equal(s.platforms[0].orders, 2);
  assert.equal(s.platforms[0].allOrders, 4);
  const items = await (await get(admin, '/api/shopee/items')).json();
  assert.deepEqual(items.items.map(i => [i.sku, i.price, i.stock]), [['P1-R', 199, 4]]);

  // Logged calls carry endpoint/status/error only.
  // Completed order gets fees/net from the Payment API under the income-report key (no double count with a file).
  assert.deepEqual({ ...store.get("SELECT txn_id,fees,net_payout FROM marketplace_settlements WHERE platform='shopee'") }, { txn_id: 'income:261001AAA0001', fees: 74.5, net_payout: 560.5 });
  assert.deepEqual(JSON.parse(store.get("SELECT fee_detail FROM marketplace_settlements WHERE platform='shopee'").fee_detail), { commission_fee: 40, service_fee: 30, seller_transaction_fee: 4.5 });
  const logs = store.all('SELECT * FROM shopee_api_log');
  assert.ok(logs.some(l => l.endpoint === '/api/v2/order/get_order_list' && l.http_status === 429 && l.error === 'error_too_many_request'));
  const logText = JSON.stringify(logs);
  for (const secret of ['partner-secret', 'access-1', 'refresh-1', 'good-code']) assert.ok(!logText.includes(secret));

  // Shopee says the token is invalid: refreshed once and retried.
  shopee.expire();
  assert.equal((await post(admin, '/api/shopee/sync', { start: '2026-10-01', end: '2026-10-01' })).status, 200);
  assert.ok(shopee.calls.some(c => c.path === '/api/v2/auth/access_token/get' && c.body.refresh_token === 'refresh-1' && c.body.shop_id === 555));
  // Access token close to expiry: refreshed before the call.
  store.run('UPDATE shopee_connections SET access_expires=?', Date.now() + 60000);
  assert.equal((await post(admin, '/api/shopee/sync', { start: '2026-10-01', end: '2026-10-01' })).status, 200);
  assert.equal(shopee.calls.filter(c => c.path === '/api/v2/order/get_order_list').at(-1).query.access_token, 'access-3');

  assert.equal((await post(admin, '/api/shopee/sync', { start: '2026-01-01', end: '2026-10-01' })).status, 400); // > 92 days

  // Retention: API provinces of orders older than 90 days are cleared, uploaded-file provinces are kept.
  store.run("INSERT INTO marketplace_orders(platform,order_id,order_date,status,sales,province,source,updated_at) VALUES('shopee','FILE00001','2026-01-01','completed',10,'ระยอง','orders','x')");
  const purged = purgeShopeeBuyerData(store, Date.parse('2027-01-15T00:00:00Z'));
  assert.equal(purged.provinces, 2); // 0001 (named) and 0003 (from postcode)
  assert.equal(store.get("SELECT province FROM marketplace_orders WHERE order_id='261001AAA0001'").province, null);
  assert.equal(store.get("SELECT province FROM marketplace_orders WHERE order_id='FILE00001'").province, 'ระยอง');

  assert.equal((await fetch(base + '/api/shopee/connections/555', { method: 'DELETE', headers: { cookie: admin, 'X-PRPlus-Request': '1' } })).status, 403);
  assert.equal((await fetch(base + '/api/shopee/connections/555', { method: 'DELETE', headers: { cookie: owner, 'X-PRPlus-Request': '1' } })).status, 200);
  assert.equal(marketplaceSummary(store, { platform: 'shopee', start: '2026-10-01', end: '2026-10-31' }).platforms[0].sales, 935); // data stays
});
