// One-off history import for the TikTok / Lazada APIs: pulls <from>..today in chunks of at most 92 days, oldest first,
// one chunk at a time with a pause between them. Progress (last finished day) is kept in system_settings, so a restart
// resumes where it stopped and a finished backfill never runs again. Enabled by TIKTOK_BACKFILL_FROM / LAZADA_BACKFILL_FROM.
const DAY_MS = 86400000;
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function startBackfill({ store, name, from, today, runSync, isBusy, hasConnections, user,
  stepDays = 92, firstDelayMs = 120000, gapMs = 60000, retryMs = 600000, setTimer = setTimeout, log = console }) {
  if (!validDay(from)) return null;
  const key = `${name}_backfill_done`;
  let timer = null, stopped = false;
  const schedule = ms => { if (stopped) return; timer = setTimer(tick, ms); timer?.unref?.(); };
  async function tick() {
    if (isBusy() || !hasConnections()) return schedule(retryMs); // a manual/auto sync is running, or no shop connected yet
    const done = store.get('SELECT value FROM system_settings WHERE key=?', key)?.value;
    const start = done ? addDays(done, 1) : from, now = today();
    if (start > now) return; // finished
    const end = addDays(start, stepDays - 1) < now ? addDays(start, stepDays - 1) : now;
    try {
      await runSync(start, end, user);
      store.run('INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, end);
      log.info?.(`${name} backfill: ${start} → ${end} done`);
      schedule(gapMs);
    } catch (error) {
      log.error(`${name} backfill ${start} → ${end} failed:`, error.code || error.name, String(error.message || '').slice(0, 160));
      schedule(retryMs);
    }
  }
  schedule(firstDelayMs);
  return { tick, stop() { stopped = true; if (timer) clearTimeout(timer); } };
}
