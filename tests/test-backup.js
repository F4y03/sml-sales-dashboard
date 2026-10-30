// Daily backup: consistent SQLite copy + 2fa.key in a per-day folder, old days pruned, one backup per Bangkok day.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAccessStore } from '../src/models/accessStore.js';
import { runBackup } from '../src/services/backup.js';

test('backup copies the live database and 2fa.key, replaces the same day, keeps the newest N days', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bk-')), dataDir = join(root, 'data'), dir = join(root, 'backups');
  const store = createAccessStore(join(dataDir, 'access.sqlite'), {});
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(join(dataDir, '2fa.key'), 'k'.repeat(64));
  store.run("INSERT INTO system_settings(key,value) VALUES('probe','v1')");
  const day = ms => Date.parse(`2026-10-${String(ms).padStart(2, '0')}T05:00:00Z`);
  const first = await runBackup(store, { dir, now: day(1), keepDays: 2 });
  assert.ok(existsSync(join(first, '2fa.key')));
  const copy = new DatabaseSync(join(first, 'access.sqlite'), { readOnly: true });
  assert.equal(copy.prepare("SELECT value FROM system_settings WHERE key='probe'").get().value, 'v1'); // readable, consistent copy
  copy.close();
  await runBackup(store, { dir, now: day(2), keepDays: 2 });
  await runBackup(store, { dir, now: day(3), keepDays: 2 });
  await runBackup(store, { dir, now: day(3) + 3600000, keepDays: 2 }); // same day again: replaced, not duplicated
  assert.deepEqual(readdirSync(dir).sort(), ['2026-10-02', '2026-10-03']); // oldest pruned, no leftover temp folder
});
