// Step 4: after copying rendered files into G:/My Drive/wed/product/Lim 2026, wait for Drive for Desktop to sync.
// Prints "synced/total = %" and, with --save, writes <manifest>.ids.json (file -> Drive ID) for apply.mjs.
// Usage: node tools/product-images/drive-ids.mjs test-results/x-manifest.json [--save]
import { readFileSync, writeFileSync } from 'node:fs';
import { driveDb } from './lib.mjs';

const manifest = process.argv[2];
if (!manifest) throw new Error('usage: drive-ids.mjs <manifest.json> [--save]');
const items = JSON.parse(readFileSync(manifest, 'utf8'));
const d = driveDb();
const folder = d.prepare("SELECT stable_id FROM items WHERE local_title='Lim 2026' AND is_folder=1 AND trashed=0").get();
const ids = {};
if (folder) {
  const kids = sid => d.prepare('SELECT i.stable_id, i.id, i.local_title, i.is_folder FROM stable_parents p JOIN items i ON i.stable_id=p.item_stable_id WHERE p.parent_stable_id=? AND i.trashed=0').all(sid);
  for (const sub of kids(folder.stable_id)) for (const f of kids(sub.stable_id))
    if (!f.is_folder && /^[\w-]{25,}$/.test(f.id) && !f.id.startsWith('local')) ids[`${sub.local_title}/${f.local_title}`] = f.id; // "local-…" = not uploaded yet
}
const done = items.filter(it => ids[it.out.split('/').slice(-2).join('/')]).length;
console.log(`${done}/${items.length} = ${Math.floor(done * 100 / items.length)}%`);
if (process.argv.includes('--save')) writeFileSync(manifest.replace(/\.json$/, '.ids.json'), JSON.stringify(ids, null, 1));
