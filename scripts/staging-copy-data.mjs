// Refresh the staging copy of the access store from live (consistent snapshot via VACUUM INTO).
// Run from the worktree root while staging is stopped: node scripts/staging-copy-data.mjs
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const live = fileURLToPath(new URL('../../dashboard/data/', import.meta.url));
const dest = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dest, { recursive: true });
for (const f of ['access.sqlite', 'access.sqlite-wal', 'access.sqlite-shm']) rmSync(dest + f, { force: true });
const db = new DatabaseSync(live + 'access.sqlite', { readOnly: true });
db.prepare('VACUUM INTO ?').run(dest + 'access.sqlite');
db.close();
if (existsSync(live + '2fa.key')) copyFileSync(live + '2fa.key', dest + '2fa.key');
console.log('staging data copied to', dest);
