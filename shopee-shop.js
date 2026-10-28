// Shopee Open Platform v2: connect the shop once (Super Admin), then pull orders into the same marketplace tables
// the Seller Center uploads use, plus products/stock into shopee_items. Same flow as lazada-shop.js; see MARKETPLACE.md › Shopee API.
// Each order sync is recorded as one marketplace_uploads row ("Shopee API …"), so (platform, order_id) de-duplication,
// the upload history and "delete upload" work exactly as for files. Sync answers carry no figures.
// SHOPEE_ENV=sandbox|live picks the host; connections made in one environment are not used in the other.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { sameSite } from './auth.js';
import { saveMarketplaceUpload } from './marketplace.js';
import { requirePermission, requireSuperAdmin } from './src/middleware/access.js';
import { isReviewer } from './src/config/access.js';
import { startBackfill } from './src/services/marketplaceBackfill.js';
import { createSecretVault } from './src/services/totpService.js';
import { ShopeeApiError, bangkokDayStart, bangkokToday, createShopeeClient, mapShopeeEscrow, mapShopeeItem, mapShopeeOrder, shopeeEnv } from './src/services/shopeeApi.js';

const STATE_MS = 10 * 60 * 1000, REFRESH_EARLY_MS = 60 * 60 * 1000, DAY_MS = 86400000, MAX_SYNC_DAYS = 92;
export const RETENTION_DAYS = 90, LOG_RETENTION_DAYS = 90, AUTO_SYNC_DAYS = 90;
const digest = value => createHash('sha256').update(value).digest('hex');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const SYSTEM_USER = { id: null, full_name: 'ระบบ (Shopee API)' };

// Saves a new token pair (Shopee replaces the refresh token on every refresh).
function saveToken(store, vault, shopId, t) {
  store.run('UPDATE shopee_connections SET access_token=?,access_expires=?,refresh_token=?,refresh_expires=? WHERE shop_id=?',
    vault.seal(t.accessToken), t.accessExpires, vault.seal(t.refreshToken), t.refreshExpires, shopId);
}
async function refreshConnection(store, client, vault, conn, now = Date.now()) {
  if (conn.refresh_expires <= now) throw new ShopeeApiError('การเชื่อมต่อ Shopee หมดอายุ กรุณาให้ Super Admin กดเชื่อมต่อใหม่');
  const t = await client.refresh(vault.open(conn.refresh_token), conn.shop_id);
  saveToken(store, vault, conn.shop_id, t);
  Object.assign(conn, { access_expires: t.accessExpires, refresh_expires: t.refreshExpires });
  return t.accessToken;
}

// Runs fn(shop) with a valid token; an access-token-expired answer refreshes and retries once.
export async function withShop(store, client, vault, conn, fn, now = Date.now()) {
  let accessToken = conn.access_expires - now > REFRESH_EARLY_MS ? vault.open(conn.access_token) : await refreshConnection(store, client, vault, conn, now);
  try { return await fn({ shopId: conn.shop_id, accessToken }); } catch (error) {
    if (!error.tokenExpired) throw error;
    accessToken = await refreshConnection(store, client, vault, conn, now);
    return fn({ shopId: conn.shop_id, accessToken });
  }
}

// Orders created on Bangkok days start..end (inclusive). Returns counts for logging only.
export async function syncShopeeOrders(store, client, vault, { conn, start, end, user, now = Date.now() }) {
  try {
    const orders = await withShop(store, client, vault, conn, async shop => {
      const sns = await client.orderSns({ shop, fromS: bangkokDayStart(start) / 1000, toS: (bangkokDayStart(end) + DAY_MS) / 1000 });
      return sns.length ? (await client.orderDetails({ shop, orderSns: sns })).map(mapShopeeOrder).filter(Boolean) : [];
    }, now);
    if (orders.length) {
      saveMarketplaceUpload(store, { platform: 'shopee', fileName: `Shopee API ${start} ถึง ${end} · ${conn.shop_name}`.slice(0, 200), sha256: digest(JSON.stringify(orders)),
        user, parsed: { kinds: ['api'], orders, settlements: [], shopCode: null }, shopId: conn.dashboard_shop_id });
    }
    store.run('UPDATE shopee_connections SET last_sync_at=?,last_sync_error=NULL WHERE shop_id=?', new Date(now).toISOString(), conn.shop_id);
    return { orders: orders.length };
  } catch (error) {
    const message = error instanceof ShopeeApiError ? error.message : 'ดึงข้อมูลจาก Shopee ไม่สำเร็จ';
    store.run('UPDATE shopee_connections SET last_sync_error=? WHERE shop_id=?', message.slice(0, 300), conn.shop_id);
    throw error;
  }
}

// Fees / net payout (Payment API) for completed orders created start..end that have none yet; at most `limit` per run,
// so hourly syncs catch up gradually. Saved as one upload row like the orders.
export async function syncShopeeFees(store, client, vault, { conn, start, end, user, limit = 1000, now = Date.now() }) {
  const sns = store.all(`SELECT o.order_id AS sn FROM marketplace_orders o WHERE o.platform='shopee' AND o.status='completed' AND o.order_date BETWEEN ? AND ?
    AND o.shop_id IS ? AND NOT EXISTS (SELECT 1 FROM marketplace_settlements s WHERE s.platform='shopee' AND s.order_id=o.order_id)
    ORDER BY o.order_date DESC LIMIT ?`, start, end, conn.dashboard_shop_id ?? null, limit).map(r => r.sn);
  if (!sns.length) return { fees: 0 };
  const settlements = await withShop(store, client, vault, conn, async shop => {
    const out = [];
    for (const orderSn of sns) { const s = mapShopeeEscrow({ order_sn: orderSn, ...(await client.escrow({ shop, orderSn })) }); if (s) out.push(s); }
    return out;
  }, now);
  if (settlements.length) saveMarketplaceUpload(store, { platform: 'shopee', fileName: `Shopee API ค่าธรรมเนียม ${start} ถึง ${end} · ${conn.shop_name}`.slice(0, 200),
    sha256: digest(JSON.stringify(settlements)), user, parsed: { kinds: ['api'], orders: [], settlements, shopCode: null }, shopId: conn.dashboard_shop_id });
  return { fees: settlements.length };
}

// Products + stock: the shop's current list replaces the stored one.
export async function syncShopeeItems(store, client, vault, { conn, now = Date.now() }) {
  const rows = (await withShop(store, client, vault, conn, shop => client.items({ shop }), now)).flatMap(mapShopeeItem);
  const at = new Date(now).toISOString();
  store.transaction(() => {
    store.run('DELETE FROM shopee_items WHERE shop_id=?', conn.shop_id);
    for (const r of rows) store.run(`INSERT OR REPLACE INTO shopee_items(shop_id,item_id,model_id,item_sku,model_sku,name,model_name,item_status,price,stock,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, conn.shop_id, r.itemId, r.modelId, r.itemSku.slice(0, 80), r.modelSku.slice(0, 80), r.name.slice(0, 300), r.modelName.slice(0, 200), r.itemStatus.slice(0, 40), r.price, r.stock, at);
    store.run('UPDATE shopee_connections SET last_item_sync_at=? WHERE shop_id=?', at, conn.shop_id);
  });
  return { items: rows.length };
}

// Shopee Data Protection Policy: buyer personal data obtained through the API is kept ≤ 90 days.
// Name/phone/email/address are never stored; the only address part kept is the province of API orders, cleared
// once the order is older than 90 days (uploaded Seller Center files are not API data and keep theirs).
// API call logs older than 90 days are deleted too.
export function purgeShopeeBuyerData(store, now = Date.now()) {
  const cutoffDay = bangkokToday(now - RETENTION_DAYS * DAY_MS);
  const provinces = store.run("UPDATE marketplace_orders SET province=NULL WHERE platform='shopee' AND source='api' AND province IS NOT NULL AND order_date<?", cutoffDay).changes;
  const logs = store.run('DELETE FROM shopee_api_log WHERE at<?', new Date(now - LOG_RETENTION_DAYS * DAY_MS).toISOString()).changes;
  return { provinces, logs };
}

export function installShopeeShop(app, store, audit, env = process.env, { fetchImpl, sleep } = {}) {
  const vault = createSecretVault(env, store.path);
  const mode = shopeeEnv(env.SHOPEE_ENV);
  const autoMinutes = Number(env.SHOPEE_AUTO_SYNC_MINUTES || 0);
  const configured = () => !!(env.SHOPEE_PARTNER_ID && env.SHOPEE_PARTNER_KEY);
  const log = entry => {
    try {
      store.run('INSERT INTO shopee_api_log(at,endpoint,shop_id,http_status,error,duration_ms) VALUES(?,?,?,?,?,?)',
        new Date().toISOString(), entry.endpoint, entry.shopId, entry.httpStatus, entry.error ? String(entry.error).slice(0, 120) : null, entry.durationMs);
    } catch { /* logging must never break a sync */ }
    if (entry.error) console.warn(`Shopee ${entry.endpoint} → ${entry.httpStatus ?? 'no response'} ${entry.error}`);
  };
  const client = () => createShopeeClient({ partnerId: env.SHOPEE_PARTNER_ID, partnerKey: env.SHOPEE_PARTNER_KEY, env: mode, host: env.SHOPEE_HOST, log, ...(fetchImpl && { fetchImpl }), ...(sleep && { sleep }) });
  // Must be on the domain registered for the app in Shopee Open Platform Console.
  const redirectUrl = req => env.SHOPEE_REDIRECT_URL || `${req.protocol}://${req.get('host')}/api/shopee/callback`;
  const connections = () => store.all('SELECT * FROM shopee_connections WHERE env=? ORDER BY shop_name', mode);
  let running = null;
  const exclusive = task => {
    if (running) throw new ShopeeApiError('กำลังดึงข้อมูล Shopee อยู่ กรุณารอสักครู่');
    running = task().finally(() => { running = null; });
    return running;
  };
  const runSync = (start, end, user, { items = true } = {}) => exclusive(async () => {
    const c = client();
    for (const conn of connections()) {
      await syncShopeeOrders(store, c, vault, { conn, start, end, user });
      // Fees need the Payment API permission; failing it keeps the orders and shows the reason on the widget.
      await syncShopeeFees(store, c, vault, { conn, start, end, user }).catch(error => {
        if (!(error instanceof ShopeeApiError)) throw error;
        store.run('UPDATE shopee_connections SET last_sync_error=? WHERE shop_id=?', `ดึงออเดอร์สำเร็จ แต่ดึงค่าธรรมเนียมไม่สำเร็จ (${error.message})`.slice(0, 300), conn.shop_id);
      });
      if (items) await syncShopeeItems(store, c, vault, { conn }).catch(error => {
        if (!(error instanceof ShopeeApiError)) throw error;
        throw new ShopeeApiError(`ดึงออเดอร์สำเร็จ แต่ดึงสินค้า/สต็อกไม่สำเร็จ (${error.message})`, error.code);
      });
    }
  });
  const back = (res, result) => res.redirect(303, '/marketplace.html?shopee=' + result + '#shopee');

  // Status only — never order counts or totals (shopee_sync users may lack marketplace_view).
  app.get('/api/shopee/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ configured: configured(), env: mode, canConnect: req.auth?.role === 'super_admin', readOnly: isReviewer(req.auth?.role), autoSyncMinutes: autoMinutes >= 30 ? autoMinutes : 0,
      connections: store.all(`SELECT c.shop_id AS id,c.shop_name AS shopeeShop,s.name AS shop,c.connected_at AS connectedAt,c.last_sync_at AS lastSyncAt,
        c.last_sync_error AS lastSyncError,c.last_item_sync_at AS lastItemSyncAt,c.refresh_expires AS expiresAt
        FROM shopee_connections c JOIN marketplace_shops s ON s.id=c.dashboard_shop_id WHERE c.env=? ORDER BY c.shop_name`, mode) });
  });

  // Last buyer-data cleanup runs (counts only) for data-protection.html; open to every signed-in user like that page.
  app.get('/api/data-protection/cleanup', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ retentionDays: RETENTION_DAYS, syncDays: AUTO_SYNC_DAYS,
      runs: store.all('SELECT at,provinces,logs,error FROM retention_runs ORDER BY id DESC LIMIT 10') });
  });

  // Products and stock (no sales figures). stock null = unknown.
  app.get('/api/shopee/items', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const q = String(req.query.q || '').trim().slice(0, 80);
    const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const rows = store.all(`SELECT i.item_id AS itemId,i.model_id AS modelId,COALESCE(NULLIF(i.model_sku,''),i.item_sku) AS sku,i.name,i.model_name AS modelName,
      i.price,i.stock,i.updated_at AS updatedAt FROM shopee_items i JOIN shopee_connections c ON c.shop_id=i.shop_id AND c.env=?
      WHERE (?='' OR i.name LIKE ? ESCAPE '\\' OR i.item_sku LIKE ? ESCAPE '\\' OR i.model_sku LIKE ? ESCAPE '\\')
      ORDER BY i.name,i.model_name LIMIT 501`, mode, q, like, like, like);
    res.json({ items: rows.slice(0, 500), truncated: rows.length > 500 });
  });

  app.get('/api/shopee/connect', requireSuperAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!configured()) return back(res, 'not-configured');
    let active = store.all('SELECT id FROM marketplace_shops WHERE active=1');
    if (!active.length) { // first use from this page: create the dashboard shop the orders are saved under
      if (store.get('SELECT 1 FROM marketplace_shops WHERE name=?', 'Shopee')) return back(res, 'no-dashboard-shop');
      const id = Number(store.run('INSERT INTO marketplace_shops(name,active,created_at) VALUES(?,1,?)', 'Shopee', new Date().toISOString()).lastInsertRowid);
      audit.record(req.auth, 'marketplace.shop_create', 'marketplace', { id, name: 'Shopee' }, null, req.socket.remoteAddress);
      active = [{ id }];
    }
    const shop = req.query.shop ? active.find(s => s.id === Number(req.query.shop)) : active.length === 1 ? active[0] : null;
    if (!shop) return back(res, 'choose-shop');
    const state = randomBytes(32).toString('hex');
    store.transaction(() => {
      store.run('DELETE FROM shopee_oauth_states WHERE expires<=?', Date.now());
      store.run('INSERT INTO shopee_oauth_states VALUES(?,?,?,?)', digest(state), req.auth.id, shop.id, Date.now() + STATE_MS);
    });
    // Shopee has no state parameter: it keeps the redirect's query and appends code & shop_id.
    const redirect = new URL(redirectUrl(req));
    redirect.searchParams.set('state', state);
    res.redirect(303, client().authorizeUrl(redirect.toString()));
  });

  // Shopee sends the browser back here after the seller approves.
  app.get('/api/shopee/callback', requireSuperAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const state = String(req.query.state || ''), code = String(req.query.code || ''), shopId = String(req.query.shop_id || '');
    const saved = /^[a-f0-9]{64}$/.test(state) && store.get('SELECT * FROM shopee_oauth_states WHERE state_hash=?', digest(state));
    if (saved) store.run('DELETE FROM shopee_oauth_states WHERE state_hash=?', saved.state_hash);
    if (!saved || saved.expires <= Date.now() || saved.user_id !== req.auth.id) return back(res, 'expired');
    if (!code || code.length > 512) return back(res, 'denied');
    if (!/^\d{1,20}$/.test(shopId)) return back(res, 'no-shop'); // main-account authorisation (main_account_id) is not supported
    let step = 'client';
    try {
      const c = client();
      step = 'token'; const t = await c.exchangeCode(code, shopId);
      step = 'shop'; const info = await c.shopInfo({ shopId, accessToken: t.accessToken });
      const name = (info.name || shopId).slice(0, 120);
      store.run(`INSERT INTO shopee_connections(shop_id,env,shop_name,region,dashboard_shop_id,access_token,access_expires,refresh_token,refresh_expires,connected_by,connected_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shop_id) DO UPDATE SET env=excluded.env,shop_name=excluded.shop_name,region=excluded.region,
        dashboard_shop_id=excluded.dashboard_shop_id,access_token=excluded.access_token,access_expires=excluded.access_expires,refresh_token=excluded.refresh_token,
        refresh_expires=excluded.refresh_expires,connected_by=excluded.connected_by,connected_at=excluded.connected_at,last_sync_error=NULL`,
        shopId, mode, name, info.region.slice(0, 10), saved.shop_id, vault.seal(t.accessToken), t.accessExpires, vault.seal(t.refreshToken), t.refreshExpires, req.auth.id, new Date().toISOString());
      audit.record(req.auth, 'shopee.connect', 'marketplace', { shop: name, shopId: saved.shop_id, env: mode }, null, req.socket.remoteAddress);
      back(res, 'connected');
    } catch (error) {
      console.error(`Shopee connect failed at ${step}:`, error.code || error.name, String(error.message || '').slice(0, 200));
      back(res, 'failed');
    }
  });

  app.post('/api/shopee/sync', sameSite, requirePermission('shopee_sync'), express.json({ limit: '2kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { start, end } = req.body || {};
    if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / DAY_MS >= MAX_SYNC_DAYS)
      return res.status(400).json({ error: `กรุณาเลือกช่วงวันที่ให้ถูกต้อง ไม่เกิน ${MAX_SYNC_DAYS} วันต่อครั้ง` });
    if (!configured()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า Shopee API ในเซิร์ฟเวอร์' });
    if (!connections().length) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อร้าน Shopee กรุณาให้ Super Admin กดเชื่อมต่อก่อน' });
    try {
      await runSync(start, end, req.auth);
      audit.record(req.auth, 'shopee.sync', 'marketplace', { start, end }, null, req.socket.remoteAddress);
      res.json({ ok: true, message: 'ดึงข้อมูลจาก Shopee สำเร็จ' });
    } catch (error) {
      if (error instanceof ShopeeApiError) return res.status(502).json({ error: error.message });
      console.error('Shopee sync failed:', error.code || error.name);
      res.status(500).json({ error: 'ดึงข้อมูลจาก Shopee ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });

  // Disconnecting forgets the tokens and the product list; orders already saved stay in reports.
  app.delete('/api/shopee/connections/:id', sameSite, requireSuperAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id);
    if (!store.run('DELETE FROM shopee_connections WHERE shop_id=?', id).changes) return res.status(404).json({ error: 'ไม่พบการเชื่อมต่อนี้' });
    store.run('DELETE FROM shopee_items WHERE shop_id=?', id);
    audit.record(req.auth, 'shopee.disconnect', 'marketplace', { id }, null, req.socket.remoteAddress);
    res.json({ ok: true });
  });

  const timers = [];
  const every = (ms, fn) => { const t = setInterval(fn, ms); t.unref(); timers.push(t); };
  // Access tokens last about 4 hours: every 30 minutes refresh those expiring within the hour, even without syncs.
  if (configured()) every(30 * 60000, async () => {
    const c = client();
    for (const conn of connections()) {
      if (conn.access_expires - Date.now() > REFRESH_EARLY_MS) continue;
      try { await refreshConnection(store, c, vault, conn); } catch (error) {
        store.run('UPDATE shopee_connections SET last_sync_error=? WHERE shop_id=?', String(error.message || 'ต่ออายุ token ไม่สำเร็จ').slice(0, 300), conn.shop_id);
      }
    }
  });
  // Daily retention cleanup (also once at start); every run is recorded in retention_runs (shown on data-protection.html).
  const purge = () => {
    const at = new Date().toISOString();
    try {
      const { provinces, logs } = purgeShopeeBuyerData(store);
      store.run('INSERT INTO retention_runs(at,provinces,logs) VALUES(?,?,?)', at, provinces, logs);
      console.log(`Buyer-data cleanup: ${provinces} province(s) cleared, ${logs} API log row(s) deleted`);
    } catch (error) {
      console.error('Shopee retention cleanup failed:', error.code || error.name);
      try { store.run('INSERT INTO retention_runs(at,error) VALUES(?,?)', at, String(error.code || error.name).slice(0, 120)); } catch { /* table missing: nothing more to do */ }
    }
  };
  purge();
  every(DAY_MS, purge);
  // Optional: SHOPEE_AUTO_SYNC_MINUTES (≥ 30) re-pulls the last 90 Bangkok days (orders, 15-day windows) and the product/stock list.
  // Older orders stay as saved by earlier syncs and uploads.
  const autoSync = () => {
    if (running || !connections().length) return;
    runSync(bangkokToday(Date.now() - (AUTO_SYNC_DAYS - 1) * DAY_MS), bangkokToday(), SYSTEM_USER).catch(error => console.error('Shopee auto sync failed:', error.code || error.name));
  };
  if (autoMinutes >= 30 && configured()) {
    every(autoMinutes * 60000, autoSync);
    const first = setTimeout(autoSync, 2 * 60000); first.unref(); timers.push(first); // first run shortly after start
  }
  // Optional: SHOPEE_BACKFILL_FROM=YYYY-MM-DD imports the history from that day to today by itself (92-day chunks, resumable).
  const backfill = configured() ? startBackfill({ store, name: 'shopee', from: env.SHOPEE_BACKFILL_FROM, today: () => bangkokToday(),
    runSync, isBusy: () => !!running, hasConnections: () => connections().length > 0, user: SYSTEM_USER }) : null;
  return { close: () => { timers.forEach(clearInterval); backfill?.stop(); } };
}
