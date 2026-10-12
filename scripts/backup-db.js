// Backs up the app database (data/access.sqlite: users, roles, marketplace uploads) to a dated snapshot.
// VACUUM INTO writes a consistent copy even while the server is running (WAL included). SML is not touched.
// Usage: node scripts/backup-db.js [--dest <folder>] [--keep <days>]   (default: data/backups, keep 30 days)
// Backups hold password hashes and 2FA data: keep the folder private and never commit it.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const dest = resolve(arg('--dest') || join(root, 'data', 'backups'));
const keepDays = Number(arg('--keep') || 30);
if (!Number.isFinite(keepDays) || keepDays < 1) throw new Error('--keep must be a number of days >= 1');

const source = join(root, 'data', 'access.sqlite');
if (!existsSync(source)) throw new Error(`Database not found: ${source}`);
mkdirSync(dest, { recursive: true });

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const target = join(dest, `access-${stamp}.sqlite`);

const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout=10000');
  db.prepare('VACUUM INTO ?').run(target);
} finally {
  db.close();
}
const check = new DatabaseSync(target, { readOnly: true });
const ok = check.prepare('PRAGMA integrity_check').get();
check.close();
if (Object.values(ok)[0] !== 'ok') throw new Error(`Backup failed integrity check: ${target}`);

// The 2FA key decrypts stored 2FA secrets; a restore needs the matching key.
const key = join(root, 'data', '2fa.key');
if (existsSync(key)) copyFileSync(key, join(dest, `2fa-${stamp}.key`));

const cutoff = Date.now() - keepDays * 86400000;
let removed = 0;
for (const name of readdirSync(dest)) {
  if (!/^(access-.+\.sqlite|2fa-.+\.key)$/.test(name)) continue;
  const path = join(dest, name);
  if (statSync(path).mtimeMs < cutoff) { unlinkSync(path); removed++; }
}
console.log(`Backup OK: ${target} (${Math.round(statSync(target).size / 1024)} KB), removed ${removed} old file(s)`);
