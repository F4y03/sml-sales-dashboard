// Exports only the product_images rows changed since a date (no users / sessions / uploads), for another
// machine whose access.sqlite is separate (e.g. SKISERVER). Refuses rows that still use uploaded-file links,
// because those files live only in this machine's DB — convert them to Drive links first.
// Usage: node tools/product-images/export-delta.mjs 2026-10-22 <out.json>
import { writeFileSync } from 'node:fs';
import { appDb } from './lib.mjs';

const [since, out] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(since || '') || !out) throw new Error('usage: export-delta.mjs <YYYY-MM-DD> <out.json>');
const rows = appDb().prepare('SELECT code, links_json, updated_at FROM product_images WHERE updated_at >= ? ORDER BY code').all(since);
const local = rows.filter(r => r.links_json.includes('/api/products/images/files/'));
if (local.length) throw new Error('uploaded-file links (not portable): ' + local.map(r => r.code).join(' '));
writeFileSync(out, JSON.stringify({ since, exportedAt: new Date().toISOString(), images: rows }, null, 1));
console.log(`ส่งออก ${rows.length} รหัส -> ${out}`);
