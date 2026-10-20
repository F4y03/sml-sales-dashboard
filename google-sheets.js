// Google Sheets copy of the online-sales data: export every few hours + a Super Admin "export now" button. See MARKETPLACE.md › Google Sheets.
// Needs GOOGLE_SHEETS_KEY_FILE (service account key in data/) and GOOGLE_SHEETS_ID; optional GOOGLE_SHEETS_EVERY_HOURS (default 5, minimum 1).
import { sameSite } from './auth.js';
import { requireSuperAdmin } from './src/middleware/access.js';
import { GoogleSheetsError, OLD_TABS, buildExportTabs, createSheetsClient, loadServiceAccount } from './src/services/googleSheets.js';

const HOUR_MS = 3600000;
const setting = (store, key) => store.get('SELECT value FROM system_settings WHERE key=?', key)?.value ?? null;
const save = (store, key, value) => store.run('INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);

export function installGoogleSheets(app, store, audit, env = process.env, { fetchImpl, now = () => Date.now() } = {}) {
  const configured = () => !!(env.GOOGLE_SHEETS_KEY_FILE && env.GOOGLE_SHEETS_ID);
  const everyHours = Math.max(1, Number(env.GOOGLE_SHEETS_EVERY_HOURS) || 5);
  let running = null;

  const exportNow = () => {
    if (running) throw new GoogleSheetsError('กำลังส่งข้อมูลไป Google Sheets อยู่ กรุณารอสักครู่');
    running = (async () => {
      try {
        const client = createSheetsClient({ account: loadServiceAccount(env.GOOGLE_SHEETS_KEY_FILE), ...(fetchImpl && { fetchImpl }), now });
        const tabs = buildExportTabs(store, new Date(now()));
        await client.writeTabs(env.GOOGLE_SHEETS_ID, tabs, OLD_TABS);
        save(store, 'google_sheets_last_at', new Date(now()).toISOString());
        save(store, 'google_sheets_last_error', '');
        return { tabs: tabs.length };
      } catch (error) {
        save(store, 'google_sheets_last_error', (error instanceof GoogleSheetsError ? error.message : 'ส่งข้อมูลไป Google Sheets ไม่สำเร็จ').slice(0, 300));
        throw error;
      }
    })().finally(() => { running = null; });
    return running;
  };

  app.get('/api/google-sheets/status', requireSuperAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ configured: configured(), everyHours, lastExportAt: setting(store, 'google_sheets_last_at'), lastError: setting(store, 'google_sheets_last_error') || null,
      url: configured() ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(env.GOOGLE_SHEETS_ID)}/edit` : null });
  });

  app.post('/api/google-sheets/export', sameSite, requireSuperAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!configured()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า GOOGLE_SHEETS_KEY_FILE / GOOGLE_SHEETS_ID ใน .env' });
    try {
      await exportNow();
      audit.record(req.auth, 'google_sheets.export', 'marketplace', null, null, req.socket.remoteAddress);
      res.json({ ok: true, message: 'ส่งข้อมูลไป Google Sheets สำเร็จ' });
    } catch (error) {
      if (error instanceof GoogleSheetsError) return res.status(502).json({ error: error.message });
      console.error('Google Sheets export failed:', error.code || error.name);
      res.status(500).json({ error: 'ส่งข้อมูลไป Google Sheets ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });

  // Every GOOGLE_SHEETS_EVERY_HOURS since the last successful export (checked every 10 minutes, so a restart catches up).
  // A failed export is retried on the next check.
  const tick = () => {
    if (!configured() || running) return;
    const last = Date.parse(setting(store, 'google_sheets_last_at') || '');
    if (Number.isFinite(last) && now() - last < everyHours * HOUR_MS) return;
    exportNow().catch(error => console.error('Google Sheets scheduled export failed:', error.code || error.name, String(error.message || '').slice(0, 160)));
  };
  if (configured()) setInterval(tick, 10 * 60000).unref();
  return { exportNow, tick };
}
