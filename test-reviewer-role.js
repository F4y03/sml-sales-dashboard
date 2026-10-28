// Read-only "reviewer" role: online sales + own activity + data-protection page only; everything else 403 on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAuth, hashPassword } from './auth.js';
import { createAccessStore } from './src/models/accessStore.js';
import { installAccess } from './src/middleware/access.js';
import { installSelfRoutes } from './src/routes/selfRoutes.js';
import { createUserService } from './src/services/userService.js';
import { landingPage, loadUser } from './src/services/permissionService.js';
import { installMarketplace } from './marketplace.js';
import { installShopeeShop } from './shopee-shop.js';
import { isReviewer } from './src/config/access.js';

test('reviewer: allowlisted reads work, every other page/API and every write is 403', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const store = createAccessStore(':memory:', env), app = express();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installSelfRoutes(app, store);
  installMarketplace(app, store, auth.audit);
  installShopeeShop(app, store, auth.audit, { SHOPEE_ENV: 'sandbox' });
  app.get(/.*/, (req, res) => res.send('page')); // stands in for static files / other routes: reaching it = not blocked
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(store.all("SELECT p.code FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.code='reviewer'").map(r => r.code), ['marketplace_view']);
  await createUserService(store, auth.audit).save(loadUser(store, 1), null, { username: 'reviewer1', full_name: 'Reviewer', role: 'reviewer', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username: 'reviewer1', password: 'fixture-password-123' }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).redirect, '/marketplace.html#shopee');
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const call = (method, path, body) => fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, ...(body && { body: JSON.stringify(body) }) });

  for (const path of ['/marketplace.html', '/my-activity.html', '/data-protection.html', '/workspace-nav.js', '/marketplace.css',
    '/api/marketplace/summary?platform=all&start=2026-10-01&end=2026-10-28', '/api/marketplace/shops', '/api/me/activity', '/api/auth/me', '/api/shopee/status', '/api/shopee/items'])
    assert.notEqual((await call('GET', path)).status, 403, 'allowed: ' + path);
  assert.equal((await (await call('GET', '/api/shopee/status')).json()).readOnly, true); // panel hides Sync now / Reconnect
  const mine = await (await call('GET', '/api/me/activity')).json();
  assert.ok(mine.rows.length && mine.rows.every(r => r.action && !('details' in r))); // own rows only, no details payload

  const blocked = [
    ['GET', '/products.html'], ['GET', '/api/products'], ['GET', '/api/products/export'], ['GET', '/index.html'], ['GET', '/api/dashboard'],
    ['GET', '/reports.html'], ['GET', '/api/reports'], ['GET', '/customers.html'], ['GET', '/customer-stock.html'], ['GET', '/consignment.html'],
    ['GET', '/system-admin.html'], ['GET', '/api/admin/users'], ['GET', '/api/admin/activity'],
    ['GET', '/marketplace-upload.html'], ['POST', '/api/marketplace/upload'], ['GET', '/api/marketplace/uploads'], ['DELETE', '/api/marketplace/uploads/1'],
    ['POST', '/api/marketplace/shops', { name: 'x' }], ['GET', '/api/google-sheets/status'], ['POST', '/api/google-sheets/export'],
    ['GET', '/api/tiktok/status'], ['POST', '/api/tiktok/sync', {}], ['GET', '/api/lazada/status'], ['GET', '/api/shopee/connect'], ['GET', '/api/shopee/callback'], ['POST', '/api/shopee/sync', {}], ['DELETE', '/api/shopee/connections/1'],
    ['GET', '/marketplace-upload.html'],
    ['POST', '/api/auth/password', { currentPassword: 'fixture-password-123', newPassword: 'x', confirmPassword: 'x' }], ['GET', '/api/auth/security'],
    ['POST', '/api/auth/recovery-codes', { password: 'fixture-password-123' }], ['POST', '/api/auth/logout-all'],
    ['POST', '/api/me/activity'], ['GET', '/PRODUCTS.HTML'], ['GET', '/product-sheet/'],
  ];
  for (const [method, path, body] of blocked) assert.equal((await call(method, path, body)).status, 403, `blocked: ${method} ${path}`);
  assert.equal((await call('GET', '/api/auth/me')).status, 200); // still signed in: logout-all was refused, not run
  assert.ok(isReviewer('marketplace_reviewer') && !isReviewer('executive'));
  assert.equal(landingPage(loadUser(store, store.get("SELECT id FROM users WHERE username='reviewer1'").id)), '/marketplace.html#shopee');
});
