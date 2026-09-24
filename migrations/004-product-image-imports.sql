-- Source details for imported image links. Rows may precede an SML product.
CREATE TABLE IF NOT EXISTS product_image_imports (
  code TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
