-- Additive only: online-marketplace sales (Shopee / Lazada / TikTok Shop) imported from Seller Center exports.
-- Lives in the app database, never in SML (SML stays read-only). Uploaded files are not kept; only the
-- columns below are stored. Customer names, phones, addresses and emails are never stored — province only.
-- Orders are keyed by (platform, order_id): re-uploading a file or an overlapping export replaces the order
-- instead of counting it twice. Dates are ค.ศ. YYYY-MM-DD (order created date).
CREATE TABLE IF NOT EXISTS marketplace_uploads (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK(platform IN ('shopee','lazada','tiktok')),
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  file_kinds TEXT NOT NULL DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS marketplace_uploads_time ON marketplace_uploads(id DESC);
CREATE TABLE IF NOT EXISTS marketplace_orders (
  platform TEXT NOT NULL CHECK(platform IN ('shopee','lazada','tiktok')),
  order_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('completed','pending','cancelled','returned')),
  status_raw TEXT NOT NULL DEFAULT '',
  sales REAL NOT NULL,
  refund REAL NOT NULL DEFAULT 0,
  province TEXT,
  has_items INTEGER NOT NULL DEFAULT 0 CHECK(has_items IN (0,1)),
  source TEXT NOT NULL,
  upload_id INTEGER REFERENCES marketplace_uploads(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(platform, order_id)
);
CREATE INDEX IF NOT EXISTS marketplace_orders_date ON marketplace_orders(order_date, platform);
CREATE TABLE IF NOT EXISTS marketplace_order_items (
  platform TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_key TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  sales REAL NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY(platform, order_id, line_key),
  FOREIGN KEY(platform, order_id) REFERENCES marketplace_orders(platform, order_id) ON DELETE CASCADE
);
-- Per-order money the platform actually settled: fees are stored as a positive amount deducted.
-- An order without a row here has no fee data (NULL), which is not the same as zero fees.
CREATE TABLE IF NOT EXISTS marketplace_settlements (
  platform TEXT NOT NULL,
  txn_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  fees REAL NOT NULL,
  net_payout REAL NOT NULL,
  upload_id INTEGER REFERENCES marketplace_uploads(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(platform, txn_id)
);
CREATE INDEX IF NOT EXISTS marketplace_settlements_order ON marketplace_settlements(platform, order_id);
