-- Additive only: the seller shop an online-marketplace upload belongs to (one company can run several shops).
-- shop_id columns on marketplace_uploads / marketplace_orders / marketplace_settlements are added in accessStore.js
-- (ALTER TABLE is not idempotent). NULL shop_id = data uploaded before shops existed.
CREATE TABLE IF NOT EXISTS marketplace_shops (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
-- Seller identity read from files that carry one (Shopee seller username, Lazada short code), learnt on first upload.
CREATE TABLE IF NOT EXISTS marketplace_shop_codes (
  platform TEXT NOT NULL CHECK(platform IN ('shopee','lazada','tiktok')),
  code TEXT NOT NULL COLLATE NOCASE,
  shop_id INTEGER NOT NULL REFERENCES marketplace_shops(id),
  PRIMARY KEY(platform, code)
);
