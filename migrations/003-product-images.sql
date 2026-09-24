-- Additive only: product image links live in the app database, never in SML (SML stays read-only).
-- Not recorded in schema_migrations on purpose: the statement is idempotent and runs at each start like 001/002.
-- links_json is a JSON array of normalized links (Drive files as https://drive.google.com/file/d/ID/view); first = main image.
CREATE TABLE IF NOT EXISTS product_images (code TEXT PRIMARY KEY, links_json TEXT NOT NULL, updated_by INTEGER, updated_at TEXT NOT NULL);
