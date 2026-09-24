import fs from 'node:fs/promises';
import pg from 'pg';
import { createAccessStore } from '../src/models/accessStore.js';

const path = process.argv[2];
if (!path) throw new Error('usage: node --env-file=.env tools/check-attached-product-codes.mjs <product-map.json>');
const products = JSON.parse(await fs.readFile(path, 'utf8'));
const codes = [...new Set(products.map(x => x.sku))];
const pool = new pg.Pool({ max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000, options: '-c default_transaction_read_only=on' });
let found;
try {
  const { rows } = await pool.query('SELECT code FROM ic_inventory WHERE code = ANY($1::text[]) OR lower(btrim(code)) = ANY($2::text[])', [codes, codes.map(x => x.toLowerCase())]);
  found = new Set(rows.map(x => x.code));
} finally { await pool.end(); }
const store = createAccessStore(new URL('../data/access.sqlite', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const existing = store.all('SELECT code FROM product_images');
store.close();
const existingCodes = new Set(existing.map(x => x.code));
console.log(JSON.stringify({products: products.length, uniqueCodes: codes.length, matched: codes.filter(x => found.has(x)).length, unmatched: codes.filter(x => !found.has(x)), existingImages: codes.filter(x => existingCodes.has(x)).length, over20: products.filter(x => x.images.length > 20).map(x => x.sku)},null,2));
