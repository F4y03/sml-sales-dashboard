// Step 0: where we stand. Prints CSV completeness and writes the to-do lists:
//   test-results/no-image-codes.txt   SML main codes (9xx) with no photo anywhere
//   test-results/not-in-csv.txt       SML main codes missing from the CSV (ซ่อน = hidden on purpose)
// Usage: node --env-file=.env tools/product-images/status.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { smlPool, appDb, sheetImages, csvRows, HIDDEN } from './lib.mjs';

mkdirSync('test-results', { recursive: true });
const d = await csvRows();
const pi = new Map();
for (const x of d) if (x['ชนิด'] === 'variable') { pi.set(x['รหัสสินค้า'].toLowerCase(), !!x['ไฟล์รูปภาพ']); if (x.ID) pi.set('id:' + x.ID, !!x['ไฟล์รูปภาพ']); }
const shown = x => x['ไฟล์รูปภาพ'] || (x['ชนิด'] === 'variation' && pi.get((x['หลัก'] || '').toLowerCase()));
const page = d.filter(x => x['ชนิด'] !== 'variation'), sell = d.filter(x => x['ชนิด'] !== 'variable');
console.log(`CSV ${d.length} แถว | มีรูป ${d.filter(shown).length} | ไม่มีรูป ${d.filter(x => !shown(x)).length}`);
console.log(`ไม่มีราคา ${sell.filter(x => !x['ราคาปกติ']).length} | ไม่มีคำอธิบาย ${page.filter(x => !x['คำอธิบาย']).length} | ไม่มีแบรนด์ ${page.filter(x => !x['แบรนด์']).length} | ไม่มีหมวด ${page.filter(x => !x['หมวดหมู่']).length} | ไม่มีขนาดกล่อง ${sell.filter(x => !x['น้ำหนัก (กก.)']).length} | ไม่มีรหัส ${d.filter(x => !x['รหัสสินค้า']).length}`);

const saved = new Set(appDb().prepare('SELECT code FROM product_images').all().map(r => r.code));
const sheet = await sheetImages();
const pool = smlPool();
const { rows } = await pool.query("SELECT DISTINCT ON (code) code, name_1 FROM ic_inventory WHERE code ~ '^9[0-9][0-9]' ORDER BY code, roworder DESC");
await pool.end();
const inCsv = new Set(d.map(x => x['รหัสสินค้า'].toLowerCase()));
const hidden = JSON.parse(readFileSync(HIDDEN, 'utf8'));
const noImg = rows.filter(r => !saved.has(r.code) && !sheet[r.code.toUpperCase()]);
const notIn = rows.filter(r => !inCsv.has(r.code.toLowerCase()));
writeFileSync('test-results/no-image-codes.txt', noImg.map(r => `${r.code} | ${r.name_1}`).join('\n'));
writeFileSync('test-results/not-in-csv.txt', notIn.map(r => `${hidden[r.code.toLowerCase()] ? 'ซ่อน' : 'ไม่มี'} | ${r.code} | ${r.name_1}`).join('\n'));
console.log(`SML 9xx ${rows.length} | อยู่ใน CSV ${rows.length - notIn.length} | ไม่อยู่ ${notIn.length} (ซ่อน ${notIn.filter(r => hidden[r.code.toLowerCase()]).length}) | ไม่มีรูปเลย ${noImg.length}`);
