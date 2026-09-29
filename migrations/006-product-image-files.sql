-- Additive only: uploaded product photos live in the app database, never in SML (SML stays read-only).
-- The browser resizes each upload before sending; data is the display image, thumb the small table image.
-- product_images.links_json refers to a file as /api/products/images/files/<id>. Files a saved list no
-- longer uses are pruned when that product's links are saved again.
CREATE TABLE IF NOT EXISTS product_image_files (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  thumb_mime TEXT NOT NULL,
  thumb BLOB NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_image_files_code ON product_image_files(code);
