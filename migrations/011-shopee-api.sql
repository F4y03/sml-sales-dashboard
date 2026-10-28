-- Additive only: Shopee Open Platform v2 connection (ISV app, category ERP System). See MARKETPLACE.md › Shopee API.
-- Tokens are sealed with the same AES-GCM vault as 2FA secrets (AUTH_2FA_KEY / data/2fa.key) — never stored in plain text.
-- One row per authorised Shopee shop; dashboard_shop_id links it to the dashboard shop its orders are saved under.
-- env records sandbox/live so a sandbox token is never used against the live host (and vice versa).
CREATE TABLE IF NOT EXISTS shopee_connections (
  shop_id TEXT PRIMARY KEY,
  env TEXT NOT NULL CHECK(env IN ('sandbox','live')),
  shop_name TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  dashboard_shop_id INTEGER NOT NULL REFERENCES marketplace_shops(id),
  access_token TEXT NOT NULL,
  access_expires INTEGER NOT NULL,
  refresh_token TEXT NOT NULL,
  refresh_expires INTEGER NOT NULL,
  connected_by INTEGER REFERENCES users(id),
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_sync_error TEXT,
  last_item_sync_at TEXT
);
-- OAuth "state" for the authorise redirect: single use, expires after 10 minutes, bound to the user who started it.
CREATE TABLE IF NOT EXISTS shopee_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  shop_id INTEGER NOT NULL REFERENCES marketplace_shops(id),
  expires INTEGER NOT NULL
);
-- Products and stock per model (model_id 0 = item without variations). stock NULL = Shopee gave no stock, not zero.
CREATE TABLE IF NOT EXISTS shopee_items (
  shop_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '0',
  item_sku TEXT NOT NULL DEFAULT '',
  model_sku TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  model_name TEXT NOT NULL DEFAULT '',
  item_status TEXT NOT NULL DEFAULT '',
  price REAL,
  stock REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(shop_id, item_id, model_id)
);
-- Every Shopee API call: endpoint, HTTP status, Shopee error code. Never the sign, tokens, partner key or response body.
CREATE TABLE IF NOT EXISTS shopee_api_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  shop_id TEXT,
  http_status INTEGER,
  error TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS shopee_api_log_at ON shopee_api_log(at);
