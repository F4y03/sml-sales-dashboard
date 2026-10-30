import test from 'node:test';
import assert from 'node:assert/strict';
import { accessToken } from '../src/services/marketplaceTokens.js';

// Plain-text "vault" and an in-memory connection row stand in for SQLite + sealing.
const vault = { open: v => v, seal: v => v };
function setup({ accessExpires, refreshExpires = Date.now() + 30 * 86400000 } = {}) {
  const row = { shop_id: 'S1', access_token: 'access-0', access_expires: accessExpires, refresh_token: 'refresh-0', refresh_expires: refreshExpires };
  const used = [];
  let n = 0;
  const opts = conn => ({
    key: 'test:' + row.shop_id, conn, vault, earlyMs: 3600000,
    reload: () => ({ ...row }),
    // Like the real platforms: a refresh token works once, then it is replaced.
    refresh: async token => {
      used.push(token);
      if (token !== row.refresh_token) throw Object.assign(new Error('error_shop_refresh_token'), { code: 'error_shop_refresh_token' });
      await new Promise(resolve => setTimeout(resolve, 20));
      n++;
      return { accessToken: 'access-' + n, accessExpires: Date.now() + 4 * 3600000, refreshToken: 'refresh-' + n, refreshExpires: row.refresh_expires };
    },
    save: t => Object.assign(row, { access_token: t.accessToken, access_expires: t.accessExpires, refresh_token: t.refreshToken, refresh_expires: t.refreshExpires }),
    expired: () => new Error('expired'),
  });
  return { row, used, opts };
}

test('fresh token is used without refreshing', async () => {
  const { opts, used } = setup({ accessExpires: Date.now() + 4 * 3600000 });
  const conn = { access_token: 'access-0', access_expires: Date.now() + 4 * 3600000 };
  assert.equal(await accessToken(opts(conn)), 'access-0');
  assert.equal(used.length, 0);
});

test('keep-alive and sync refreshing at the same time spend the refresh token once', async () => {
  const { opts, used, row } = setup({ accessExpires: Date.now() + 60000 });
  // Two callers holding their own stale copy of the row (as the 30-minute timer and a sync do).
  const a = { ...row }, b = { ...row };
  const [ta, tb] = await Promise.all([accessToken(opts(a)), accessToken(opts(b))]);
  assert.deepEqual(used, ['refresh-0']);
  assert.equal(ta, 'access-1'); assert.equal(tb, 'access-1');
  assert.equal(row.refresh_token, 'refresh-1');
  assert.equal(a.access_token, 'access-1'); // caller's copy follows the saved row
});

test('a caller with an old copy after a finished refresh reuses the saved token', async () => {
  const { opts, used, row } = setup({ accessExpires: Date.now() + 60000 });
  const stale = { ...row };
  await accessToken(opts({ ...row }));
  assert.equal(await accessToken(opts(stale)), 'access-1');
  assert.deepEqual(used, ['refresh-0']);
});

test('platform says the token expired: forced refresh once, then a new token', async () => {
  const { opts, used } = setup({ accessExpires: Date.now() + 4 * 3600000 });
  const conn = { access_token: 'access-0', access_expires: Date.now() + 4 * 3600000 };
  assert.equal(await accessToken({ ...opts(conn), force: true }), 'access-1');
  assert.deepEqual(used, ['refresh-0']);
});

test('expired refresh token asks for reconnect instead of calling the platform', async () => {
  const { opts, used } = setup({ accessExpires: Date.now() - 1, refreshExpires: Date.now() - 1 });
  await assert.rejects(accessToken(opts({ access_token: 'access-0', access_expires: Date.now() - 1, refresh_expires: Date.now() - 1 })), /expired/);
  assert.equal(used.length, 0);
});
