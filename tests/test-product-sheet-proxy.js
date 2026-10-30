import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAuth, hashPassword } from '../auth.js';
import { createAccessStore } from '../src/models/accessStore.js';
import { installAccess } from '../src/middleware/access.js';
import { installProductSheetProxy } from '../src/routes/productSheetProxy.js';
import { createUserService } from '../src/services/userService.js';
import { loadUser } from '../src/services/permissionService.js';
import { hashOnly } from '../src/services/passwordService.js';

const listen = async app => { const s = app.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r)); return s; };

async function fixture(t, { noPassword = false } = {}) {
  // Fake product-sheet upstream that echoes what it receives.
  const seen = [];
  const sheet = express();
  sheet.use(express.json({ limit: '256kb' }));
  sheet.all(/.*/, (req, res) => { seen.push({ method: req.method, url: req.url, cookie: req.headers.cookie, body: req.body }); res.json({ ok: true, url: req.url, size: JSON.stringify(req.body || {}).length }); });
  const upstream = await listen(sheet);

  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const store = createAccessStore(':memory:', env), app = express();
  const jsonBody = express.json({ limit: '32kb' });
  app.use((req, res, next) => /^\/product-sheet(\/|$)/i.test(req.path) ? next() : jsonBody(req, res, next));
  const auth = installAuth(app, env, store); installAccess(app); installProductSheetProxy(app, { port: upstream.address().port, store, env });
  if (!noPassword) store.run('INSERT INTO system_settings VALUES(?,?)', 'product_sheet_password_hash', await hashOnly('sheet-pass-123'));
  const server = await listen(app), base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { for (const s of [server, upstream]) await new Promise(r => { s.close(r); s.closeAllConnections(); }); auth.close(); store.close(); });
  const request = (path, cookie = '', method = 'GET', body, headers = {}) => fetch(base + path, { redirect: 'manual', method, headers: { cookie, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async username => (await request('/api/auth/login', '', 'POST', { username, password: 'fixture-password-123' }, { 'X-PRPlus-Request': '1' })).headers.get('set-cookie')?.split(';')[0] || '';
  const root = loadUser(store, 1);
  createUserService(store, auth.audit).save(root, null, { username: 'admin1', full_name: 'admin1', role: 'admin', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  return { request, login, seen, base };
}


test('product-sheet: products.html needs the page password (or a dashboard login); writes need super_admin', async t => {
  const { request, login, seen, base } = await fixture(t);
  const origin = { Origin: base };
  // Without the password nothing reaches product-sheet.
  assert.equal((await request('/product-sheet/products.html')).headers.get('location'), '/product-sheet/login.html');
  for (const path of ['/product-sheet/api/sheet', '/product-sheet/download.csv']) assert.equal((await request(path)).status, 401, 'anon ' + path);
  assert.equal((await request('/product-sheet/api/sml-stock', '', 'POST', { codes: ['A'] }, origin)).status, 401);
  assert.equal((await request('/product-sheet/login.html')).status, 200);
  assert.equal(seen.length, 0);
  // Password login.
  assert.equal((await request('/product-sheet/api/login', '', 'POST', { password: 'sheet-pass-123' })).status, 403, 'login needs same-origin');
  assert.equal((await request('/product-sheet/api/login', '', 'POST', { password: 'wrong' }, origin)).status, 401);
  const ok = await request('/product-sheet/api/login', '', 'POST', { password: 'sheet-pass-123' }, origin);
  assert.equal(ok.status, 200);
  const pass = ok.headers.get('set-cookie').split(';')[0];
  for (const path of ['/product-sheet/products.html', '/product-sheet/products.js', '/product-sheet/api/sheet', '/product-sheet/download.csv']) assert.equal((await request(path, pass)).status, 200, 'pass ' + path);
  assert.equal((await request('/product-sheet/api/sml-stock', pass, 'POST', { codes: ['A'] }, origin)).status, 200);
  assert.equal(seen.at(-1).cookie, undefined, 'no cookie forwarded');
  assert.equal((await request('/product-sheet/products.html', pass + 'x')).status, 302, 'tampered cookie');
  // The page password never grants writes; only super_admin does.
  assert.equal((await request('/product-sheet/api/update-sku', pass, 'POST', { oldCode: 'A' }, origin)).status, 401);
  for (const path of ['/product-sheet/', '/product-sheet/index.html']) assert.equal((await request(path, pass)).headers.get('location'), '/product-sheet/products.html');
  assert.equal((await request('/product-sheet/sheet.js', pass)).status, 302, 'unpublished file still needs a dashboard login');
  const admin = await login('admin1');
  assert.equal((await request('/product-sheet/products.html', admin)).status, 200, 'dashboard users view without the page password');
  assert.equal((await request('/Product-Sheet/api/update-sku', admin, 'POST', { oldCode: 'A' }, origin)).status, 403, 'admin write');
  const root = await login('root');
  assert.equal((await request('/product-sheet/api/update-sku', root, 'POST', { oldCode: 'A' }, { Origin: 'https://evil.example' })).status, 403, 'cross-origin write');
  assert.equal((await request('/product-sheet/api/missing-products', root, 'POST', { values: [] }, origin)).status, 404, 'unpublished endpoint');
  const big = { oldCode: 'A', newCode: 'x'.repeat(100 * 1024) };
  assert.equal((await request('/product-sheet/api/update-sku', root, 'POST', big, origin)).status, 200, 'super_admin write streams past 32kb');
  assert.deepEqual(seen.at(-1).body, big);
  // Logout ends the page session.
  assert.equal((await request('/product-sheet/api/logout', pass, 'POST', {}, origin)).status, 200);
  assert.equal((await request('/product-sheet/api/sheet', pass)).status, 401);
  // Brute force is limited per client.
  for (let i = 0; i < 10; i++) await request('/product-sheet/api/login', '', 'POST', { password: 'bad' }, { ...origin, 'CF-Connecting-IP': '203.0.113.5' });
  assert.equal((await request('/product-sheet/api/login', '', 'POST', { password: 'sheet-pass-123' }, { ...origin, 'CF-Connecting-IP': '203.0.113.5' })).status, 429);
});

test('product-sheet: page stays locked when no password has been set', async t => {
  const { request, base } = await fixture(t, { noPassword: true });
  assert.equal((await request('/product-sheet/api/login', '', 'POST', { password: '' }, { Origin: base })).status, 503);
  assert.equal((await request('/product-sheet/products.html')).headers.get('location'), '/product-sheet/login.html');
});
