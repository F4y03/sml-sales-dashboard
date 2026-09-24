// Applies product-image-drive-output/product-images-seed.json (from
// export-product-images-seed.mjs) into this machine's local data/access.sqlite. Run this after
// `git pull` so every machine shows the same "pending product images" list. Idempotent: only
// writes rows that are new or changed.
import fs from 'node:fs/promises';
import { createAccessStore } from '../src/models/accessStore.js';

const seedPath = new URL('../product-image-drive-output/product-images-seed.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { images, imports } = JSON.parse(await fs.readFile(seedPath, 'utf8'));

const store = createAccessStore(new URL('../data/access.sqlite', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let imagesWritten = 0, importsWritten = 0;
try {
  store.transaction(() => {
    for (const row of images) {
      const existing = store.get('SELECT links_json FROM product_images WHERE code=?', row.code);
      if (existing?.links_json === row.links_json) continue;
      store.run('INSERT INTO product_images(code,links_json,updated_by,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json,updated_by=NULL,updated_at=excluded.updated_at', row.code, row.links_json, row.updated_at);
      imagesWritten++;
    }
    for (const row of imports) {
      const existing = store.get('SELECT product_name,source_name,source_row FROM product_image_imports WHERE code=?', row.code);
      if (existing && existing.product_name === row.product_name && existing.source_name === row.source_name && existing.source_row === row.source_row) continue;
      store.run('INSERT INTO product_image_imports(code,product_name,source_name,source_row,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET product_name=excluded.product_name,source_name=excluded.source_name,source_row=excluded.source_row,updated_at=excluded.updated_at', row.code, row.product_name, row.source_name, row.source_row, row.updated_at);
      importsWritten++;
    }
  });
} finally { store.close(); }
console.log(JSON.stringify({ images: images.length, imports: imports.length, imagesWritten, importsWritten }));
