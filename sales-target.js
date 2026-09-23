// Sales target for the executive summary, stored in the app's access database (never in SML).
// A target belongs to a calendar month ("month:YYYY-MM") or, for ranges spanning months, to that exact range.
// Territory-scoped sessions keep their own target so they never overwrite the company-wide one.
import { sameSite } from './auth.js';

const KEY_PATTERN = /^(month:\d{4}-(0[1-9]|1[0-2])|range:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2})$/;
const MAX_TARGET = 1e12;

export function installSalesTarget(app, store, audit) {
  const storageKey = (req, key) => `sales_target:${req.territory?.id ? 't' + req.territory.id : 'all'}:${key}`;
  const read = (req, key) => {
    const row = store.get('SELECT value FROM system_settings WHERE key=?', storageKey(req, key));
    if (!row) return { key, amount: null };
    try {
      const saved = JSON.parse(row.value);
      return { key, amount: Number(saved.amount), updatedAt: saved.updatedAt };
    } catch {
      return { key, amount: null };
    }
  };
  app.get('/api/executive/target', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { key } = req.query;
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return res.status(400).json({ error: 'ช่วงของเป้าไม่ถูกต้อง' });
    res.json(read(req, key));
  });
  app.put('/api/executive/target', sameSite, (req, res) => {
    const { key, amount } = req.body || {};
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return res.status(400).json({ error: 'ช่วงของเป้าไม่ถูกต้อง' });
    const clear = amount === null;
    if (!clear && (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_TARGET || Math.round(amount * 100) !== amount * 100))
      return res.status(400).json({ error: 'กรอกเป้ามากกว่า 0 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง' });
    const id = storageKey(req, key),
      updatedAt = new Date().toISOString();
    store.transaction(() => {
      if (clear) store.run('DELETE FROM system_settings WHERE key=?', id);
      else
        store.run(
          'INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          id,
          JSON.stringify({ amount, updatedAt, by: req.auth.id }),
        );
      audit.record(req.auth, 'sales_target.set', 'settings', { key, amount: clear ? null : amount }, req.territory?.id ?? null, req.socket.remoteAddress);
    });
    res.json(clear ? { key, amount: null } : { key, amount, updatedAt });
  });
}
