// Step 5: put the synced Drive photos on the products — dashboard popup (data/access.sqlite product_images)
// and website CSV (product-sheet/data/image-overrides.json). New photos go AFTER the current ones (max 20).
// Backs up both stores to data/backups/ before writing. Dry run unless --apply.
// Usage: node tools/product-images/apply.mjs test-results/x-manifest.json "<source label>" [--apply]
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { appDb, sheetImages, OVERRIDES, driveIdOf } from './lib.mjs';

const [manifest, label = 'product images'] = process.argv.slice(2).filter(a => a !== '--apply');
const apply = process.argv.includes('--apply');
if (!manifest) throw new Error('usage: apply.mjs <manifest.json> "<label>" [--apply]');
const items = JSON.parse(readFileSync(manifest, 'utf8'));
const ids = JSON.parse(readFileSync(manifest.replace(/\.json$/, '.ids.json'), 'utf8'));
const sheet = await sheetImages();
const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const db = appDb(false);
const view = id => `https://drive.google.com/file/d/${id}/view`;
const MAX = 20, now = new Date().toISOString(), stamp = now.replace(/[:.]/g, '-');
const add = {};
for (const it of items) {
  const id = ids[it.out.split('/').slice(-2).join('/')];
  if (!id) throw new Error('not synced yet (run drive-ids.mjs --save again): ' + it.out);
  (add[it.code] ??= []).push(id);
}
let dash = 0, csv = 0;
if (apply) { db.exec(`VACUUM INTO 'data/backups/access-before-images-${stamp}.sqlite'`); copyFileSync(OVERRIDES, `data/backups/image-overrides-before-${stamp}.json`); db.exec('BEGIN'); }
try {
  for (const [code, newIds] of Object.entries(add)) {
    // Dashboard: its saved list, or else the sheet photos the popup was showing, then the new ones.
    const row = db.prepare('SELECT links_json FROM product_images WHERE code=?').get(code);
    const current = row ? JSON.parse(row.links_json) : (sheet[code.toUpperCase()] || []).map(driveIdOf).filter(Boolean).map(view);
    const links = [...current, ...newIds.map(view).filter(l => !current.includes(l))].slice(0, MAX);
    if (links.length > current.length) {
      dash++;
      if (apply) db.prepare('INSERT INTO product_images(code,links_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json, updated_at=excluded.updated_at').run(code, JSON.stringify(links), null, now);
    }
    // CSV: an override replaces the row's photos, so keep the current sheet photos first.
    const key = code.toLowerCase();
    const base = overrides[key]?.images || (sheet[code.toUpperCase()] || []).map(driveIdOf).filter(Boolean);
    const merged = [...base, ...newIds.filter(id => !base.includes(id))].slice(0, MAX);
    if (merged.length > base.length) {
      csv++;
      overrides[key] = { ...(overrides[key] || {}), code, images: merged, source: [overrides[key]?.source, label].filter(Boolean).join(' + '), updatedAt: now };
    }
  }
  if (apply) { db.exec('COMMIT'); writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2)); }
} catch (e) { if (apply) db.exec('ROLLBACK'); throw e; }
console.log(`${Object.keys(add).length} รหัส | แดชบอร์ด ${dash} | CSV ${csv} ${apply ? '(บันทึกแล้ว)' : '(ทดลอง — เพิ่ม --apply เพื่อบันทึก)'}`);
