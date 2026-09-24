import fs from 'node:fs/promises';
import pg from 'pg';
import { createAccessStore } from '../src/models/accessStore.js';
import { normalizeImageLink, MAX_IMAGES } from '../product-images.js';

const positional = process.argv.slice(2).filter(x => x !== '--apply');
const [mapPath, receiptPath, sourceName] = positional;
const apply = process.argv.includes('--apply');
if (!mapPath || !receiptPath) throw new Error('usage: node --env-file=.env tools/import-attached-product-images.mjs <product-map.json> <receipts.json> [--apply]');
const products = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const receipts = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
const receiptByUrl = new Map(receipts.map(x => [x.sourceUrl, x]));
const codes = new Set();
const prepared = [];
for (const row of products) {
  if (codes.has(row.sku)) throw new Error(`duplicate SKU in spreadsheet: ${row.sku}`);
  codes.add(row.sku);
  const links = [];
  for (const image of row.images) {
    const receipt = receiptByUrl.get(image.sourceUrl);
    if (!receipt?.driveId) throw new Error(`missing Drive receipt for ${row.sku} ${image.col}`);
    const normalized = normalizeImageLink(receipt.driveUrl);
    if (!normalized.ok || normalized.driveId !== receipt.driveId) throw new Error(`invalid Drive link for ${row.sku} ${image.col}`);
    if (!links.includes(normalized.value)) links.push(normalized.value);
  }
  if (links.length > MAX_IMAGES) throw new Error(`too many images for ${row.sku}: ${links.length}`);
  prepared.push({code: row.sku, name: row.productName || '', links, sourceRow: row.row});
}

const pool = new pg.Pool({max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000, options: '-c default_transaction_read_only=on'});
let found;
try {
  const {rows} = await pool.query('SELECT code FROM ic_inventory WHERE code = ANY($1::text[]) OR lower(btrim(code)) = ANY($2::text[])', [[...codes], [...codes].map(x => x.toLowerCase())]);
  found = new Set(rows.map(x => x.code));
} finally { await pool.end(); }
const matched = prepared.filter(x => found.has(x.code));
const unmatched = prepared.filter(x => !found.has(x.code)).map(x => ({code:x.code,sourceRow:x.sourceRow,candidates:[...found].filter(y => y.trim().toLowerCase() === x.code.toLowerCase())}));
const store = createAccessStore(new URL('../data/access.sqlite', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let replaced = 0, inserted = 0;
try {
  if (apply) store.transaction(() => {
    const now = new Date().toISOString();
    // Keep links for codes not yet registered in SML. The read API resolves them
    // by exact code once the product appears, without another import.
    for (const item of prepared) {
      const existing = store.get('SELECT 1 FROM product_images WHERE code=?', item.code);
      if (existing) replaced++; else inserted++;
      store.run('INSERT INTO product_images(code,links_json,updated_by,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json,updated_by=NULL,updated_at=excluded.updated_at',item.code,JSON.stringify(item.links),now);
      store.run('INSERT INTO product_image_imports(code,product_name,source_name,source_row,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET product_name=excluded.product_name,source_name=excluded.source_name,source_row=excluded.source_row,updated_at=excluded.updated_at',item.code,item.name,sourceName || 'spreadsheet',item.sourceRow,now);
    }
    store.run("INSERT INTO activity_logs(user_id,action,module,details) VALUES(NULL,'product_images.import','products',?)",JSON.stringify({source:sourceName || 'spreadsheet',matched:matched.length,pending:unmatched.length,replaced,inserted}));
  });
  else for (const item of prepared) {
    if (store.get('SELECT 1 FROM product_images WHERE code=?',item.code)) replaced++; else inserted++;
  }
} finally { store.close(); }
console.log(JSON.stringify({mode:apply?'applied':'dry-run',products:prepared.length,matched:matched.length,pending:unmatched,replaced,inserted,totalLinks:prepared.reduce((n,x)=>n+x.links.length,0)},null,2));
