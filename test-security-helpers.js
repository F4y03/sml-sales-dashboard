import express from 'express';
import { installAuth } from './auth.js';
import { createAccessStore } from './src/models/accessStore.js';
// Shared fixture for test-security.js and test-2fa.js: in-memory store, given users (plain-text legacy passwords are upgraded on first login).
export async function fixture(t, { users = [['admin', 'admin', 'blue-sky-42']], env = {} } = {}) {
  const store = createAccessStore(':memory:', {});
  for (const [username, role, password] of users) store.run('INSERT INTO users(username,password_hash,full_name,role_id) SELECT ?,?,?,id FROM roles WHERE code=?', username, password.startsWith('$') ? password : password, username, role);
  const app = express(); app.use(express.json());
  const auth = installAuth(app, { AUTH_COOKIE_SECURE: 'false', ...env }, store);
  app.get('/executive.html', (req, res) => res.send('protected'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); auth.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { cookie = '', body, method = body ? 'POST' : 'GET' } = {}) => fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: body && JSON.stringify(body) });
  const login = (username, password, cookie = '') => request('/api/auth/login', { body: { username, password }, cookie });
  return { store, auth, request, login };
}
export const logActions = store => store.all('SELECT action FROM activity_logs ORDER BY id').map(x => x.action);

