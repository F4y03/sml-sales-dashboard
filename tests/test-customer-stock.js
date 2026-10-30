// ลูกค้า & สต็อก: stock cycles, input validation, parameterised SQL and role-only access.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installCustomerStock, stockCycles, withInferredSaleCodes } from './customer-stock.js';
import { installAccess } from './src/middleware/access.js';

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const move = (date, direction, quantity, balance, flag = direction === 1 ? 12 : 44, customer = '') =>
  ({ date, docNo: `D-${date}`, flag, direction, quantity: String(quantity), balance: String(balance), customer, customerName: customer ? `ลูกค้า ${customer}` : null });

test('stock cycles: วันเข้า when the balance rises above 0, buyers from sales only, วันหมด when it returns to 0', () => {
  const cycles = stockCycles([
    move('2026-01-01', 1, 10, 10),
    move('2026-01-05', -1, 4, 6, 44, 'A'),
    move('2026-01-06', -1, 2, 4, 44, 'B'),
    move('2026-01-07', 1, 1, 5, 48, 'A'), // return comes back in, still the same cycle
    move('2026-01-08', -1, 3, 2, 44, 'A'),
    move('2026-01-09', -1, 2, 0, 56),     // a non-sale issue empties the stock
    move('2026-02-01', 1, 5, 5),
    move('2026-02-03', -1, 1, 4, 44, 'C'),
  ]);
  assert.equal(cycles.length, 2);
  const [open, closed] = cycles; // newest first
  assert.deepEqual([closed.start, closed.end, closed.days, closed.received, closed.sold], ['2026-01-01', '2026-01-09', 8, 11, 9]);
  assert.deepEqual(closed.buyers.map(b => [b.code, b.quantity, b.bills]), [['A', 7, 2], ['B', 2, 1]]);
  assert.deepEqual([open.start, open.end, open.days, open.sold], ['2026-02-01', null, null, 1]);
});

test('customers without a salesperson take the longest matching team prefix, otherwise stay unassigned', () => {
  const result = withInferredSaleCodes([
    { code: 'A1', saleCode: 'กท-ต' }, { code: 'A2', saleCode: 'กท' }, { code: 'A3', saleCode: 'บอ' },
    { code: 'กท-ต102', saleCode: '' }, { code: 'กท-001', saleCode: '' }, { code: 'บอ-155', saleCode: '' }, { code: 'ZZ-9', saleCode: '' },
  ]);
  assert.deepEqual(result.slice(3).map(c => c.saleCode), ['กท-ต', 'กท', 'บอ', '']);
});

test('stock cycles: negative or unknown balances never start a cycle', () => {
  assert.deepEqual(stockCycles([move('2026-01-01', -1, 3, -3), move('2026-01-02', 1, 2, -1)]), []);
  assert.deepEqual(stockCycles([{ ...move('2026-01-01', 1, 3, 3), balance: null }]), []);
});

test('API validates input, binds every user value as a parameter and never widens on bad input', async () => {
  const app = express();
  const calls = [];
  installCustomerStock(app, { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('AS history')) return { rows: [{ history: { customer: { code: params[0], name: 'X' }, summary: { documents: 1 }, bills: [] } }] };
    if (sql.includes('AS stock')) return { rows: [{ stock: { summary: {}, matching: { count: 0, value: 0 }, rows: [] } }] };
    if (sql.includes('balance_qty) AS quantity') && params.length === 1 && !sql.includes('LIMIT 30')) return { rows: [{ code: params[0], name: 'P', unit: 'ตัว', quantity: '5' }] };
    return { rows: [] };
  } });
  const { server, base } = await listen(app);
  const get = path => fetch(base + path);
  try {
    for (const path of ['/api/customer-stock/customers', '/api/customer-stock/customers?q=', '/api/customer-stock/customer',
      '/api/customer-stock/customer?code=A&page=-1', '/api/customer-stock/bill?docNo=X&date=2026-02-30&flag=44',
      '/api/customer-stock/bill?docNo=X&date=2026-01-01&flag=12', '/api/customer-stock/stock?filter=everything',
      '/api/customer-stock/stock?sort=price;drop', '/api/customer-stock/products', '/api/customer-stock/movement']) {
      assert.equal((await get(path)).status, 400, path);
    }
    assert.equal(calls.length, 0, 'invalid input never reaches SML');
    const injection = "x' OR 1=1 --";
    for (const path of [`/api/customer-stock/customers?q=${encodeURIComponent(injection)}`, `/api/customer-stock/customer?code=${encodeURIComponent(injection)}`,
      `/api/customer-stock/stock?q=${encodeURIComponent(injection)}`, `/api/customer-stock/movement?code=${encodeURIComponent(injection)}`]) {
      const response = await get(path);
      assert.ok([200, 404].includes(response.status), path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const call of calls) {
      assert.ok(!call.sql.includes('OR 1=1'), 'user text is never concatenated into SQL');
      assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(call.sql), 'read-only SQL');
    }
    assert.ok(calls.some(c => c.params.includes(injection)));
    const stockCall = calls.find(c => c.sql.includes('AS stock'));
    assert.deepEqual(stockCall.params, [injection, 'all', 'value', 0]);
    assert.ok(stockCall.sql.includes("left(i.code, 1) <> 'ฝ'"), 'consignment stock excluded');
    const movement = await (await get('/api/customer-stock/movement?code=P1')).json();
    assert.deepEqual(movement.cycles, []);
    assert.equal(movement.computedBalance, null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('only Super Admin / ผู้บริหาร with every territory can open the page or its API', async () => {
  const app = express();
  let auth;
  app.use((req, res, next) => { req.auth = auth; next(); });
  installAccess(app);
  app.get('/customer-stock.html', (req, res) => res.send('page'));
  app.get('/api/customer-stock/stock', (req, res) => res.json({ ok: true }));
  const { server, base } = await listen(app);
  try {
    const cases = [
      [{ role: 'super_admin', scope: 'all', permissions: [] }, 200],
      [{ role: 'executive', scope: 'all', permissions: ['dashboard'] }, 200],
      [{ role: 'executive', scope: 'territory', permissions: ['dashboard'], territories: [] }, 403],
      [{ role: 'admin', scope: 'all', permissions: ['price_stock', 'product_info', 'customer_analysis'] }, 403],
      [{ role: 'sales', scope: 'territory', permissions: ['price_stock', 'customer_analysis'], territories: [] }, 403],
    ];
    for (const [user, expected] of cases) {
      auth = user;
      for (const path of ['/customer-stock.html', '/api/customer-stock/stock', '/API/Customer-Stock/stock']) {
        assert.equal((await fetch(base + path)).status, expected, `${user.role}/${user.scope} ${path}`);
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
