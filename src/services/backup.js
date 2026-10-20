// Daily local backup of the dashboard's own database (never SML): data/access.sqlite through SQLite's online backup
// (consistent while the server runs; a plain file copy can catch a half-written page) plus data/2fa.key, which is
// needed to decrypt 2FA secrets and marketplace tokens after a restore. One folder per day, the newest KEEP_DAYS kept.
// Folder: BACKUP_DIR, default <repo>/../backups (outside the repo, so never in Git).
import { backup } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const bangkokDay = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);

export function backupDir(store, env = process.env) {
  return resolve(env.BACKUP_DIR || join(dirname(store.path), '..', '..', 'backups'));
}

// Writes <dir>/<YYYY-MM-DD>/ (replacing that day's folder) and prunes old day folders. Returns the folder.
export async function runBackup(store, { dir, now = Date.now(), keepDays = 30 } = {}) {
  const day = bangkokDay(now), target = join(dir, day), tmp = join(dir, `.${day}.tmp`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  await backup(store.db, join(tmp, 'access.sqlite'));
  const key = join(dirname(store.path), '2fa.key');
  if (existsSync(key)) copyFileSync(key, join(tmp, '2fa.key'));
  rmSync(target, { recursive: true, force: true });
  renameSync(tmp, target); // a half-finished backup never looks like a finished one
  const days = readdirSync(dir).filter(name => DAY.test(name)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - keepDays))) rmSync(join(dir, old), { recursive: true, force: true });
  return target;
}

// Once per Bangkok day (checked hourly, plus shortly after start), so a restart or a missed night catches up.
export function startDailyBackup(store, env = process.env, { now = Date.now, log = console } = {}) {
  if (store.path === ':memory:' || env.BACKUP_DISABLED === 'true') return null;
  const dir = backupDir(store, env), keepDays = Math.max(1, Number(env.BACKUP_KEEP_DAYS) || 30);
  const last = () => store.get('SELECT value FROM system_settings WHERE key=?', 'backup_last_at')?.value || null;
  let running = false;
  const tick = async () => {
    const at = last();
    if (running || (at && bangkokDay(Date.parse(at)) === bangkokDay(now()))) return;
    running = true;
    try {
      await runBackup(store, { dir, now: now(), keepDays });
      store.run('INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'backup_last_at', new Date(now()).toISOString());
    } catch (error) {
      log.error('Daily backup failed:', error.code || error.name, String(error.message || '').slice(0, 160));
    } finally { running = false; }
  };
  setTimeout(tick, 60000).unref();
  setInterval(tick, 3600000).unref();
  return { dir, tick, lastAt: last };
}
