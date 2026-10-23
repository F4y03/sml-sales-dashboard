// Run on the receiving machine (e.g. SKISERVER) from the project folder:
//   node tools/product-images/import-delta.mjs <delta.json>            (dry run: shows what would change)
//   node tools/product-images/import-delta.mjs <delta.json> --apply    (backs up data/access.sqlite first)
// Writes only the codes in the file. A code edited on this machine AFTER the delta was made is skipped,
// so nobody's later edits are overwritten. Restart the dashboard afterwards is not needed (read per request).
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [file] = process.argv.slice(2).filter(a => a !== '--apply');
const apply = process.argv.includes('--apply');
if (!file) throw new Error('usage: import-delta.mjs <delta.json> [--apply]');
const { images, exportedAt } = JSON.parse(readFileSync(file, 'utf8'));
const db = new DatabaseSync('data/access.sqlite');
let write = 0, same = 0, newer = [];
const plan = [];
for (const r of images) {
  const cur = db.prepare('SELECT links_json, updated_at FROM product_images WHERE code=?').get(r.code);
  if (cur?.links_json === r.links_json) { same++; continue; }
  if (cur && cur.updated_at > exportedAt) { newer.push(r.code); continue; }
  plan.push(r); write++;
}
if (apply && plan.length) {
  mkdirSync('data/backups', { recursive: true });
  db.exec(`VACUUM INTO 'data/backups/access-before-import-delta-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite'`);
  db.exec('BEGIN');
  try {
    for (const r of plan) db.prepare('INSERT INTO product_images(code,links_json,updated_by,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json, updated_by=NULL, updated_at=excluded.updated_at').run(r.code, r.links_json, r.updated_at);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
console.log(`ในไฟล์ ${images.length} | จะเขียน ${write} | เหมือนเดิม ${same} | ข้าม (มีคนแก้ทีหลัง) ${newer.length}${newer.length ? ': ' + newer.join(' ') : ''} ${apply ? '(บันทึกแล้ว)' : '(ทดลอง — เพิ่ม --apply เพื่อบันทึก)'}`);
