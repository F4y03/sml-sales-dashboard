import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAuth, hashPassword } from '../src/middleware/auth.js';
import { createAccessStore } from '../src/models/accessStore.js';
import { installAccess } from '../src/middleware/access.js';
import { installOnlineOrders } from '../src/routes/online-orders.js';
import { installExecSales, regionOf, provinceOf } from '../src/routes/exec-sales.js';
import { createUserService } from '../src/services/userService.js';
import { loadUser } from '../src/services/permissionService.js';

const SECRET = 'cs_exec_fixture_secret';
const orders = [
  { id: 1, status: 'completed', date_created_gmt: '2026-11-16T03:00:00', total: '1000', payment_method: 'bacs', payment_method_title: 'โอนเงิน', shipping: { postcode: '50000' }, billing: {} },
  { id: 2, status: 'processing', date_created_gmt: '2026-11-17T13:30:00', total: '2500', payment_method: 'cod', payment_method_title: 'เก็บเงินปลายทาง', shipping: { postcode: '10110' }, billing: {} },
  { id: 3, status: 'cancelled', date_created_gmt: '2026-11-17T14:00:00', total: '900', payment_method: 'stripe', payment_method_title: 'บัตรเครดิต', shipping: { postcode: '90110' }, billing: {} },
];
const stats = (after) => ({ totals: { net_revenue: after.startsWith('2026-11-1') ? 3500 : 2000, orders_count: 2, avg_order_value: 1750, coupons: 100, refunds: 0 },
  intervals: [{ interval: '2026-11-16', date_start: '2026-11-16 00:00:00', date_end: '2026-11-16 23:59:59', subtotals: { net_revenue: 1000, orders_count: 1, avg_order_value: 1000, coupons: 0, refunds: 0 } },
    { interval: '2026-11-17', date_start: '2026-11-17 00:00:00', date_end: '2026-11-17 23:59:59', subtotals: { net_revenue: 2500, orders_count: 1, avg_order_value: 2500, coupons: 100, refunds: 0 } }] });

async function fixture(t) {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); calls.push({ path: u.pathname, auth: init.headers.Authorization });
    const json = (data, total = 1) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', 'x-wp-total': String(total), 'x-wp-totalpages': '1' } });
    const p = u.pathname;
    if (p.endsWith('/wc-analytics/reports/revenue/stats')) return json(stats(u.searchParams.get('after')));
    if (p.endsWith('/wc-analytics/reports/products')) return json([{ product_id: 7, items_sold: 3, net_revenue: 2500, orders_count: 2, extended_info: { name: 'ลำโพง', sku: 'SPK' } }]);
    if (p.endsWith('/wc-analytics/reports/categories')) return json([{ category_id: 4, net_revenue: 3500, items_sold: 4, extended_info: { name: 'เครื่องเสียง' } }]);
    if (p.endsWith('/wc-analytics/reports/customers')) return json([], 5);
    if (p.endsWith('/wc-analytics/reports/orders')) return json([{ date_created: '2026-11-16 10:00:00', customer_type: 'new' }, { date_created: '2026-11-17 20:30:00', customer_type: 'returning' }]);
    if (p.endsWith('/wc/v3/reports/orders/totals')) return json([{ slug: 'completed', name: 'Completed', total: 10 }]);
    if (p.endsWith('/wc/v3/orders')) return json(orders, 3);
    return new Response('{}', { status: 404 });
  };
  const store = createAccessStore(':memory:', env), app = express(); app.use(express.json());
  const auth = installAuth(app, env, store); installAccess(app);
  const wooEnv = { WC_KEY: 'ck_x', WC_SECRET: SECRET };
  installOnlineOrders(app, store, auth.audit, { env: wooEnv, fetchImpl });
  installExecSales(app, { env: wooEnv, fetchImpl });
  app.get('/exec-sales.html', (_q, r) => r.send('page'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const request = (path, cookie = '', method = 'GET', body) => fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async u => (await request('/api/auth/login', '', 'POST', { username: u, password: 'fixture-password-123' })).headers.get('set-cookie')?.split(';')[0] || '';
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  const create = (username, role) => users.save(root, null, { username, full_name: username, role, is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  return { request, login, create, calls, store };
}
const Q = '?start=2026-11-14&end=2026-11-20';

test('ยอดขายผู้บริหาร: Super Admin only by default; per-user grant by Super Admin; role grants ignored; logged', async t => {
  const f = await fixture(t);
  const exec = await f.create('exec1', 'executive'); await f.create('admin1', 'admin');
  const [root, admin, execC] = [await f.login('root'), await f.login('admin1'), await f.login('exec1')];
  for (const c of [admin, execC]) for (const p of ['/exec-sales.html', '/api/exec-sales/me', '/api/exec-sales/overview' + Q, '/api/exec-sales/timeline' + Q, '/api/exec-sales/export' + Q])
    assert.equal((await f.request(p, c)).status, 403, p);
  // Admin cannot grant it.
  assert.equal((await f.request(`/api/admin/order-permissions/${exec.id}/exec-sales`, admin, 'PUT', { enabled: true })).status, 403);
  // A role grant (e.g. via a delegated roles_manage) does not open it.
  f.store.run("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r,permissions p WHERE r.code='executive' AND p.code='exec_sales_view'");
  assert.equal((await f.request('/api/exec-sales/overview' + Q, execC)).status, 403);
  // Super Admin grants exec1.
  const g = await f.request(`/api/admin/order-permissions/${exec.id}/exec-sales`, root, 'PUT', { enabled: true });
  assert.equal(g.status, 200);
  const gj = await g.json();
  assert.equal(gj.user.execSales, true);
  assert.deepEqual([gj.log[0].kind, gj.log[0].actor, gj.log[0].target, gj.log[0].from, gj.log[0].to], ['exec_sales', 'root', 'exec1', false, true]);
  assert.equal((await f.request('/api/exec-sales/overview' + Q, execC)).status, 200);
  assert.equal((await f.request(`/api/admin/order-permissions/1/exec-sales`, root, 'PUT', { enabled: false })).status, 400);
  // Revoke.
  await f.request(`/api/admin/order-permissions/${exec.id}/exec-sales`, root, 'PUT', { enabled: false });
  assert.equal((await f.request('/api/exec-sales/overview' + Q, execC)).status, 403);
  const all = await (await f.request('/api/admin/order-permissions', root)).json();
  assert.equal(all.log.filter(l => l.kind === 'exec_sales').length, 2);
  assert.equal(all.users.find(u => u.username === 'admin1').execSales, false);
});

test('overview numbers, 5-minute cache, export, and helpers', async t => {
  const f = await fixture(t);
  const root = await f.login('root');
  const r = await f.request('/api/exec-sales/overview' + Q, root);
  assert.equal(r.status, 200);
  const text = await r.text(); assert.ok(!text.includes(SECRET));
  const ov = JSON.parse(text);
  assert.deepEqual([ov.prevStart, ov.prevEnd], ['2026-11-07', '2026-11-13']);
  assert.equal(ov.kpis.current.net, 3500); assert.equal(ov.kpis.previous.net, 2000);
  assert.equal(ov.products.byNet[0].name, 'ลำโพง');
  assert.deepEqual(ov.provinces.regions.map(x => x.name).sort(), ['กรุงเทพฯ และปริมณฑล', 'ภาคเหนือ']);
  assert.equal(ov.statusChart.series.find(s => s.status === 'cancelled').counts['2026-11-17'], 1);
  const before = f.calls.length;
  assert.equal((await f.request('/api/exec-sales/overview' + Q, root)).status, 200);
  assert.equal(f.calls.length, before, 'second call within 5 minutes is served from cache');
  const tl = await (await f.request('/api/exec-sales/timeline' + Q + '&interval=hour', root)).json();
  assert.equal(tl.interval, 'hour');
  assert.equal((await (await f.request('/api/exec-sales/timeline?start=2026-10-01&end=2026-11-20&interval=hour', root)).json()).interval, 'day');
  const csv = await f.request('/api/exec-sales/export' + Q + '&format=csv', root);
  assert.equal(csv.status, 200); assert.match(await csv.text(), /ยอดขายสุทธิ/);
  const xlsx = await f.request('/api/exec-sales/export' + Q, root);
  assert.equal(xlsx.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal((await f.request('/api/exec-sales/overview?start=2026-11-20&end=2026-11-01', root)).status, 400);
  assert.ok(f.calls.every(c => c.auth === 'Basic ' + Buffer.from('ck_x:' + SECRET).toString('base64')));
  assert.equal(regionOf('ภูเก็ต'), 'ภาคใต้'); assert.equal(regionOf(null), 'ไม่ระบุ');
  assert.equal(provinceOf({ shipping: { postcode: '10270' } }), 'สมุทรปราการ');
});

test('orders list accepts the drill-down date/product filters', async t => {
  const f = await fixture(t);
  const root = await f.login('root');
  const r = await (await f.request('/api/online-orders?status=any&start=2026-11-17&end=2026-11-17&product=7', root)).json();
  assert.deepEqual([r.start, r.end, r.product], ['2026-11-17', '2026-11-17', 7]);
  assert.equal((await f.request('/api/online-orders?start=2026-11-17&end=2026-11-01', root)).status, 400);
});
