// Per-account 2FA exemption (users.two_factor_exempt): only that account skips the OTP; everyone else still needs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installAuth, hashPassword } from '../auth.js';
import { createAccessStore } from '../src/models/accessStore.js';
import { installAccess } from '../src/middleware/access.js';
import { createUserService } from '../src/services/userService.js';
import { loadUser } from '../src/services/permissionService.js';

test('exempt account logs in with password only; normal account still gets the 2FA challenge', async t => {
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false' }; // 2FA enforced
  const store = createAccessStore(':memory:', env), app = express();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); });
  const base = 'http://127.0.0.1:' + server.address().port, users = createUserService(store, auth.audit), root = loadUser(store, 1);
  for (const username of ['review1', 'normal1'])
    await users.save(root, null, { username, full_name: username, role: 'admin', is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
  store.run("UPDATE users SET two_factor_exempt=1 WHERE username='review1'");
  const login = username => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });

  const exempt = await login('review1');
  assert.equal(exempt.status, 200);
  assert.equal((await exempt.json()).twoFactor, undefined); // no OTP step
  const me = await fetch(base + '/api/auth/me', { headers: { cookie: exempt.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') } });
  assert.equal(me.status, 200); // the session is complete without a second factor

  const normal = await (await login('normal1')).json();
  assert.ok(normal.twoFactor?.challenge); // still asked for the OTP
  assert.equal(loadUser(store, store.get("SELECT id FROM users WHERE username='normal1'").id).two_factor_exempt, false); // default off
});
