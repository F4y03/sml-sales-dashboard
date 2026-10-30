// Access tokens for Shopee / Lazada / TikTok Shop connections.
// All three rotate the refresh token on every refresh, so two overlapping refreshes with the same old
// token make the second fail (seen as Shopee error_shop_refresh_token when the 30-minute keep-alive met a sync).
// Refreshes therefore run once per connection at a time, and always start from the latest saved row.
const inflight = new Map();

// Same promise for every caller while a refresh for `key` is running.
export function refreshOnce(key, task) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve().then(task).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

// Returns a usable access token for `conn`, refreshing when it expires within `earlyMs`
// (or always when `force`, e.g. the platform answered "token expired").
//   reload()       -> latest saved row for this connection (or null)
//   refresh(token) -> { accessToken, accessExpires, refreshToken, refreshExpires }
//   save(t)        -> stores the new pair (sealed)
//   expired()      -> error to throw when the refresh token itself has expired
export async function accessToken({ key, conn, vault, earlyMs, now = Date.now(), force = false, reload, refresh, save, expired }) {
  if (!force && conn.access_expires - now > earlyMs) return vault.open(conn.access_token);
  const failedToken = conn.access_token;
  return refreshOnce(key, async () => {
    const current = reload() || conn;
    // Another caller refreshed meanwhile: use its token instead of spending the refresh token again.
    const refreshedElsewhere = current.access_token !== failedToken;
    if ((refreshedElsewhere || !force) && current.access_expires - now > earlyMs) {
      Object.assign(conn, current);
      return vault.open(current.access_token);
    }
    if (current.refresh_expires <= now) throw expired();
    const t = await refresh(vault.open(current.refresh_token));
    save(t);
    Object.assign(conn, current, reload() || { access_expires: t.accessExpires, refresh_expires: t.refreshExpires });
    return t.accessToken;
  });
}
