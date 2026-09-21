import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAuth, hashPassword } from './auth.js';
import { createAccessStore } from './src/models/accessStore.js';
import { fixture, logActions } from './test-security-helpers.js';
import { makePassword, validatePassword, verifyPassword, hashOnly } from './src/services/passwordService.js';

// ---- Phase 1: hashing + legacy password support ----
test('bcrypt hashes are used; scrypt, plain-text and bcrypt values all verify', async () => {
  const hash = await makePassword('blue-sky-42');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.ok(await verifyPassword('blue-sky-42', hash));
  assert.ok(!await verifyPassword('blue-sky-43', hash));
  assert.ok(await verifyPassword('legacy', await hashPassword('legacy')));
  assert.ok(await verifyPassword('short', 'short'));
  assert.ok(!await verifyPassword('short', 'other'));
  assert.ok(!await verifyPassword('', ''));
});
test('legacy plain-text and scrypt passwords below the new policy still log in and are upgraded to bcrypt unchanged', async t => {
  const store = createAccessStore(':memory:', {});
  const role = store.get("SELECT id FROM roles WHERE code='admin'").id;
  store.run('INSERT INTO users(username,password_hash,full_name,role_id) VALUES(?,?,?,?)', 'plain', 'abc', 'Plain', role);
  store.run('INSERT INTO users(username,password_hash,full_name,role_id) VALUES(?,?,?,?)', 'scr', await hashPassword('x'), 'Scrypt', role);
  const app = express(); app.use(express.json());
  const auth = installAuth(app, { AUTH_COOKIE_SECURE: 'false' }, store);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); auth.close(); });
  const login = (username, password) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password }) });
  assert.equal((await login('plain', 'abd')).status, 401);
  assert.equal((await login('plain', 'abc')).status, 200);
  assert.equal((await login('scr', 'x')).status, 200);
  for (const u of ['plain', 'scr']) assert.match(store.get('SELECT password_hash h FROM users WHERE username=?', u).h, /^\$2[aby]\$/);
  assert.equal((await login('plain', 'abc')).status, 200);
  assert.equal((await login('scr', 'x')).status, 200);
});

// ---- Phase 2: policy ----
test('password policy: 8+ chars, letter + digit, specials allowed, guessable rejected', async () => {
  for (const ok of ['blue-sky42', 'Abcdef1!', 'ก๊วยเตี๋ยว9', 'p#ss w0rd~ok', 'zz@@##11aa']) assert.doesNotThrow(() => validatePassword(ok), ok);
  for (const bad of ['', 'abc1', 'abcdef1', 'abcdefgh', '12345678', 'password1', 'Password123', 'qwerty123', 'aaaaaaa1', 'abababab', 'abcd1234', 'x'.repeat(73) + '1']) assert.throws(() => validatePassword(bad), /รหัสผ่าน/, bad);
  assert.throws(() => validatePassword('alice2024x', { username: 'Alice2024' }), /เดาง่าย/);
  await assert.doesNotReject(hashOnly('x'));
});

// ---- Phase 3: lockout + generic errors ----
test('5 wrong passwords lock the account for 15 minutes; correct password is refused while locked; same generic error everywhere', async t => {
  const f = await fixture(t, { users: [['admin', 'admin', 'blue-sky-42'], ['off', 'admin', 'blue-sky-42']] });
  f.store.run('UPDATE users SET is_active=0 WHERE username=?', 'off');
  const generic = { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  for (const [u, p] of [['nobody', 'x1y2z3w4'], ['admin', 'wrong-pass-1'], ['off', 'blue-sky-42']]) {
    const r = await f.login(u, p); assert.equal(r.status, 401); assert.deepEqual(await r.json(), generic);
  }
  for (let i = 0; i < 3; i++) assert.equal((await f.login('admin', 'wrong-pass-1')).status, 401);
  assert.equal(f.store.get('SELECT failed_attempts n FROM login_lockouts').n, 4);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM login_lockouts WHERE locked_until>0').n, 0);
  assert.equal((await f.login('admin', 'wrong-pass-1')).status, 401);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM login_lockouts WHERE locked_until>?', Date.now()).n, 1);
  const locked = await f.login('admin', 'blue-sky-42');
  assert.equal(locked.status, 401); assert.deepEqual(await locked.json(), generic); assert.ok(!locked.headers.get('set-cookie'));
  const until = f.store.get('SELECT locked_until u FROM login_lockouts').u;
  assert.ok(until - Date.now() > 14 * 60000 && until - Date.now() <= 15 * 60000);
  f.store.run('UPDATE login_lockouts SET locked_until=?', Date.now() - 1);
  assert.equal((await f.login('admin', 'blue-sky-42')).status, 200);
  assert.equal(f.store.get('SELECT COUNT(*) n FROM login_lockouts').n, 0);
  assert.equal(logActions(f.store).filter(a => a === 'account.locked').length, 1);
});
test('successful login resets the failure counter', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) await f.login('admin', 'wrong-pass-1');
  assert.equal((await f.login('admin', 'blue-sky-42')).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await f.login('admin', 'wrong-pass-1')).status, 401);
  assert.equal((await f.login('admin', 'blue-sky-42')).status, 200);
});
test('login rate limit returns 429 with Retry-After even for the right password', async t => {
  const f = await fixture(t, { users: [['a', 'admin', 'blue-sky-42']] });
  for (let i = 0; i < 10; i++) await f.login('nobody' + i, 'x1y2z3w4');
  const r = await f.login('a', 'blue-sky-42'); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
});
