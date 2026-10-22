// Step 1: search a new picture folder for products that have no photo yet.
// Matches the product code, the code without its 3-digit prefix, and model tokens from the SML name
// (e.g. "PW-25", "PW25") against every folder/file name. Review hits by eye: spare parts often match
// the parent product's photos (a K-15 voice coil vs the K-15 speaker) — those are NOT valid.
// Usage: node --env-file=.env tools/product-images/match-folder.mjs "Y:/Graphics/<folder>" [--all]
//   --all  also report codes that already have photos (for appending new pictures)
// Output: test-results/match-<folder>.json  [{ code, name, hits: [relative paths] }]
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { smlPool, appDb, sheetImages, safeName } from './lib.mjs';

const root = process.argv[2]?.replace(/\\/g, '/').replace(/\/$/, '');
if (!root) throw new Error('usage: match-folder.mjs <folder> [--all]');
const all = process.argv.includes('--all');
const files = [];
const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) { if (!/#recycle|@eaDir/i.test(e.name)) walk(p); } else if (/\.(png|jpe?g|webp)$/i.test(e.name) && !e.name.startsWith('._')) files.push(p.slice(root.length + 1)); } };
walk(root);
const saved = new Set(appDb().prepare('SELECT code FROM product_images').all().map(r => r.code));
const sheet = await sheetImages();
const pool = smlPool();
const { rows } = await pool.query("SELECT DISTINCT ON (code) code, name_1 FROM ic_inventory WHERE code ~ '^9[0-9][0-9]' ORDER BY code, roworder DESC");
await pool.end();
const targets = rows.filter(r => all || (!saved.has(r.code) && !sheet[r.code.toUpperCase()]));
const flat = files.map(f => f.toUpperCase().replace(/[\s_]+/g, ' '));
const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const out = [];
for (const r of targets) {
  const tokens = new Set([r.code.toUpperCase(), r.code.slice(3).toUpperCase()]);
  for (const m of (r.name_1 || '').toUpperCase().matchAll(/\b[A-Z]{1,5}-?\d{1,5}[A-Z]{0,4}\b/g)) if (/-|\d{2}/.test(m[0])) tokens.add(m[0]);
  const good = [...tokens].filter(t => t.length >= 3);
  const variants = [...new Set(good.flatMap(t => [t, t.replace(/-/g, ''), t.replace(/^([A-Z]+)(\d)/, '$1-$2')]))];
  const re = new RegExp(`(^|[^A-Z0-9])(${variants.map(esc).join('|')})(?![A-Z0-9])`);
  const hits = files.filter((f, i) => re.test(flat[i]));
  if (hits.length) out.push({ code: r.code, name: r.name_1, hasPhotos: saved.has(r.code) || !!sheet[r.code.toUpperCase()], hits });
}
mkdirSync('test-results', { recursive: true });
const file = `test-results/match-${safeName(root.split('/').pop())}.json`;
writeFileSync(file, JSON.stringify({ root, files: files.length, matches: out }, null, 1));
console.log(`${files.length} รูปในโฟลเดอร์ | ตรวจ ${targets.length} รหัส | เจอ ${out.length} รหัส -> ${file}`);
for (const o of out) console.log(`${o.hasPhotos ? '[มีรูปแล้ว] ' : ''}${o.code} | ${o.name} | ${o.hits.length} | ${o.hits.slice(0, 3).join(' ; ')}`);
