// History backfill for the TikTok / Lazada APIs: 92-day chunks oldest first, resumable, retries, stops at today.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccessStore } from '../src/models/accessStore.js';
import { startBackfill } from '../src/services/marketplaceBackfill.js';

function setup({ from = '2025-07-01', today = '2026-01-15', busy = false, connected = true, fail = () => false } = {}) {
  const store = createAccessStore(':memory:', {});
  const calls = [], timers = [];
  const job = startBackfill({ store, name: 'tiktok', from, today: () => today, user: { id: null },
    runSync: async (start, end) => { calls.push([start, end]); if (fail(calls.length)) throw new Error('rate limit'); },
    isBusy: () => busy, hasConnections: () => connected,
    setTimer: (fn, ms) => { timers.push(ms); return null; }, log: { info() {}, error() {} } });
  return { store, calls, timers, job, done: () => store.get("SELECT value FROM system_settings WHERE key='tiktok_backfill_done'")?.value };
}

test('pulls 92-day chunks oldest first until today, then stops', async t => {
  const s = setup();
  t.after(() => s.store.close());
  for (let i = 0; i < 6; i++) await s.job.tick();
  assert.deepEqual(s.calls, [['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-01-15']]);
  assert.equal(s.done(), '2026-01-15');
});

test('resumes after a restart and retries a failed chunk without skipping it', async t => {
  const s = setup({ fail: n => n === 2 });
  t.after(() => s.store.close());
  await s.job.tick(); // chunk 1 ok
  await s.job.tick(); // chunk 2 fails: progress stays at chunk 1
  assert.equal(s.done(), '2025-09-30');
  assert.equal(s.timers.at(-1), 600000); // retry later
  const again = startBackfill({ store: s.store, name: 'tiktok', from: '2025-07-01', today: () => '2026-01-15', user: {},
    runSync: async (a, b) => s.calls.push([a, b]), isBusy: () => false, hasConnections: () => true, setTimer: () => null, log: { info() {}, error() {} } });
  await again.tick(); // "restart": continues from the failed chunk
  assert.deepEqual(s.calls.at(-1), ['2025-10-01', '2025-12-31']);
});

test('waits while another sync runs or no shop is connected; disabled without a valid start day', async t => {
  const busy = setup({ busy: true }), none = setup({ connected: false });
  t.after(() => { busy.store.close(); none.store.close(); });
  await busy.job.tick(); await none.job.tick();
  assert.equal(busy.calls.length + none.calls.length, 0);
  assert.equal(setup({ from: '' }).job, null);
  assert.equal(setup({ from: '2025-02-30' }).job, null);
});
