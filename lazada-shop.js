// Lazada Open Platform: connect the seller once (Super Admin), then pull orders into the same marketplace tables
// the Seller Center uploads use. Same flow as tiktok-shop.js; see MARKETPLACE.md › Lazada API.
// Each sync is recorded as one marketplace_uploads row ("Lazada API …"), so the (platform, order_id) de-duplication,
// the upload history and "delete upload" all work exactly as for files. Like uploads, sync answers carry no figures.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { sameSite } from './auth.js';
import { saveMarketplaceUpload } from './marketplace.js';
import { requirePermission, requireSuperAdmin } from './src/middleware/access.js';
import { startBackfill } from './src/services/marketplaceBackfill.js';
import { createSecretVault } from './src/services/totpService.js';
import { LazadaApiError, bangkokDayStart, bangkokToday, createLazadaClient, mapLazadaOrder, mapLazadaTransaction } from './src/services/lazadaApi.js';

const STATE_MS = 10 * 60 * 1000, REFRESH_EARLY_MS = 24 * 60 * 60 * 1000, DAY_MS = 86400000, MAX_SYNC_DAYS = 92;
const SETTLE_DAYS = 60, FINANCE_WINDOW_DAYS = 90;
const digest = value => createHash('sha256').update(value).digest('hex');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const SYSTEM_USER = { id: null, full_name: 'ระบบ (Lazada API)' };

// Returns a usable access token, refreshing (and saving) it when it is close to expiry.
async function accessTokenFor(store, client, vault, conn, now = Date.now()) {
  if (conn.access_expires - now > REFRESH_EARLY_MS) return vault.open(conn.access_token);
  if (conn.refresh_expires <= now) throw new LazadaApiError('การเชื่อมต่อ Lazada หมดอายุ กรุณาให้ Super Admin กดเชื่อมต่อใหม่');
  const t = await client.refresh(vault.open(conn.refresh_token));
  store.run('UPDATE lazada_connections SET access_token=?,access_expires=?,refresh_token=?,refresh_expires=? WHERE seller_id=?',
    vault.seal(t.accessToken), t.accessExpires, vault.seal(t.refreshToken), t.refreshExpires, conn.seller_id);
  return t.accessToken;
}

// Pulls orders created on Bangkok days start..end (inclusive) and saves them. Returns counts for logging only.
export async function syncLazadaShop(store, client, vault, { conn, start, end, user, now = Date.now() }) {
  try {
    const accessToken = await accessTokenFor(store, client, vault, conn, now);
    const raw = await client.searchOrders({ accessToken, fromMs: bangkokDayStart(start), toMs: bangkokDayStart(end) + DAY_MS });
    const items = raw.length ? await client.itemsByOrder({ accessToken, orderIds: raw.map(o => String(o.order_id)) }) : new Map();
    const orders = raw.map(o => mapLazadaOrder(o, items.get(String(o.order_id)) || [])).filter(Boolean);
    // Fees/net payout from finance lines dated start..today (payout comes after the order).
    // A Finance API failure must not lose the orders: save them, then report the fee problem.
    let settlements = [], financeError = null;
    try {
      // Money lines dated start .. end + 60 days (orders settle after delivery; capped at today), asked in ≤ 90-day
      // windows because the finance API refuses ranges of 180 days or more. Later days come with the next syncs.
      const txs = [], until = bangkokToday(Math.min(bangkokDayStart(end) + SETTLE_DAYS * DAY_MS, now));
      for (let from = start; from <= until; from = bangkokToday(bangkokDayStart(from) + FINANCE_WINDOW_DAYS * DAY_MS)) {
        const to = bangkokToday(Math.min(bangkokDayStart(from) + (FINANCE_WINDOW_DAYS - 1) * DAY_MS, bangkokDayStart(until)));
        txs.push(...await client.transactions({ accessToken, startDay: from, endDay: to }));
      }
      settlements = txs.map(mapLazadaTransaction).filter(Boolean);
    } catch (error) {
      if (!(error instanceof LazadaApiError)) throw error;
      financeError = new LazadaApiError(`ดึงออเดอร์สำเร็จ แต่ดึงค่าธรรมเนียมไม่สำเร็จ (${error.message}) กรุณากดดึงข้อมูลอีกครั้งภายหลัง`, error.code);
    }
    if (orders.length || settlements.length) {
      const sha256 = digest(JSON.stringify([orders, settlements]));
      saveMarketplaceUpload(store, { platform: 'lazada', fileName: `Lazada API ${start} ถึง ${end} · ${conn.shop_name}`.slice(0, 200), sha256,
        user, parsed: { kinds: ['api'], orders, settlements, shopCode: conn.short_code || null }, shopId: conn.shop_id });
    }
    store.run('UPDATE lazada_connections SET last_sync_at=?,last_sync_error=NULL WHERE seller_id=?', new Date(now).toISOString(), conn.seller_id);
    if (financeError) throw financeError;
    return { orders: orders.length, settlements: settlements.length };
  } catch (error) {
    const message = error instanceof LazadaApiError ? error.message : 'ดึงข้อมูลจาก Lazada ไม่สำเร็จ';
    store.run('UPDATE lazada_connections SET last_sync_error=? WHERE seller_id=?', message.slice(0, 300), conn.seller_id);
    throw error;
  }
}

export function installLazadaShop(app, store, audit, env = process.env, { fetchImpl } = {}) {
  const vault = createSecretVault(env, store.path);
  const autoMinutes = Number(env.LAZADA_AUTO_SYNC_MINUTES || 0);
  const configured = () => !!(env.LAZADA_APP_KEY && env.LAZADA_APP_SECRET);
  const client = () => createLazadaClient({ appKey: env.LAZADA_APP_KEY, appSecret: env.LAZADA_APP_SECRET, ...(fetchImpl && { fetchImpl }) });
  // Must equal the Callback URL registered in the Lazada Open Platform app console.
  const redirectUri = req => env.LAZADA_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/lazada/callback`;
  const connections = () => store.all('SELECT * FROM lazada_connections ORDER BY shop_name');
  let running = null;
  const runSync = (start, end, user) => {
    if (running) throw new LazadaApiError('กำลังดึงข้อมูล Lazada อยู่ กรุณารอสักครู่');
    running = (async () => {
      const c = client();
      for (const conn of connections()) await syncLazadaShop(store, c, vault, { conn, start, end, user });
    })().finally(() => { running = null; });
    return running;
  };
  const back = (res, result) => res.redirect(303, '/marketplace.html?lazada=' + result + '#lazada');

  // Status only — never order counts or totals (lazada_sync users may lack marketplace_view).
  app.get('/api/lazada/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ configured: configured(), canConnect: req.auth?.role === 'super_admin', autoSyncMinutes: autoMinutes >= 30 ? autoMinutes : 0,
      connections: store.all(`SELECT c.seller_id AS id,c.shop_name AS lazadaShop,s.name AS shop,c.connected_at AS connectedAt,
        c.last_sync_at AS lastSyncAt,c.last_sync_error AS lastSyncError,c.refresh_expires AS expiresAt
        FROM lazada_connections c JOIN marketplace_shops s ON s.id=c.shop_id ORDER BY c.shop_name`) });
  });

  app.get('/api/lazada/connect', requireSuperAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!configured()) return back(res, 'not-configured');
    let active = store.all('SELECT id FROM marketplace_shops WHERE active=1');
    if (!active.length) { // first use from this page: create the dashboard shop the orders are saved under
      if (store.get('SELECT 1 FROM marketplace_shops WHERE name=?', 'Lazada')) return back(res, 'no-dashboard-shop');
      const id = Number(store.run('INSERT INTO marketplace_shops(name,active,created_at) VALUES(?,1,?)', 'Lazada', new Date().toISOString()).lastInsertRowid);
      audit.record(req.auth, 'marketplace.shop_create', 'marketplace', { id, name: 'Lazada' }, null, req.socket.remoteAddress);
      active = [{ id }];
    }
    const shop = req.query.shop ? active.find(s => s.id === Number(req.query.shop)) : active.length === 1 ? active[0] : null;
    if (!shop) return back(res, 'choose-shop');
    const state = randomBytes(32).toString('hex');
    store.transaction(() => {
      store.run('DELETE FROM lazada_oauth_states WHERE expires<=?', Date.now());
      store.run('INSERT INTO lazada_oauth_states VALUES(?,?,?,?)', digest(state), req.auth.id, shop.id, Date.now() + STATE_MS);
    });
    res.redirect(303, client().authorizeUrl(redirectUri(req), state));
  });

  // Lazada sends the browser back here after the seller approves (app console › Callback URL).
  app.get('/api/lazada/callback', requireSuperAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const state = String(req.query.state || ''), code = String(req.query.code || '');
    const saved = /^[a-f0-9]{64}$/.test(state) && store.get('SELECT * FROM lazada_oauth_states WHERE state_hash=?', digest(state));
    if (saved) store.run('DELETE FROM lazada_oauth_states WHERE state_hash=?', saved.state_hash);
    if (!saved || saved.expires <= Date.now() || saved.user_id !== req.auth.id) return back(res, 'expired');
    if (!code || code.length > 2048) return back(res, 'denied');
    let step = 'client';
    try {
      const c = client();
      step = 'token'; const t = await c.exchangeCode(code);
      step = 'seller'; const seller = await c.seller(t.accessToken);
      const sellerId = seller.sellerId || t.sellerId;
      if (!sellerId) return back(res, 'no-shop');
      const name = (seller.name || seller.shortCode || t.shortCode || sellerId).slice(0, 120);
      store.run(`INSERT INTO lazada_connections(seller_id,short_code,shop_name,shop_id,access_token,access_expires,refresh_token,refresh_expires,connected_by,connected_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(seller_id) DO UPDATE SET short_code=excluded.short_code,shop_name=excluded.shop_name,shop_id=excluded.shop_id,
        access_token=excluded.access_token,access_expires=excluded.access_expires,refresh_token=excluded.refresh_token,refresh_expires=excluded.refresh_expires,
        connected_by=excluded.connected_by,connected_at=excluded.connected_at,last_sync_error=NULL`,
        sellerId, (seller.shortCode || t.shortCode).slice(0, 40), name, saved.shop_id, vault.seal(t.accessToken), t.accessExpires, vault.seal(t.refreshToken), t.refreshExpires, req.auth.id, new Date().toISOString());
      audit.record(req.auth, 'lazada.connect', 'marketplace', { shop: name, shopId: saved.shop_id }, null, req.socket.remoteAddress);
      back(res, 'connected');
    } catch (error) {
      console.error(`Lazada connect failed at ${step}:`, error.code || error.name, String(error.message || '').slice(0, 200));
      back(res, 'failed');
    }
  });

  app.post('/api/lazada/sync', sameSite, requirePermission('lazada_sync'), express.json({ limit: '2kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { start, end } = req.body || {};
    if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / DAY_MS >= MAX_SYNC_DAYS)
      return res.status(400).json({ error: `กรุณาเลือกช่วงวันที่ให้ถูกต้อง ไม่เกิน ${MAX_SYNC_DAYS} วันต่อครั้ง` });
    if (!configured()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า Lazada API ในเซิร์ฟเวอร์' });
    if (!connections().length) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อร้าน Lazada กรุณาให้ Super Admin กดเชื่อมต่อก่อน' });
    try {
      await runSync(start, end, req.auth);
      audit.record(req.auth, 'lazada.sync', 'marketplace', { start, end }, null, req.socket.remoteAddress);
      res.json({ ok: true, message: 'ดึงข้อมูลจาก Lazada สำเร็จ' });
    } catch (error) {
      if (error instanceof LazadaApiError) return res.status(502).json({ error: error.message });
      console.error('Lazada sync failed:', error.code || error.name);
      res.status(500).json({ error: 'ดึงข้อมูลจาก Lazada ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });

  // Disconnecting only forgets the tokens; orders already saved stay in reports.
  app.delete('/api/lazada/connections/:id', sameSite, requireSuperAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id);
    if (!store.run('DELETE FROM lazada_connections WHERE seller_id=?', id).changes) return res.status(404).json({ error: 'ไม่พบการเชื่อมต่อนี้' });
    audit.record(req.auth, 'lazada.disconnect', 'marketplace', { id }, null, req.socket.remoteAddress);
    res.json({ ok: true });
  });

  // Optional: LAZADA_AUTO_SYNC_MINUTES (≥ 30) re-pulls the last 3 Bangkok days so status changes are picked up.
  if (autoMinutes >= 30 && configured()) {
    const timer = setInterval(() => {
      if (running || !connections().length) return;
      const today = bangkokToday(), start = bangkokToday(Date.now() - 2 * DAY_MS);
      runSync(start, today, SYSTEM_USER).catch(error => console.error('Lazada auto sync failed:', error.code || error.name));
    }, autoMinutes * 60000);
    timer.unref();
  }
  // Orders imported before provinces came from the postcode have none: re-run the backfill once so they are re-pulled
  // (orders are replaced by (platform, order_id), never duplicated).
  if (!store.get('SELECT 1 FROM system_settings WHERE key=?', 'lazada_province_refill_v1')) {
    store.run('DELETE FROM system_settings WHERE key=?', 'lazada_backfill_done');
    store.run('INSERT INTO system_settings(key,value) VALUES(?,?)', 'lazada_province_refill_v1', 'true');
  }
  // Optional: LAZADA_BACKFILL_FROM=YYYY-MM-DD imports the history from that day to today by itself (92-day chunks, resumable).
  if (configured()) startBackfill({ store, name: 'lazada', from: env.LAZADA_BACKFILL_FROM, today: () => bangkokToday(),
    runSync, isBusy: () => !!running, hasConnections: () => connections().length > 0, user: SYSTEM_USER });
}
