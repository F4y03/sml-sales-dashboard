// Online marketplace sales (Shopee / Lazada / TikTok Shop) from Seller Center exports. See MARKETPLACE.md.
// Uploaders (marketplace_upload) get only "อัปโหลดสำเร็จ" and the upload history — never totals or orders.
// The summary API needs marketplace_view. Data lives in the app SQLite database; SML is not touched.
import express from 'express';
import { createHash } from 'node:crypto';
import { sameSite } from './auth.js';
import { requirePermission } from './src/middleware/access.js';
import { hasPermission } from './src/services/permissionService.js';
import { MAX_FILE_BYTES, MarketplaceFileError, PLATFORMS, parseMarketplaceFile } from './src/services/marketplaceParser.js';

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPeriod = (start, end) => validDate(start) && validDate(end) && start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 <= 365;
const SOLD = "('completed','pending')";
const cleanFileName = value => {
  let name = '';
  try { name = decodeURIComponent(String(value || '')); } catch {}
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return name || 'ไม่ระบุชื่อไฟล์';
};

export function saveMarketplaceUpload(store, { platform, fileName, sha256, user, parsed, shopId = null, now = new Date().toISOString() }) {
  return store.transaction(() => {
    const duplicate = !!store.get('SELECT 1 FROM marketplace_uploads WHERE platform=? AND file_sha256=?', platform, sha256);
    const uploadId = Number(store.run('INSERT INTO marketplace_uploads(platform,file_name,file_sha256,file_kinds,uploaded_by,uploaded_by_name,created_at,shop_id) VALUES(?,?,?,?,?,?,?,?)',
      platform, fileName, sha256, parsed.kinds.join(','), user?.id ?? null, user?.full_name || user?.username || 'ไม่ทราบชื่อ', now, shopId).lastInsertRowid);
    if (shopId && parsed.shopCode) store.run('INSERT OR IGNORE INTO marketplace_shop_codes(platform,code,shop_id) VALUES(?,?,?)', platform, parsed.shopCode, shopId);
    for (const o of parsed.orders) {
      // Same order uploaded again (re-export, overlapping date range) replaces the old row: never counted twice.
      // A source without product lines (Shopee income report) keeps lines another file already supplied.
      store.run(`INSERT INTO marketplace_orders(platform,order_id,order_date,status,status_raw,sales,refund,province,has_items,source,upload_id,updated_at,shop_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(platform,order_id) DO UPDATE SET order_date=excluded.order_date,status=excluded.status,status_raw=excluded.status_raw,
          sales=excluded.sales,refund=excluded.refund,province=COALESCE(excluded.province,marketplace_orders.province),
          has_items=MAX(excluded.has_items,marketplace_orders.has_items),source=excluded.source,upload_id=excluded.upload_id,updated_at=excluded.updated_at,shop_id=excluded.shop_id`,
        platform, o.orderId, o.orderDate, o.status, String(o.statusRaw || '').slice(0, 120), o.sales, o.refund || 0, o.province, o.items ? 1 : 0, o.source, uploadId, now, shopId);
      if (!o.items) continue;
      store.run('DELETE FROM marketplace_order_items WHERE platform=? AND order_id=?', platform, o.orderId);
      for (const item of o.items) store.run('INSERT INTO marketplace_order_items(platform,order_id,line_key,sku,product_name,quantity,sales,status) VALUES(?,?,?,?,?,?,?,?)',
        platform, o.orderId, item.lineKey.slice(0, 120), item.sku.slice(0, 80), item.name.slice(0, 300), item.quantity, item.sales, item.status);
    }
    for (const s of parsed.settlements) store.run(`INSERT INTO marketplace_settlements(platform,txn_id,order_id,fees,net_payout,upload_id,updated_at,shop_id) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(platform,txn_id) DO UPDATE SET order_id=excluded.order_id,fees=excluded.fees,net_payout=excluded.net_payout,upload_id=excluded.upload_id,updated_at=excluded.updated_at,shop_id=excluded.shop_id`,
      platform, s.txnId, s.orderId, s.fees, s.netPayout, uploadId, now, shopId);
    return { uploadId, duplicate };
  });
}

export function marketplaceSummary(store, { platform, start, end, shop = 'all' }) {
  const shopId = shop === 'all' ? null : Number(shop);
  const where = "o.order_date BETWEEN ? AND ? AND (? = 'all' OR o.platform = ?) AND (? IS NULL OR o.shop_id = ?)", p = [start, end, platform, platform, shopId, shopId];
  const platforms = store.all(`SELECT o.platform,
      COALESCE(SUM(CASE WHEN o.status IN ${SOLD} THEN o.sales END),0) AS sales,
      SUM(o.status IN ${SOLD}) AS orders, COUNT(*) AS allOrders,
      SUM(o.status IN ${SOLD} AND o.has_items=1) AS ordersWithItems,
      SUM(o.status<>'cancelled' AND s.order_id IS NOT NULL) AS ordersWithFees, SUM(o.status<>'cancelled') AS feeBase,
      SUM(s.fees) AS fees, SUM(s.net_payout) AS netPayout
    FROM marketplace_orders o
    LEFT JOIN (SELECT platform,order_id,SUM(fees) AS fees,SUM(net_payout) AS net_payout FROM marketplace_settlements GROUP BY platform,order_id) s
      ON s.platform=o.platform AND s.order_id=o.order_id
    WHERE ${where} GROUP BY o.platform`, ...p);
  const statuses = store.all(`SELECT o.platform,o.status,COUNT(*) AS orders,SUM(o.sales) AS sales,SUM(o.refund) AS refund
    FROM marketplace_orders o WHERE ${where} GROUP BY o.platform,o.status`, ...p);
  const daily = store.all(`SELECT o.order_date AS date,o.platform,SUM(o.sales) AS sales,COUNT(*) AS orders
    FROM marketplace_orders o WHERE ${where} AND o.status IN ${SOLD} GROUP BY o.order_date,o.platform ORDER BY o.order_date`, ...p);
  // Seller SKU is the shared key across platforms; lines without one fall back to the product name.
  const topProducts = store.all(`SELECT COALESCE(NULLIF(UPPER(TRIM(i.sku)),''),i.product_name) AS productKey,
      MAX(i.sku) AS sku,MAX(i.product_name) AS name,GROUP_CONCAT(DISTINCT i.platform) AS platforms,
      SUM(i.quantity) AS quantity,SUM(i.sales) AS sales,COUNT(DISTINCT i.platform||':'||i.order_id) AS orders
    FROM marketplace_order_items i JOIN marketplace_orders o ON o.platform=i.platform AND o.order_id=i.order_id
    WHERE ${where} AND o.status IN ${SOLD} AND i.status IN ${SOLD}
    GROUP BY productKey ORDER BY sales DESC, quantity DESC LIMIT 10`, ...p);
  const provinces = store.all(`SELECT o.province,COUNT(*) AS orders,SUM(o.sales) AS sales FROM marketplace_orders o
    WHERE ${where} AND o.status IN ${SOLD} AND o.province IS NOT NULL GROUP BY o.province ORDER BY sales DESC LIMIT 10`, ...p);
  const bounds = store.get(`SELECT MIN(order_date) AS first,MAX(order_date) AS last,(SELECT MAX(created_at) FROM marketplace_uploads) AS lastUploadAt
    FROM marketplace_orders WHERE (? = 'all' OR platform = ?) AND (? IS NULL OR shop_id = ?)`, platform, platform, shopId, shopId);
  // Shops that have orders: the dashboard hides the shop filter when there is only one.
  const shops = store.all(`SELECT DISTINCT s.id,s.name,s.active FROM marketplace_shops s JOIN marketplace_orders o ON o.shop_id=s.id
    WHERE (? = 'all' OR o.platform = ?) ORDER BY s.name`, platform, platform);
  return { platform, shop: shopId ?? 'all', start, end, bounds, shops, platforms, statuses, daily, topProducts: topProducts.map(({ productKey, ...row }) => ({ ...row, platforms: String(row.platforms || '').split(',') })), provinces };
}

// Picks the shop for an upload and refuses a likely wrong pick. Returns { shopId } or { error }.
// 1) one active shop and none chosen -> that shop; 2) a seller code in the file that is already linked to
// another shop -> refuse; 3) order IDs already stored (orders or settlements) mostly under another shop -> refuse.
export function resolveUploadShop(store, { platform, shop, parsed }) {
  const active = store.all('SELECT id,name FROM marketplace_shops WHERE active=1 ORDER BY name');
  if (!active.length) return { error: 'ยังไม่มีร้านในระบบ กรุณาเพิ่มร้านก่อนอัปโหลด' };
  let chosen = shop ? active.find(s => s.id === Number(shop)) : active.length === 1 ? active[0] : null;
  if (!chosen) return { error: shop ? 'ร้านที่เลือกไม่มีอยู่หรือปิดใช้งานแล้ว กรุณาเลือกร้านใหม่' : 'กรุณาเลือกร้านก่อนอัปโหลด' };
  if (parsed.shopCode) {
    const linked = store.get('SELECT s.id,s.name FROM marketplace_shop_codes c JOIN marketplace_shops s ON s.id=c.shop_id WHERE c.platform=? AND c.code=?', platform, parsed.shopCode);
    if (linked && linked.id !== chosen.id) return { error: `ไฟล์นี้เป็นของร้าน ${linked.name} (รหัสผู้ขาย ${parsed.shopCode}) แต่เลือกร้าน ${chosen.name} อยู่ กรุณาเลือกร้านให้ถูกต้อง` };
  }
  const ids = [...new Set([...parsed.orders.map(o => o.orderId), ...parsed.settlements.map(s => s.orderId)])];
  const counts = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500), marks = chunk.map(() => '?').join(',');
    for (const row of store.all(`SELECT shop_id,COUNT(DISTINCT order_id) AS n FROM (
        SELECT shop_id,order_id FROM marketplace_orders WHERE platform=? AND shop_id IS NOT NULL AND order_id IN (${marks})
        UNION SELECT shop_id,order_id FROM marketplace_settlements WHERE platform=? AND shop_id IS NOT NULL AND order_id IN (${marks})
      ) GROUP BY shop_id`, platform, ...chunk, platform, ...chunk)) counts.set(row.shop_id, (counts.get(row.shop_id) || 0) + row.n);
  }
  const same = counts.get(chosen.id) || 0;
  const [otherId, other = 0] = [...counts].filter(([id]) => id !== chosen.id).sort((a, b) => b[1] - a[1])[0] || [];
  if (other > same) {
    const name = store.get('SELECT name FROM marketplace_shops WHERE id=?', otherId)?.name || 'อื่น';
    return { error: `ออเดอร์ในไฟล์นี้ ${other} รายการเป็นของร้าน ${name} อยู่แล้ว แต่เลือกร้าน ${chosen.name} อยู่ กรุณาเลือกร้านให้ถูกต้อง (ถ้าเคยอัปผิดร้าน ให้ลบรายการเดิมก่อน)` };
  }
  return { shopId: chosen.id };
}

// Removes what an upload still owns: orders/settlements a later upload re-wrote belong to that later upload and stay.
// Older data the deleted upload had replaced is not restored — upload that file again if it is still needed.
export function deleteMarketplaceUpload(store, id) {
  return store.transaction(() => {
    const upload = store.get('SELECT id,platform,file_name AS fileName FROM marketplace_uploads WHERE id=?', id);
    if (!upload) return null;
    const orders = Number(store.run('DELETE FROM marketplace_orders WHERE upload_id=?', id).changes);
    const settlements = Number(store.run('DELETE FROM marketplace_settlements WHERE upload_id=?', id).changes);
    store.run('DELETE FROM marketplace_uploads WHERE id=?', id);
    return { ...upload, orders, settlements };
  });
}

export function installMarketplace(app, store, audit) {
  const raw = express.raw({ type: () => true, limit: MAX_FILE_BYTES });
  const readBody = (req, res, next) => raw(req, res, error => error
    ? res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: error.type === 'entity.too.large' ? 'ไฟล์ใหญ่เกิน 20 MB กรุณาแบ่ง export เป็นช่วงวันที่สั้นลง' : 'อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่' })
    : next());

  app.post('/api/marketplace/upload', sameSite, requirePermission('marketplace_upload'), readBody, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const platform = String(req.query.platform || ''), fileName = cleanFileName(req.get('X-File-Name'));
    try {
      if (!Buffer.isBuffer(req.body)) throw new MarketplaceFileError('ไม่พบไฟล์ กรุณาเลือกไฟล์ใหม่');
      const parsed = await parseMarketplaceFile({ buffer: req.body, fileName, platform });
      const sha256 = createHash('sha256').update(req.body).digest('hex');
      const { shopId, error } = resolveUploadShop(store, { platform, shop: req.query.shop, parsed });
      if (error) throw new MarketplaceFileError(error);
      const { duplicate } = saveMarketplaceUpload(store, { platform, fileName, sha256, user: req.auth, parsed, shopId });
      audit.record(req.auth, 'marketplace.upload', 'marketplace', { platform, fileName, duplicate, shopId }, null, req.socket.remoteAddress);
      // Deliberately no counts or totals: uploaders must not see sales figures.
      res.json({ ok: true, message: 'อัปโหลดสำเร็จ', duplicate });
    } catch (error) {
      if (error instanceof MarketplaceFileError) return res.status(400).json({ error: error.message });
      console.error('Marketplace upload failed:', error.code || error.name);
      res.status(500).json({ error: 'บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
    }
  });

  app.get('/api/marketplace/uploads', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!['marketplace_upload', 'marketplace_view'].some(p => hasPermission(req.auth, p))) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });
    // ?source=file | api: hourly API syncs would otherwise push uploaded files out of the latest 50.
    const source = ['file', 'api'].includes(req.query.source) ? req.query.source : 'all';
    const uploads = store.all(`SELECT u.id,u.platform,u.file_name AS fileName,u.uploaded_by_name AS uploadedBy,u.created_at AS createdAt,s.name AS shop
      FROM marketplace_uploads u LEFT JOIN marketplace_shops s ON s.id=u.shop_id
      WHERE ?='all' OR (u.file_kinds='api')=(?='api') ORDER BY u.id DESC LIMIT 50`, source, source);
    res.json({ uploads });
  });

  const canSeeShops = req => ['marketplace_upload', 'marketplace_view'].some(p => hasPermission(req.auth, p));
  const listShops = () => store.all('SELECT id,name,active FROM marketplace_shops ORDER BY active DESC,name');
  const shopName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();

  app.get('/api/marketplace/shops', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!canSeeShops(req)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });
    res.json({ shops: listShops() });
  });

  app.post('/api/marketplace/shops', sameSite, requirePermission('marketplace_upload'), express.json({ limit: '2kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const name = shopName(req.body?.name);
    if (name.length < 1 || name.length > 60) return res.status(400).json({ error: 'กรุณาใส่ชื่อร้าน 1–60 ตัวอักษร' });
    if (store.get('SELECT 1 FROM marketplace_shops WHERE name=?', name)) return res.status(409).json({ error: 'มีร้านชื่อนี้อยู่แล้ว' });
    const id = Number(store.run('INSERT INTO marketplace_shops(name,active,created_at) VALUES(?,1,?)', name, new Date().toISOString()).lastInsertRowid);
    audit.record(req.auth, 'marketplace.shop_create', 'marketplace', { id, name }, null, req.socket.remoteAddress);
    res.json({ ok: true, shops: listShops() });
  });

  // Closing a shop only hides it from uploads; its data stays in reports.
  app.patch('/api/marketplace/shops/:id', sameSite, requirePermission('marketplace_upload'), express.json({ limit: '2kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = Number(req.params.id), active = req.body?.active;
    if (!Number.isSafeInteger(id) || typeof active !== 'boolean') return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
    if (!store.run('UPDATE marketplace_shops SET active=? WHERE id=?', active ? 1 : 0, id).changes) return res.status(404).json({ error: 'ไม่พบร้านนี้' });
    audit.record(req.auth, 'marketplace.shop_active', 'marketplace', { id, active }, null, req.socket.remoteAddress);
    res.json({ ok: true, shops: listShops() });
  });

  app.delete('/api/marketplace/uploads/:id', sameSite, requirePermission('marketplace_upload'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'รายการไม่ถูกต้อง' });
    try {
      const removed = deleteMarketplaceUpload(store, id);
      if (!removed) return res.status(404).json({ error: 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว' });
      audit.record(req.auth, 'marketplace.delete_upload', 'marketplace', { id, platform: removed.platform, fileName: removed.fileName }, null, req.socket.remoteAddress);
      // Like upload: no counts, uploaders must not see sales figures.
      res.json({ ok: true, message: 'ลบแล้ว' });
    } catch (error) {
      console.error('Marketplace delete failed:', error.code || error.name);
      res.status(500).json({ error: 'ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
    }
  });

  app.get('/api/marketplace/summary', requirePermission('marketplace_view'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Marketplace orders carry no sales territory, so territory-scoped accounts never see them.
    if (req.auth.scope === 'territory') return res.status(403).json({ error: 'ยอดขายออนไลน์ไม่รองรับบัญชีที่จำกัดเขต' });
    const { start, end } = req.query, platform = String(req.query.platform || 'all'), shop = String(req.query.shop || 'all');
    if (platform !== 'all' && !PLATFORMS[platform]) return res.status(400).json({ error: 'แพลตฟอร์มไม่ถูกต้อง' });
    if (shop !== 'all' && !/^[1-9]\d{0,8}$/.test(shop)) return res.status(400).json({ error: 'ร้านไม่ถูกต้อง' });
    if (!validPeriod(start, end)) return res.status(400).json({ error: 'กรุณาระบุวันที่ให้ถูกต้อง ช่วงเวลาไม่เกิน 366 วัน' });
    try {
      res.json({ ...marketplaceSummary(store, { platform, start, end, shop }), updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Marketplace summary failed:', error.code || error.name);
      res.status(500).json({ error: 'โหลดข้อมูลยอดขายออนไลน์ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });
}
