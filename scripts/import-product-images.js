// Import product image links from program 1 (product-sheet, http://127.0.0.1:3002/api/sheet)
// into the dashboard's product_images table (data/access.sqlite), matched by product code.
//
//   node --env-file=.env scripts/import-product-images.js            # dry run: report only, writes nothing
//   node --env-file=.env scripts/import-product-images.js --apply    # write codes that have no links yet
//   node --env-file=.env scripts/import-product-images.js --apply --overwrite   # also replace existing links
//   SHEET_URL=http://host:3002/api/sheet  to read another program-1 address
//
// Program 1 is only read over HTTP. SML is only read (read-only transaction) to confirm each code exists.
// Links use the same rules as the dashboard (public/product-image-links.js); invalid/folder links are skipped.
import pg from 'pg';
import { writeFile, mkdir } from 'node:fs/promises';
import { createAccessStore } from '../src/models/accessStore.js';
import { normalizeImageLink, MAX_IMAGES } from '../product-images.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply'), overwrite = args.has('--overwrite');
const sheetUrl = process.env.SHEET_URL || 'http://127.0.0.1:3002/api/sheet';

// 1) Read program 1
const response = await fetch(sheetUrl, { signal: AbortSignal.timeout(30000) }).catch(error => {
  throw new Error(`อ่านโปรแกรม 1 ไม่ได้ (${sheetUrl}) — เปิด product-sheet ก่อน: ${error.message}`);
});
if (!response.ok) throw new Error(`โปรแกรม 1 ตอบ HTTP ${response.status}`);
const sheet = await response.json();
const codeCol = sheet.headers.indexOf('รหัสสินค้า'), imageCol = sheet.headers.indexOf('ไฟล์รูปภาพ');
if (codeCol < 0 || imageCol < 0) throw new Error('ไม่พบคอลัมน์ "รหัสสินค้า" หรือ "ไฟล์รูปภาพ" ในโปรแกรม 1');

const source = new Map(); // code -> normalized links
const report = { rows: sheet.rows.length, noCode: 0, noImage: 0, duplicateCodes: [], badLinks: [], tooMany: [] };
for (const row of sheet.rows) {
  const code = String(row[codeCol] ?? '').trim();
  if (!code) { report.noCode++; continue; }
  const links = [];
  for (const raw of String(row[imageCol] ?? '').split(/[,\n]+/)) {
    const result = normalizeImageLink(raw);
    if (result.ok) { if (!links.includes(result.value)) links.push(result.value); }
    else if (result.reason !== 'empty') report.badLinks.push({ code, link: raw.trim().slice(0, 200), reason: result.reason });
  }
  if (!links.length) { report.noImage++; continue; }
  if (links.length > MAX_IMAGES) report.tooMany.push({ code, count: links.length });
  if (source.has(code)) { report.duplicateCodes.push(code); source.get(code).push(...links.filter(l => !source.get(code).includes(l))); }
  else source.set(code, links);
}

// 2) Match codes against the SML product register (exact match first, then trimmed/case-insensitive)
const pool = new pg.Pool({ max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000, options: '-c default_transaction_read_only=on' });
let smlCodes;
try {
  smlCodes = (await pool.query('SELECT code FROM ic_inventory WHERE code = ANY($1::text[]) OR lower(btrim(code)) = ANY($2::text[])',
    [[...source.keys()], [...source.keys()].map(c => c.toLowerCase())])).rows.map(r => r.code);
} finally { await pool.end(); }
const exact = new Set(smlCodes), loose = new Map(smlCodes.map(c => [c.trim().toLowerCase(), c]));
const matched = [], unmatched = [], remapped = [];
for (const [code, links] of source) {
  if (exact.has(code)) matched.push([code, links]);
  else if (loose.has(code.toLowerCase())) { const target = loose.get(code.toLowerCase()); remapped.push({ from: code, to: target }); matched.push([target, links]); }
  else unmatched.push(code);
}

// 3) Write (only with --apply)
const store = createAccessStore(new URL('../data/access.sqlite', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let written = 0, skippedExisting = 0;
const now = new Date().toISOString();
store.transaction(() => {
  for (const [code, links] of matched) {
    const existing = store.get('SELECT 1 FROM product_images WHERE code=?', code);
    if (existing && !overwrite) { skippedExisting++; continue; }
    if (!apply) { written++; continue; }
    store.run('INSERT INTO product_images(code,links_json,updated_by,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json,updated_at=excluded.updated_at',
      code, JSON.stringify(links.slice(0, MAX_IMAGES)), now);
    written++;
  }
  if (apply && written) store.run("INSERT INTO activity_logs(user_id,action,module,details) VALUES(NULL,'product_images.import','products',?)",
    JSON.stringify({ source: sheetUrl, written, overwrite }));
});
store.close();

const summary = {
  mode: apply ? (overwrite ? 'apply+overwrite' : 'apply') : 'dry-run (ไม่ได้เขียนอะไร)',
  sheetRows: report.rows, withImages: source.size, matchedInSML: matched.length, notInSML: unmatched.length,
  matchedAfterTrimOrCase: remapped.length, [apply ? 'written' : 'wouldWrite']: written, skippedHasLinks: skippedExisting,
  rowsWithoutCode: report.noCode, rowsWithoutImage: report.noImage, invalidLinks: report.badLinks.length,
  duplicateCodes: report.duplicateCodes.length, over20Images: report.tooMany.length,
};
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const reportFile = new URL('../test-results/import-product-images-report.json', import.meta.url);
await writeFile(reportFile, JSON.stringify({ summary, unmatched, remapped, ...report }, null, 2));
console.table(summary);
console.log('รายละเอียดทั้งหมด:', reportFile.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
