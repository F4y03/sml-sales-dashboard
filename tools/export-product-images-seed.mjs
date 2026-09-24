// Snapshots product_images + product_image_imports (no user/auth data) into a git-tracked
// seed file, so other machines that `git pull` can get the same import results via
// tools/import-product-images-seed.mjs. data/access.sqlite itself stays gitignored on purpose
// (it also holds users/sessions/password hashes).
import fs from 'node:fs/promises';
import { createAccessStore } from '../src/models/accessStore.js';

const store = createAccessStore(new URL('../data/access.sqlite', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const images = store.all('SELECT code, links_json, updated_at FROM product_images');
const imports = store.all('SELECT code, product_name, source_name, source_row, updated_at FROM product_image_imports');
store.close();

const outPath = new URL('../product-image-drive-output/product-images-seed.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await fs.writeFile(outPath, JSON.stringify({ images, imports }, null, 2));
console.log(JSON.stringify({ images: images.length, imports: imports.length, outPath }));
