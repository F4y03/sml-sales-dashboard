import fs from 'node:fs/promises';
import { createAccessStore } from '../src/models/accessStore.js';
import { normalizeImageLink } from '../product-images.js';

const read = async name => JSON.parse(await fs.readFile(`product-drive-transfer/${name}`, 'utf8'));
const { products } = await read('lazada-mapping-prepared.json');
const matched = new Set((await read('lazada-product-map-matched.json')).map(p => p.productUrl));
const receipts = await read('lazada-drive-receipts-complete.json');
const byUrl = new Map();
for (const r of receipts) if (!byUrl.has(r.source_url)) byUrl.set(r.source_url, r);
const canonical = url => {
  const u = new URL(url);
  // The existing scraper also collected site icons/banners. Only product assets qualify.
  if (u.hostname !== 'img.lazcdn.com' || !u.pathname.startsWith('/g/p/')) return null;
  return u.origin + u.pathname.replace(/(\.(?:jpg|jpeg|png|webp))_.*/i, '$1');
};
const rows = [];
let excluded = 0, duplicates = 0;
for (const p of products.filter(p => !matched.has(p.productUrl))) {
  const id = p.productUrl.match(/-i(\d+)/)?.[1];
  if (!id) throw new Error('Missing Lazada product ID');
  const images = new Map();
  for (const image of p.images) {
    const key = canonical(image.source_url);
    if (!key) { excluded++; continue; }
    if (images.has(key)) { duplicates++; continue; }
    const receipt = byUrl.get(image.source_url);
    const link = normalizeImageLink(receipt?.drive_url);
    if (!link.ok || link.driveId !== receipt.drive_id) throw new Error(`Invalid receipt for ${id}`);
    images.set(key, link.value);
  }
  rows.push({ url: p.productUrl, id, name: p.name, links: [...new Set(images.values())], sources: [...images.keys()] });
}
const report = { products: rows.length, withImages: rows.filter(r => r.links.length).length,
  withoutImages: rows.filter(r => !r.links.length).length,
  uniqueProductImages: new Set(rows.flatMap(r => r.sources)).size, excludedSiteImages: excluded, duplicateSizes: duplicates };
const apply = process.argv.includes('--apply');
if (apply) {
  const store = createAccessStore('data/access.sqlite');
  try {
    store.transaction(() => {
      for (const r of rows) store.run('INSERT INTO unmatched_product_images(source_url,source_id,product_name,links_json,image_sources_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_url) DO UPDATE SET product_name=excluded.product_name,links_json=excluded.links_json,image_sources_json=excluded.image_sources_json,updated_at=excluded.updated_at', r.url,r.id,r.name,JSON.stringify(r.links),JSON.stringify(r.sources),new Date().toISOString());
    });
    for (const r of rows) {
      const saved = store.get('SELECT links_json FROM unmatched_product_images WHERE source_url=?',r.url);
      if (saved.links_json !== JSON.stringify(r.links)) throw new Error(`Verification failed: ${r.id}`);
    }
  } finally { store.close(); }
  await fs.writeFile('product-drive-transfer/lazada-pending-audit.json', JSON.stringify({ report, rows },null,2));
}
console.log(JSON.stringify({ mode: apply ? 'applied-and-verified' : 'dry-run', ...report }));
