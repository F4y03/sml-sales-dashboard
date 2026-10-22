// Checks every image under a folder is complete (JPEG ends FFD9, PNG has IEND, WebP size matches).
// Use after a backup — especially if the PC lost power mid-copy. Broken files: delete them and re-run backup.mjs.
// Usage: node tools/product-images/verify-files.mjs "Y:/graphic_backup/รูปสินค้าทั้งหมด (2026-10-22)"
import { readdirSync, readFileSync } from 'node:fs';

const root = process.argv[2];
if (!root) throw new Error('usage: verify-files.mjs <folder>');
const bad = []; let n = 0;
const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = dir + '/' + e.name; if (e.isDirectory()) walk(p); else if (!/thumbs\.db$/i.test(e.name)) check(p); } };
function check(p) {
  n++;
  const b = readFileSync(p);
  const ok = b.length > 100 && (
    (b[0] === 0xff && b[1] === 0xd8 && b.subarray(-64).includes(Buffer.from([0xff, 0xd9]))) ||
    (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' && b.subarray(-16).includes(Buffer.from('IEND'))) ||
    (b.toString('latin1', 0, 4) === 'RIFF' && b.readUInt32LE(4) + 8 <= b.length));
  if (!ok) bad.push(p);
}
walk(root.replace(/\\/g, '/').replace(/\/$/, ''));
console.log(`ไฟล์ ${n} | เสีย ${bad.length}`);
bad.forEach(p => console.log('  ', p));
process.exit(bad.length ? 1 : 0);
