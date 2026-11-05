// TikTok Shop Open API: connect the shop once (Super Admin), then pull orders into the same marketplace tables
// the Seller Center uploads use. See MARKETPLACE.md › TikTok Shop API.
// Each sync is recorded as one marketplace_uploads row ("TikTok API …"), so the (platform, order_id) de-duplication,
// the upload history and "delete upload" all work exactly as for files. Like uploads, sync answers carry no figures.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { sameSite } from '../middleware/auth.js';
import { saveMarketplaceUpload } from './marketplace.js';
import { requirePermission, requireSuperAdmin } from '../middleware/access.js';
import { startBackfill } from '../services/marketplaceBackfill.js';
import { createSecretVault } from '../services/totpService.js';
import { accessToken } from '../services/marketplaceTokens.js';
import { TikTokApiError, bangkokDate, bangkokDayStart, createTikTokClient, mapTikTokOrder, mapTikTokSettlement } from '../services/tiktokShopApi.js';

const STATE_MS = 10 * 60 * 1000, REFRESH_EARLY_MS = 6 * 60 * 60 * 1000, DAY_MS = 86400000, MAX_SYNC_DAYS = 92;
const digest = value => createHash('sha256').update(value).digest('hex');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const SYSTEM_USER = { id: null, full_name: 'ระบบ (TikTok API)' };

// TikTok in-house apps from .env. An in-house app can only be authorised by its own seller's shops, so each seller company
// gets its own app: TIKTOK_APP_KEY / _SECRET / TIKTOK_SERVICE_ID (id '') and the same names ending _2 … _9 (id '2' … '9').
// TIKTOK_APP_SHOP_<n> = dashboard shop name that app connects; shops without their own app use the unsuffixed one.
export function tiktokApps(env) {
  const apps = [];
  for (const suffix of ['', '_2', '_3', '_4', '_5', '_6', '_7', '_8', '_9']) {
    const key = env['TIKTOK_APP_KEY' + suffix], secret = env['TIKTOK_APP_SECRET' + suffix], service = env['TIKTOK_SERVICE_ID' + suffix];
    if (key && secret && service) apps.push({ id: suffix.slice(1), key, secret, service, shop: String(env['TIKTOK_APP_SHOP' + suffix] || '').trim().toLowerCase() });
  }
  return apps;
}

// Returns a usable access token, refreshing (and saving) it when it is close to expiry.
function accessTokenFor(store, client, vault, conn, now = Date.now()) {
  // One refresh at a time per shop, from the latest saved token (see marketplaceTokens.js).
  return accessToken({ key: 'tiktok:' + conn.tiktok_shop_id, conn, vault, earlyMs: REFRESH_EARLY_MS, now,
    reload: () => store.get('SELECT * FROM tiktok_connections WHERE tiktok_shop_id=?', conn.tiktok_shop_id),
    refresh: token => client.refresh(token),
    save: t => store.run('UPDATE tiktok_connections SET access_token=?,access_expires=?,refresh_token=?,refresh_expires=? WHERE tiktok_shop_id=?',
      vault.seal(t.accessToken), t.accessExpires, vault.seal(t.refreshToken), t.refreshExpires, conn.tiktok_shop_id),
    expired: () => new TikTokApiError('การเชื่อมต่อ TikTok หมดอายุ กรุณาให้ Super Admin กดเชื่อมต่อใหม่') });
}

// Pulls orders created on Bangkok days start..end (inclusive) and saves them. Returns { orders } for logging only.
export async function syncTikTokShop(store, client, vault, { conn, start, end, user, now = Date.now() }) {
  try {
    const accessToken = await accessTokenFor(store, client, vault, conn, now);
    const raw = await client.searchOrders({ accessToken, shopCipher: conn.shop_cipher, fromMs: bangkokDayStart(start), toMs: bangkokDayStart(end) + DAY_MS });
    const ids = raw.filter(o => !/CANCEL/i.test(String(o.status || ''))).map(o => String(o.id));
    const returns = ids.length ? await client.returnsByOrder({ accessToken, shopCipher: conn.shop_cipher, orderIds: ids }) : new Map();
    const orders = raw.map(o => mapTikTokOrder(o, returns.get(String(o.id)) || [])).filter(Boolean);
    // Fees/net payout from statements dated start..now (settlement comes after the order); same rows as the finance file.
    // A Finance API failure (often its rate limit) must not lose the orders: save them, then report the fee problem.
    let settlements = [], financeError = null;
    try {
      // Statements dated start .. end + 60 days (settlement comes after the order; capped at now). Later days come with the next syncs.
      const txs = await client.statementTransactions({ accessToken, shopCipher: conn.shop_cipher, fromMs: bangkokDayStart(start), toMs: Math.min(bangkokDayStart(end) + 61 * DAY_MS, now) });
      settlements = txs.map(mapTikTokSettlement).filter(Boolean);
    } catch (error) {
      if (!(error instanceof TikTokApiError)) throw error;
      financeError = new TikTokApiError(`ดึงออเดอร์สำเร็จ แต่ดึงค่าธรรมเนียมไม่สำเร็จ (${error.message}) กรุณากดดึงข้อมูลอีกครั้งภายหลัง`, error.code);
    }
    if (orders.length || settlements.length) {
      const sha256 = digest(JSON.stringify([orders, settlements]));
      saveMarketplaceUpload(store, { platform: 'tiktok', fileName: `TikTok API ${start} ถึง ${end} · ${conn.shop_name}`.slice(0, 200), sha256,
        user, parsed: { kinds: ['api'], orders, settlements, shopCode: null }, shopId: conn.shop_id });
    }
    store.run('UPDATE tiktok_connections SET last_sync_at=?,last_sync_error=NULL WHERE tiktok_shop_id=?', new Date(now).toISOString(), conn.tiktok_shop_id);
    if (financeError) throw financeError;
    return { orders: orders.length, settlements: settlements.length };
  } catch (error) {
    const message = error instanceof TikTokApiError ? error.message : 'ดึงข้อมูลจาก TikTok ไม่สำเร็จ';
    store.run('UPDATE tiktok_connections SET last_sync_error=? WHERE tiktok_shop_id=?', message.slice(0, 300), conn.tiktok_shop_id);
    throw error;
  }
}

export function installTikTokShop(app, store, audit, env = process.env, { fetchImpl } = {}) {
  const vault = createSecretVault(env, store.path);
  const autoMinutes = Number(env.TIKTOK_AUTO_SYNC_MINUTES || 0);
  const apps = tiktokApps(env);
  const configured = () => apps.length > 0;
  const appById = id => apps.find(a => a.id === String(id ?? ''));
  // The app a dashboard shop connects through: the one named for it, else the unsuffixed default.
  const appForShop = name => apps.find(a => a.shop && a.shop === String(name || '').trim().toLowerCase()) || appById('');
  const clients = new Map();
  const clientFor = app => {
    if (!clients.has(app.id)) clients.set(app.id, createTikTokClient({ appKey: app.key, appSecret: app.secret, ...(fetchImpl && { fetchImpl }) }));
    return clients.get(app.id);
  };
  const connections = () => store.all('SELECT * FROM tiktok_connections ORDER BY shop_name');
  let running = null;
  const runSync = (start, end, user) => {
    if (running) throw new TikTokApiError('กำลังดึงข้อมูล TikTok อยู่ กรุณารอสักครู่');
    running = (async () => {
      // One shop failing (e.g. its token expired) must not stop the others; the first error is reported after all ran.
      let firstError = null;
      for (const conn of connections()) {
        const app = appById(conn.app);
        try {
          if (!app) {
            const message = `ไม่พบแอป TikTok ของร้านนี้ใน .env (TIKTOK_APP_KEY${conn.app ? '_' + conn.app : ''}) กรุณาตรวจการตั้งค่า`;
            store.run('UPDATE tiktok_connections SET last_sync_error=? WHERE tiktok_shop_id=?', message, conn.tiktok_shop_id);
            throw new TikTokApiError(message);
          }
          await syncTikTokShop(store, clientFor(app), vault, { conn, start, end, user });
        } catch (error) { firstError ??= error; }
      }
      if (firstError) throw firstError;
    })().finally(() => { running = null; });
    return running;
  };
  const back = (res, result) => res.redirect(303, '/marketplace.html?tiktok=' + result + '#tiktok');

  // Status only — never order counts or totals (tiktok_sync users may lack marketplace_view).
  app.get('/api/tiktok/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ configured: configured(), canConnect: req.auth?.role === 'super_admin', autoSyncMinutes: autoMinutes >= 30 ? autoMinutes : 0,
      connections: store.all(`SELECT c.tiktok_shop_id AS id,c.shop_name AS tiktokShop,s.name AS shop,c.connected_at AS connectedAt,
        c.last_sync_at AS lastSyncAt,c.last_sync_error AS lastSyncError,c.refresh_expires AS expiresAt
        FROM tiktok_connections c JOIN marketplace_shops s ON s.id=c.shop_id ORDER BY c.shop_name`) });
  });

  app.get('/api/tiktok/connect', requireSuperAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!configured()) return back(res, 'not-configured');
    let active = store.all('SELECT id,name FROM marketplace_shops WHERE active=1');
    if (!active.length) { // first use from this page: create the dashboard shop the orders are saved under
      if (store.get('SELECT 1 FROM marketplace_shops WHERE name=?', 'TikTok')) return back(res, 'no-dashboard-shop');
      const id = Number(store.run('INSERT INTO marketplace_shops(name,active,created_at) VALUES(?,1,?)', 'TikTok', new Date().toISOString()).lastInsertRowid);
      audit.record(req.auth, 'marketplace.shop_create', 'marketplace', { id, name: 'TikTok' }, null, req.socket.remoteAddress);
      active = [{ id, name: 'TikTok' }];
    }
    const shop = req.query.shop ? active.find(s => s.id === Number(req.query.shop)) : active.length === 1 ? active[0] : null;
    if (!shop) return back(res, 'choose-shop');
    const app = appForShop(shop.name);
    if (!app) return back(res, 'no-app');
    const state = randomBytes(32).toString('hex');
    store.transaction(() => {
      store.run('DELETE FROM tiktok_oauth_states WHERE expires<=?', Date.now());
      store.run('INSERT INTO tiktok_oauth_states(state_hash,user_id,shop_id,expires,app) VALUES(?,?,?,?,?)', digest(state), req.auth.id, shop.id, Date.now() + STATE_MS, app.id);
    });
    res.redirect(303, clientFor(app).authorizeUrl(app.service, state));
  });

  // TikTok sends the browser back here after the seller approves (TikTok Partner Center › Redirect URL).
  app.get('/api/tiktok/callback', requireSuperAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const state = String(req.query.state || ''), code = String(req.query.code || '');
    const saved = /^[a-f0-9]{64}$/.test(state) && store.get('SELECT * FROM tiktok_oauth_states WHERE state_hash=?', digest(state));
    if (saved) store.run('DELETE FROM tiktok_oauth_states WHERE state_hash=?', saved.state_hash);
    if (!saved || saved.expires <= Date.now() || saved.user_id !== req.auth.id) return back(res, 'expired');
    if (!code || code.length > 2048) return back(res, 'denied');
    const app = appById(saved.app);
    if (!app) return back(res, 'no-app');
    let step = 'client';
    try {
      const c = clientFor(app);
      step = 'token'; const t = await c.exchangeCode(code);
      step = 'shops'; const shops = await c.shops(t.accessToken);
      if (!shops.length) return back(res, 'no-shop');
      const at = new Date().toISOString();
      store.transaction(() => {
        for (const s of shops) store.run(`INSERT INTO tiktok_connections(tiktok_shop_id,shop_cipher,shop_name,shop_id,access_token,access_expires,refresh_token,refresh_expires,connected_by,connected_at,app)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tiktok_shop_id) DO UPDATE SET shop_cipher=excluded.shop_cipher,shop_name=excluded.shop_name,shop_id=excluded.shop_id,app=excluded.app,
          access_token=excluded.access_token,access_expires=excluded.access_expires,refresh_token=excluded.refresh_token,refresh_expires=excluded.refresh_expires,
          connected_by=excluded.connected_by,connected_at=excluded.connected_at,last_sync_error=NULL`,
          s.id, s.cipher, s.name.slice(0, 120), saved.shop_id, vault.seal(t.accessToken), t.accessExpires, vault.seal(t.refreshToken), t.refreshExpires, req.auth.id, at, app.id);
      });
      audit.record(req.auth, 'tiktok.connect', 'marketplace', { shops: shops.map(s => s.name), shopId: saved.shop_id, app: app.id || 'default' }, null, req.socket.remoteAddress);
      back(res, 'connected');
    } catch (error) {
      console.error(`TikTok connect failed at ${step}:`, error.code || error.name, String(error.message || '').slice(0, 200));
      back(res, 'failed');
    }
  });

  app.post('/api/tiktok/sync', sameSite, requirePermission('tiktok_sync'), express.json({ limit: '2kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { start, end } = req.body || {};
    if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / DAY_MS >= MAX_SYNC_DAYS)
      return res.status(400).json({ error: `กรุณาเลือกช่วงวันที่ให้ถูกต้อง ไม่เกิน ${MAX_SYNC_DAYS} วันต่อครั้ง` });
    if (!configured()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า TikTok API ในเซิร์ฟเวอร์' });
    if (!connections().length) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อร้าน TikTok กรุณาให้ Super Admin กดเชื่อมต่อก่อน' });
    try {
      await runSync(start, end, req.auth);
      audit.record(req.auth, 'tiktok.sync', 'marketplace', { start, end }, null, req.socket.remoteAddress);
      res.json({ ok: true, message: 'ดึงข้อมูลจาก TikTok สำเร็จ' });
    } catch (error) {
      if (error instanceof TikTokApiError) return res.status(502).json({ error: error.message });
      console.error('TikTok sync failed:', error.code || error.name);
      res.status(500).json({ error: 'ดึงข้อมูลจาก TikTok ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });

  // Disconnecting only forgets the tokens; orders already saved stay in reports.
  app.delete('/api/tiktok/connections/:id', sameSite, requireSuperAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id);
    if (!store.run('DELETE FROM tiktok_connections WHERE tiktok_shop_id=?', id).changes) return res.status(404).json({ error: 'ไม่พบการเชื่อมต่อนี้' });
    audit.record(req.auth, 'tiktok.disconnect', 'marketplace', { id }, null, req.socket.remoteAddress);
    res.json({ ok: true });
  });

  // Optional: TIKTOK_AUTO_SYNC_MINUTES (≥ 30) re-pulls the last 3 Bangkok days so status changes are picked up.
  const minutes = autoMinutes;
  if (minutes >= 30 && configured()) {
    const timer = setInterval(() => {
      if (running || !connections().length) return;
      const today = bangkokDate(Date.now() / 1000), start = bangkokDate(Date.now() / 1000 - 2 * 86400);
      runSync(start, today, SYSTEM_USER).catch(error => console.error('TikTok auto sync failed:', error.code || error.name));
    }, minutes * 60000);
    timer.unref();
  }
  // Optional: TIKTOK_BACKFILL_FROM=YYYY-MM-DD imports the history from that day to today by itself (92-day chunks, resumable).
  if (configured()) startBackfill({ store, name: 'tiktok', from: env.TIKTOK_BACKFILL_FROM, today: () => bangkokDate(Date.now() / 1000),
    runSync, isBusy: () => !!running, hasConnections: () => connections().length > 0, user: SYSTEM_USER });
}
