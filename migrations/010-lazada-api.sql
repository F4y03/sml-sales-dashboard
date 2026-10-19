-- Additive only: Lazada Open Platform connection (in-house seller app). See MARKETPLACE.md › Lazada API.
-- Tokens are sealed with the same AES-GCM vault as 2FA secrets (AUTH_2FA_KEY / data/2fa.key) — never stored in plain text.
-- One row per authorised Lazada seller; shop_id links it to the dashboard shop its orders are saved under.
CREATE TABLE IF NOT EXISTS lazada_connections (
  seller_id TEXT PRIMARY KEY,
  short_code TEXT NOT NULL DEFAULT '',
  shop_name TEXT NOT NULL DEFAULT '',
  shop_id INTEGER NOT NULL REFERENCES marketplace_shops(id),
  access_token TEXT NOT NULL,
  access_expires INTEGER NOT NULL,
  refresh_token TEXT NOT NULL,
  refresh_expires INTEGER NOT NULL,
  connected_by INTEGER REFERENCES users(id),
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_sync_error TEXT
);
-- OAuth "state" for the authorise redirect: single use, expires after 10 minutes, bound to the user who started it.
CREATE TABLE IF NOT EXISTS lazada_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  shop_id INTEGER NOT NULL REFERENCES marketplace_shops(id),
  expires INTEGER NOT NULL
);
