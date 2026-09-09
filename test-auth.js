import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAuth, hashPassword } from './auth.js';

async function fixture(t, overrides = {}) {
  const app = express();
  app.use(express.json());
  installAuth(app, { AUTH_USERNAME: 'admin', AUTH_PASSWORD_HASH: await hashPassword('test-password-123'), ...overrides });
  app.get('/executive.html', (req, res) => res.send('protected'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options) => fetch(base + path, { redirect: 'manual', ...options });
  const login = (password = 'test-password-123', headers = {}) => request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1', ...headers }, body: JSON.stringify({ username: 'admin', password }) });
  return { request, login };
}
test('protects pages/API, issues secure cookie, authenticates and revokes session', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request('/executive.html')).status, 302);
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await login('wrong')).status, 401);
  const response = await login();
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  for (const flag of ['__Host-prplus_session=', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(flag));
  assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
  const cookie = setCookie.split(';')[0];
  assert.equal((await request('/executive.html', { headers: { cookie } })).status, 200);
  assert.equal((await request('/api/auth/me', { headers: { cookie } })).status, 200);
  assert.equal((await request('/api/auth/me', { headers: { cookie: cookie + 'tampered' } })).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { cookie, 'X-PRPlus-Request': '1' } })).status, 200);
  assert.equal((await request('/api/auth/me', { headers: { cookie } })).status, 401);
});
test('rejects cross-site requests and throttles guessing regardless of spoofed IP', async t => {
  const { login, request } = await fixture(t);
  assert.equal((await request('/api/auth/login', { method: 'POST' })).status, 403);
  assert.equal((await login('test-password-123', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong', { 'X-Forwarded-For': `1.2.3.${i}` })).status, 401);
  const limited = await login();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
test('missing configuration fails closed', async t => {
  const { login, request } = await fixture(t, { AUTH_PASSWORD_HASH: '' });
  assert.equal((await login()).status, 503);
  assert.equal((await request('/api/dashboard')).status, 401);
});
