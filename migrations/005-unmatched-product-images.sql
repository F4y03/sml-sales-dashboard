CREATE TABLE IF NOT EXISTS unmatched_product_images (
  source_url TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  links_json TEXT NOT NULL,
  image_sources_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
