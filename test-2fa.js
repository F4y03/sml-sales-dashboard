import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, logActions } from './test-security-helpers.js';
import { totpAt } from './src/services/totpService.js';
import { createHash } from 'node:crypto';

const PW = 'blue-sky-42';
const cookiesOf = r => Object.fromEntries(r.headers.getSetCookie().map(c => [c.split('=')[0], c.split(';')[0].split('=').slice(1).join('=')]));
const jar = obj => Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('; ');
const SA = { users: [['root', 'super_admin', PW], ['sales1', 'sales', PW], ['exec', 'executive', PW]] };
const twofa = (f, challenge, code, trust) => f.request('/api/auth/2fa', { body: { challenge, code, trust } });
// First login for a Super Admin: enrol with the secret returned by the server.
async function enroll(f, { trust = false, username = 'root' } = {}) {
  const first = (await (await f.login(username, PW)).json()).twoFactor;
  const done = await twofa(f, first.challenge, totpAt(first.secret), trust);
  return { done, body: await done.clone().json(), secret: first.secret };
}
// A later login. Replay protection would refuse a step already used in this same 30 s window, so the test clears last_step first.
const verifyLogin = async (f, secret, { trust = false } = {}) => {
  f.store.run('UPDATE user_totp SET last_step=0');
  const c = (await (await f.login('root', PW)).json()).twoFactor;
  return { c, res: await twofa(f, c.challenge, totpAt(secret), trust) };
};

// ---- Phase 4: Super Admin TOTP ----
test('legacy Super Admin sessions cannot bypass 2FA even after enrollment', async t => {
  const f = await fixture(t, SA);
  const user = f.store.get("SELECT id,auth_version FROM users WHERE username='root'");
  const token = 'legacy-session';
  const hash = createHash('sha256').update(token).digest('hex');
  f.store.run('INSERT INTO sessions VALUES(?,?,?,?,?)', hash, user.id, user.auth_version, null, Date.now() + 60000);
  const cookie = 'prplus_session=' + token;
  assert.equal((await f.request('/api/auth/me', { cookie })).status, 401);
  assert.equal((await f.request('/executive.html', { cookie })).status, 302);
  const { done } = await enroll(f);
  assert.equal((await f.request('/api/auth/me', { cookie: jar(cookiesOf(done)) })).status, 200);
  assert.equal((await f.request('/api/auth/me', { cookie })).status, 401);
});
test('other roles keep the original single-step login (no 2FA)', async t => {
  const f = await fixture(t, SA);
  for (const u of ['sales1', 'exec']) {
    const r = await f.login(u, PW), b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.twoFactor, undefined); assert.ok(b.redirect); assert.ok(cookiesOf(r)['prplus_session']);
  }
});
test('Super Admin: password alone never creates a session; first login enrols TOTP and returns one-time recovery codes', async t => {
  const f = await fixture(t, SA);
  const r = await f.login('root', PW), b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.twoFactor.mode, 'setup'); assert.equal(r.headers.getSetCookie().length, 0);
  assert.match(b.twoFactor.secret, /^[A-Z2-7]{32}$/);
  assert.match(b.twoFactor.otpauth, /^otpauth:\/\/totp\/PR%20PLUS:root\?secret=/);
  assert.match(b.twoFactor.qr, /^data:image\/svg\+xml;base64,/);
  assert.equal((await f.request('/api/auth/me')).status, 401);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM sessions').n, 0);
  assert.equal((await twofa(f, b.twoFactor.challenge, '000000')).status, 401);
  const ok = await twofa(f, b.twoFactor.challenge, totpAt(b.twoFactor.secret)), data = await ok.json();
  assert.equal(ok.status, 200); assert.equal(data.recoveryCodes.length, 10);
  assert.match(data.recoveryCodes[0], /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  assert.equal((await f.request('/api/auth/me', { cookie: jar(cookiesOf(ok)) })).status, 200);
  assert.equal((await twofa(f, b.twoFactor.challenge, totpAt(b.twoFactor.secret))).status, 401); // challenge is single use
  const stored = JSON.stringify(f.store.all('SELECT * FROM user_totp')) + JSON.stringify(f.store.all('SELECT * FROM login_challenges'));
  assert.ok(!stored.includes(b.twoFactor.secret), 'TOTP secret must be encrypted at rest');
});
test('enrolled Super Admin needs a valid OTP; replayed, malformed and wrong codes fail; a code works once', async t => {
  const f = await fixture(t, SA);
  const { secret } = await enroll(f);
  const again = (await (await f.login('root', PW)).json()).twoFactor;
  assert.equal(again.mode, 'verify'); assert.equal(again.secret, undefined);
  assert.equal((await twofa(f, again.challenge, totpAt(secret))).status, 401); // same step as enrolment = replay
  for (const bad of ['12345', 12345]) assert.equal((await twofa(f, again.challenge, bad)).status, 401); // 3 failures so far; 5 would lock
  assert.equal((await twofa(f, 'x', totpAt(secret))).status, 401);
  const next = totpAt(secret, Date.now() + 30000);
  const ok = await twofa(f, again.challenge, next);
  assert.equal(ok.status, 200); assert.equal((await ok.json()).recoveryCodes, undefined);
  assert.equal((await twofa(f, again.challenge, next)).status, 401);
  const c3 = (await (await f.login('root', PW)).json()).twoFactor;
  assert.equal((await twofa(f, c3.challenge, next)).status, 401); // the OTP just used cannot be reused for a new login
});
test('repeated wrong OTPs lock the account (5 → 15 min) and drop the challenge', async t => {
  const f = await fixture(t, SA);
  await enroll(f);
  const c = (await (await f.login('root', PW)).json()).twoFactor;
  for (let i = 0; i < 5; i++) assert.equal((await twofa(f, c.challenge, '000000')).status, 401);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM login_lockouts WHERE locked_until>?', Date.now()).n, 1);
  assert.equal((await f.login('root', PW)).status, 401);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM login_challenges').n, 0);
});

// ---- Phase 5: trusted device + recovery codes ----
test('trusted device: httpOnly/sameSite/secure cookie, only the hash is stored, skips OTP, never skips the password', async t => {
  const f = await fixture(t, { ...SA, env: { AUTH_COOKIE_SECURE: 'true' } });
  const { done } = await enroll(f, { trust: true });
  const raw = done.headers.getSetCookie().find(c => c.startsWith('__Host-prplus_trusted='));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000']) assert.ok(raw.includes(flag), flag);
  const token = raw.split(';')[0].split('=')[1], td = '__Host-prplus_trusted=';
  assert.match(token, /^[a-f0-9]{64}$/);
  const rows = f.store.all('SELECT * FROM trusted_devices');
  assert.equal(rows.length, 1); assert.notEqual(rows[0].token_hash, token); assert.equal(rows[0].token_hash.length, 64);
  assert.ok(!JSON.stringify(f.store.all('SELECT * FROM activity_logs')).includes(token));
  assert.ok(Math.abs(rows[0].expires - rows[0].created_at - 30 * 86400000) < 1000);
  const trusted = await (await f.login('root', PW, td + token)).json();
  assert.equal(trusted.twoFactor, undefined); assert.ok(trusted.redirect);
  assert.equal((await (await f.login('root', PW, td + 'a'.repeat(64))).json()).twoFactor.mode, 'verify');
  assert.equal((await f.login('root', 'wrong-pass-1', td + token)).status, 401);
  f.store.run('UPDATE trusted_devices SET expires=?', Date.now() - 1);
  assert.equal((await (await f.login('root', PW, td + token)).json()).twoFactor.mode, 'verify');
});
test('no checkbox → no trusted cookie; a token is bound to its user', async t => {
  const f = await fixture(t, { users: [['root', 'super_admin', PW], ['root2', 'super_admin', PW]] });
  const { done } = await enroll(f);
  assert.ok(!done.headers.getSetCookie().some(c => c.includes('trusted')));
  const { done: d2 } = await enroll(f, { username: 'root2', trust: true });
  const token = cookiesOf(d2)['prplus_trusted'];
  assert.equal((await (await f.login('root', PW, 'prplus_trusted=' + token)).json()).twoFactor.mode, 'verify');
  assert.equal((await (await f.login('root2', PW, 'prplus_trusted=' + token)).json()).twoFactor, undefined);
});
test('logout-all, password change and 2FA reset revoke trusted devices; plain logout keeps them', async t => {
  const f = await fixture(t, SA);
  const count = () => f.store.get('SELECT COUNT(*) n FROM trusted_devices').n;
  const { done, secret } = await enroll(f, { trust: true });
  assert.equal(count(), 1);
  const session = jar({ prplus_session: cookiesOf(done).prplus_session });
  assert.equal((await f.request('/api/auth/logout', { cookie: session, body: {} })).status, 200);
  assert.equal(count(), 1);
  // logout-all
  const s2 = await verifyLogin(f, secret, { trust: true }); assert.equal(count(), 2);
  const out = await f.request('/api/auth/logout-all', { cookie: jar({ prplus_session: cookiesOf(s2.res).prplus_session }), body: {} });
  assert.equal(out.status, 200); assert.equal(count(), 0);
  assert.equal((await f.request('/api/auth/me', { cookie: jar(cookiesOf(s2.res)) })).status, 401);
  // password change
  const s3 = await verifyLogin(f, secret, { trust: true }); assert.equal(count(), 1);
  const change = await f.request('/api/auth/password', { cookie: jar({ prplus_session: cookiesOf(s3.res).prplus_session }), body: { currentPassword: PW, newPassword: 'green-tea-77', confirmPassword: 'green-tea-77' } });
  assert.equal(change.status, 200); assert.equal(count(), 0);
  // 2FA reset → next password login enrols again
  f.store.run('INSERT INTO trusted_devices VALUES(?,?,?,?)', 'h1', 1, 1, Date.now() + 1e6);
  f.auth.twofa.reset(1);
  assert.equal(count(), 0); for (const tb of ['user_totp', 'recovery_codes']) assert.equal(f.store.get(`SELECT COUNT(*) n FROM ${tb}`).n, 0);
  assert.equal((await (await f.login('root', 'green-tea-77')).json()).twoFactor.mode, 'setup');
});
test('recovery codes: hashed at rest, single use, regeneration invalidates old codes, wrong password refused', async t => {
  const f = await fixture(t, SA);
  const { body } = await enroll(f), codes = body.recoveryCodes;
  const rows = JSON.stringify(f.store.all('SELECT * FROM recovery_codes'));
  assert.equal(f.store.get('SELECT COUNT(*) n FROM recovery_codes').n, 10);
  for (const c of codes) assert.ok(!rows.includes(c) && !rows.includes(c.replace(/-/g, '')));
  const use = async code => twofa(f, (await (await f.login('root', PW)).json()).twoFactor.challenge, code);
  const used = await use(codes[0].toLowerCase().replace(/-/g, ' '));
  assert.equal(used.status, 200);
  assert.equal((await use(codes[0])).status, 401);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM recovery_codes WHERE used_at IS NULL').n, 9);
  const cookie = jar({ prplus_session: cookiesOf(used).prplus_session });
  assert.equal((await f.request('/api/auth/recovery-codes', { cookie, body: { password: 'nope-nope-1' } })).status, 400);
  const fresh = await (await f.request('/api/auth/recovery-codes', { cookie, body: { password: PW } })).json();
  assert.equal(fresh.recoveryCodes.length, 10);
  assert.equal((await use(codes[1])).status, 401);
  assert.equal((await use(fresh.recoveryCodes[0])).status, 200);
  assert.equal((await (await f.request('/api/auth/security', { cookie })).json()).twoFactor.recoveryCodesRemaining, 9);
  assert.equal(logActions(f.store).includes('2fa.recovery_used'), true);
});
test('deleting a user leaves no security rows (FK cascade)', async t => {
  const f = await fixture(t, SA);
  await enroll(f, { trust: true });
  f.store.run('DELETE FROM sessions'); f.store.run('DELETE FROM activity_logs'); f.store.run('DELETE FROM users WHERE id=1');
  for (const tb of ['user_totp', 'recovery_codes', 'trusted_devices', 'login_lockouts', 'login_challenges']) assert.equal(f.store.get(`SELECT COUNT(*) n FROM ${tb}`).n, 0);
});

// ---- Phase 6: activity log ----
test('activity log records the security events and never contains passwords, OTPs, secrets, tokens or recovery codes', async t => {
  const f = await fixture(t, { users: [['root', 'super_admin', PW], ['sales1', 'sales', PW]] });
  await f.login('sales1', 'wrong-pass-9'); await f.login('nobody', 'wrong-pass-9');
  for (let i = 0; i < 5; i++) await f.login('sales1', 'wrong-pass-9');
  const { done, body, secret } = await enroll(f, { trust: true });
  const trustToken = cookiesOf(done).prplus_trusted, session = jar({ prplus_session: cookiesOf(done).prplus_session });
  const c = (await (await f.login('root', PW)).json()).twoFactor;
  const otp = totpAt(secret, Date.now() + 30000);
  await twofa(f, c.challenge, '000000');
  const used = await twofa(f, c.challenge, body.recoveryCodes[0]);
  await f.request('/api/auth/recovery-codes', { cookie: jar({ prplus_session: cookiesOf(used).prplus_session }), body: { password: PW } });
  await f.request('/api/auth/password', { cookie: session, body: { currentPassword: PW, newPassword: 'green-tea-77', confirmPassword: 'green-tea-77' } });
  const actions = new Set(logActions(f.store));
  for (const a of ['login', 'login.failed', 'account.locked', '2fa.enrolled', '2fa.failed', '2fa.recovery_used', '2fa.recovery_regenerated', 'trusted_device.add', 'trusted_device.revoke', 'user.password_change']) assert.ok(actions.has(a), 'missing log action ' + a);
  const dump = JSON.stringify(f.store.all('SELECT * FROM activity_logs'));
  const secrets = [PW, 'wrong-pass-9', 'green-tea-77', secret, otp, totpAt(secret), trustToken, ...body.recoveryCodes, ...body.recoveryCodes.map(x => x.replace(/-/g, '')), c.challenge, cookiesOf(done).prplus_session];
  for (const s of secrets) assert.ok(!dump.includes(s), 'log leaks a secret value');
  const failed = f.store.all("SELECT details FROM activity_logs WHERE action='login.failed'").map(x => x.details).join('');
  assert.ok(!failed.includes('nobody') && !failed.includes('sales1'), 'failed logins must not store the typed username');
});
test('audit redacts sensitive keys even if a caller passes them', async t => {
  const f = await fixture(t);
  f.auth.audit.record(null, 'x.test', 'test', { userId: 1, password: 'p1', otp: '123456', totpSecret: 's', sessionToken: 't', recoveryCodes: ['r'], ok: true });
  const row = f.store.get("SELECT details FROM activity_logs WHERE action='x.test'");
  assert.deepEqual(JSON.parse(row.details), { userId: 1, ok: true });
});
test('admin reset/revoke paths cancel trusted devices; Super Admin can reset another admin 2FA over the API', async t => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const express = (await import('express')).default;
  const { installAuth, hashPassword } = await import('./auth.js');
  const { createAccessStore } = await import('./src/models/accessStore.js');
  const { installAccess } = await import('./src/middleware/access.js');
  const { installAdminRoutes } = await import('./src/routes/adminRoutes.js');
  const { createUserService } = await import('./src/services/userService.js');
  const { loadUser } = await import('./src/services/permissionService.js');
  mkdirSync('test-results', { recursive: true });
  const envPath = resolve(mkdtempSync(resolve('test-results/sec-')), '.env'); writeFileSync(envPath, 'PGHOST=localhost\n');
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword(PW), AUTH_COOKIE_SECURE: 'false' };
  const store = createAccessStore(':memory:', env), app = express(); app.use(express.json());
  const auth = installAuth(app, env, store); installAccess(app); installAdminRoutes(app, store, auth.audit, envPath, auth.twofa);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (path, cookie = '', body, method = body ? 'POST' : 'GET') => fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: body && JSON.stringify(body) });
  const first = (await (await call('/api/auth/login', '', { username: 'root', password: PW })).json()).twoFactor;
  const ok = await call('/api/auth/2fa', '', { challenge: first.challenge, code: totpAt(first.secret) });
  const cookie = jar({ prplus_session: cookiesOf(ok).prplus_session });
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  const other = await users.save(root, null, { username: 'root2', full_name: 'Second', role: 'super_admin', is_active: true, password: 'orange-fox-31', additionalPermissions: [], territoryIds: [] }, 'test');
  store.run('INSERT INTO user_totp(user_id,secret_enc) VALUES(?,?)', other.id, 'x'); auth.twofa.regenerateRecoveryCodes(other.id);
  const trust = () => store.run('INSERT INTO trusted_devices VALUES(?,?,?,?)', 'h' + Math.random(), other.id, 1, Date.now() + 1e6);
  const count = () => store.get('SELECT COUNT(*) n FROM trusted_devices WHERE user_id=?', other.id).n;
  trust(); await users.resetPassword(root, other.id, 'purple-owl-52', 'orange-fox-31', 'test'); assert.equal(count(), 0);
  trust(); await users.save(root, other.id, { username: 'root2', full_name: 'Second', role: 'super_admin', is_active: true, password: 'silver-elm-63', currentPassword: 'purple-owl-52', additionalPermissions: [], territoryIds: [] }, 'test'); assert.equal(count(), 0);
  trust(); assert.equal((await call('/api/admin/security/revoke/' + other.id, cookie, {})).status, 200); assert.equal(count(), 0);
  trust(); assert.equal((await call(`/api/admin/users/${other.id}/2fa/reset`, cookie, {})).status, 200);
  assert.equal(count(), 0); assert.equal(store.get('SELECT COUNT(*) n FROM user_totp WHERE user_id=?', other.id).n, 0); assert.equal(store.get('SELECT COUNT(*) n FROM recovery_codes WHERE user_id=?', other.id).n, 0);
  assert.equal((await call('/api/admin/users/9999/2fa/reset', cookie, {})).status, 404);
  const logs = JSON.stringify(store.all('SELECT action,details FROM activity_logs'));
  assert.ok(logs.includes('2fa.reset') && logs.includes('trusted_device.revoke'));
  for (const p of ['orange-fox-31', 'purple-owl-52', 'silver-elm-63']) assert.ok(!logs.includes(p));
  // A non-Super-Admin (even with users_manage) cannot use the reset endpoint.
  await users.save(root, null, { username: 'rep', full_name: 'Rep', role: 'admin', is_active: true, password: 'bronze-ash-74', additionalPermissions: ['users_manage'], territoryIds: [] }, 'test');
  const login = await call('/api/auth/login', '', { username: 'rep', password: 'bronze-ash-74' });
  assert.equal((await call(`/api/admin/users/${other.id}/2fa/reset`, jar({ prplus_session: cookiesOf(login).prplus_session }), {})).status, 403);
});
