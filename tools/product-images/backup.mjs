// Step 6: copy every photo in use (dashboard + CSV) to the NAS backup, one folder per product:
//   <dest>/<หมวด>/<หมวดย่อย>/<รหัส - ชื่อ>/<รหัส>-01.jpg
//   <dest>/ฝากขาย/<ร้าน ฝxx000>/<รหัส - ชื่อ>/...   (consignment codes that have their own saved photos)
// Resumable: files already there are skipped, so re-running after new photos only copies the new ones.
// Progress: test-results/backup-progress.txt.  --check compares expected vs present without copying.
// Usage: node --env-file=.env tools/product-images/backup.mjs ["Y:/graphic_backup/รูปสินค้าทั้งหมด (2026-10-22)"] [--check]
import { existsSync, mkdirSync, copyFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { smlPool, appDb, driveDb, sheetImages, csvRows, driveIdOf, safeName } from './lib.mjs';

const DEST = (process.argv.slice(2).find(a => !a.startsWith('--')) || 'Y:/graphic_backup/รูปสินค้าทั้งหมด (2026-10-22)').replace(/\\/g, '/').replace(/\/?$/, '/');
const check = process.argv.includes('--check');
const db = appDb(), drive = driveDb();
const asItem = link => { const file = String(link).match(/^\/api\/products\/images\/files\/([a-f0-9]{32})/)?.[1]; if (file) return { key: 'f:' + file, file }; const id = driveIdOf(link); return id ? { key: 'd:' + id, id } : null; };
// Photos per product (case-insensitive code): dashboard list first, then CSV photos not already there.
const products = new Map();
const add = (code, items) => { const k = code.toUpperCase(); const p = products.get(k) || { code, list: [] }; for (const it of items) if (it && !p.list.some(x => x.key === it.key)) p.list.push(it); products.set(k, p); };
for (const r of db.prepare('SELECT code, links_json FROM product_images').all()) add(r.code, JSON.parse(r.links_json).map(asItem));
for (const [code, links] of Object.entries(await sheetImages())) add(code, links.map(asItem));
// Folder: first CSV category path (2 levels), else the SML group; consignment codes under ฝากขาย/<ร้าน>.
const csv = new Map((await csvRows()).filter(x => x['รหัสสินค้า']).map(x => [x['รหัสสินค้า'].toUpperCase(), x]));
const pool = smlPool();
const { rows: sml } = await pool.query('SELECT DISTINCT ON (i.code) i.code, i.name_1, COALESCE((SELECT MAX(g.name_1) FROM ic_group g WHERE g.code = i.group_main), i.group_main) AS grp FROM ic_inventory i ORDER BY i.code, i.roworder DESC');
await pool.end();
const smlBy = new Map(sml.map(r => [r.code.toUpperCase(), r]));
const folderOf = (up, code) => {
  const name = (smlBy.get(up)?.name_1 || csv.get(up)?.['ชื่อ'] || '').replace(/\s*\(@[^)]*\)\s*$/, '');
  const leaf = safeName(`${code} - ${name}`) + '/';
  if (code.startsWith('ฝ')) return `${DEST}ฝากขาย/${code.match(/^ฝ[^0-9]{2}[0-9]{3}/)?.[0] || 'อื่นๆ'}/${leaf}`;
  const c = csv.get(up), parent = c?.['หลัก'] ? csv.get(c['หลัก'].toUpperCase()) : null;
  const first = (c?.['หมวดหมู่'] || parent?.['หมวดหมู่'] || '').split(',')[0].trim();
  const parts = first ? first.split('>').map(safeName).filter(Boolean).slice(0, 2) : [safeName(smlBy.get(up)?.grp) || 'ไม่มีหมวด'];
  return DEST + parts.join('/') + '/' + leaf;
};
const pathOf = sid => { const p = []; for (let i = 0; i < 20 && sid; i++) { const r = drive.prepare('SELECT local_title FROM items WHERE stable_id=?').get(sid); if (!r) return null; p.unshift(r.local_title); sid = drive.prepare('SELECT parent_stable_id FROM stable_parents WHERE item_stable_id=?').get(sid)?.parent_stable_id; } return p; };
const localOf = id => { const r = drive.prepare('SELECT stable_id FROM items WHERE id=? AND trashed=0').get(id); const p = r && pathOf(r.stable_id); if (!p || !p.includes('My Drive')) return null; const f = 'G:/' + p.slice(p.indexOf('My Drive')).join('/'); return existsSync(f) ? f : null; };
const jobs = [];
for (const [up, { code, list }] of products) list.forEach((it, i) => jobs.push({ up, code, it, n: i + 1, dir: folderOf(up, code) }));
console.log(`สินค้า ${products.size} | รูป ${jobs.length} -> ${DEST}`);
const base = j => `${safeName(j.code)}-${String(j.n).padStart(2, '0')}`;
if (check) {
  const seen = new Map(); let miss = 0;
  for (const j of jobs) { if (!seen.has(j.dir)) seen.set(j.dir, existsSync(j.dir) ? readdirSync(j.dir) : []); if (!seen.get(j.dir).some(f => f.startsWith(base(j) + '.'))) { miss++; if (miss <= 20) console.log('  ขาด', j.dir + base(j)); } }
  console.log(`ควรมี ${jobs.length} | มี ${jobs.length - miss} | ขาด ${miss}`);
  process.exit(miss ? 1 : 0);
}
let done = 0, copied = 0; const failed = [];
const progress = () => writeFileSync('test-results/backup-progress.txt', `${done}/${jobs.length} = ${Math.floor(done * 100 / jobs.length)}% (copied ${copied}, failed ${failed.length})\n`);
mkdirSync('test-results', { recursive: true });
for (const j of jobs) {
  try {
    mkdirSync(j.dir, { recursive: true });
    const b = j.dir + base(j);
    if (j.it.file) {
      const f = db.prepare('SELECT mime, data FROM product_image_files WHERE id=?').get(j.it.file);
      const out = b + (f.mime === 'image/png' ? '.png' : f.mime === 'image/webp' ? '.webp' : '.jpg');
      if (!existsSync(out)) { writeFileSync(out, Buffer.from(f.data)); copied++; }
    } else {
      const local = localOf(j.it.id), out = b + (local?.match(/\.(jpe?g|png|webp)$/i)?.[0] || '.jpg').toLowerCase();
      if (!existsSync(out) || statSync(out).size === 0) {
        if (local) copyFileSync(local, out);
        else { const res = await fetch(`https://lh3.googleusercontent.com/d/${j.it.id}=s0`, { signal: AbortSignal.timeout(60000) }); if (!res.ok) throw new Error('HTTP ' + res.status); writeFileSync(out, Buffer.from(await res.arrayBuffer())); }
        copied++;
      }
    }
  } catch (e) { failed.push(`${j.code} #${j.n}: ${e.message}`); }
  done++; if (done % 10 === 0) progress();
}
progress();
writeFileSync('test-results/backup-failed.txt', failed.join('\n'));
console.log(`เสร็จ ${done} | คัดลอกใหม่ ${copied} | ไม่สำเร็จ ${failed.length}`);
