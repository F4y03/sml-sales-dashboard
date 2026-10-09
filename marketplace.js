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

export function saveMarketplaceUpload(store, { platform, fileName, sha256, user, parsed, now = new Date().toISOString() }) {
  return store.transaction(() => {
    const duplicate = !!store.get('SELECT 1 FROM marketplace_uploads WHERE platform=? AND file_sha256=?', platform, sha256);
    const uploadId = Number(store.run('INSERT INTO marketplace_uploads(platform,file_name,file_sha256,file_kinds,uploaded_by,uploaded_by_name,created_at) VALUES(?,?,?,?,?,?,?)',
      platform, fileName, sha256, parsed.kinds.join(','), user?.id ?? null, user?.full_name || user?.username || 'ไม่ทราบชื่อ', now).lastInsertRowid);
    for (const o of parsed.orders) {
      // Same order uploaded again (re-export, overlapping date range) replaces the old row: never counted twice.
      // A source without product lines (Shopee income report) keeps lines another file already supplied.
      store.run(`INSERT INTO marketplace_orders(platform,order_id,order_date,status,status_raw,sales,refund,province,has_items,source,upload_id,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(platform,order_id) DO UPDATE SET order_date=excluded.order_date,status=excluded.status,status_raw=excluded.status_raw,
          sales=excluded.sales,refund=excluded.refund,province=COALESCE(excluded.province,marketplace_orders.province),
          has_items=MAX(excluded.has_items,marketplace_orders.has_items),source=excluded.source,upload_id=excluded.upload_id,updated_at=excluded.updated_at`,
        platform, o.orderId, o.orderDate, o.status, String(o.statusRaw || '').slice(0, 120), o.sales, o.refund || 0, o.province, o.items ? 1 : 0, o.source, uploadId, now);
      if (!o.items) continue;
      store.run('DELETE FROM marketplace_order_items WHERE platform=? AND order_id=?', platform, o.orderId);
      for (const item of o.items) store.run('INSERT INTO marketplace_order_items(platform,order_id,line_key,sku,product_name,quantity,sales,status) VALUES(?,?,?,?,?,?,?,?)',
        platform, o.orderId, item.lineKey.slice(0, 120), item.sku.slice(0, 80), item.name.slice(0, 300), item.quantity, item.sales, item.status);
    }
    for (const s of parsed.settlements) store.run(`INSERT INTO marketplace_settlements(platform,txn_id,order_id,fees,net_payout,upload_id,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(platform,txn_id) DO UPDATE SET order_id=excluded.order_id,fees=excluded.fees,net_payout=excluded.net_payout,upload_id=excluded.upload_id,updated_at=excluded.updated_at`,
      platform, s.txnId, s.orderId, s.fees, s.netPayout, uploadId, now);
    return { uploadId, duplicate };
  });
}

export function marketplaceSummary(store, { platform, start, end }) {
  const where = "o.order_date BETWEEN ? AND ? AND (? = 'all' OR o.platform = ?)", p = [start, end, platform, platform];
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
    FROM marketplace_orders WHERE (? = 'all' OR platform = ?)`, platform, platform);
  return { platform, start, end, bounds, platforms, statuses, daily, topProducts: topProducts.map(({ productKey, ...row }) => ({ ...row, platforms: String(row.platforms || '').split(',') })), provinces };
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
      const { duplicate } = saveMarketplaceUpload(store, { platform, fileName, sha256, user: req.auth, parsed });
      audit.record(req.auth, 'marketplace.upload', 'marketplace', { platform, fileName, duplicate }, null, req.socket.remoteAddress);
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
    const uploads = store.all('SELECT id,platform,file_name AS fileName,uploaded_by_name AS uploadedBy,created_at AS createdAt FROM marketplace_uploads ORDER BY id DESC LIMIT 50');
    res.json({ uploads });
  });

  app.get('/api/marketplace/summary', requirePermission('marketplace_view'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Marketplace orders carry no sales territory, so territory-scoped accounts never see them.
    if (req.auth.scope === 'territory') return res.status(403).json({ error: 'ยอดขายออนไลน์ไม่รองรับบัญชีที่จำกัดเขต' });
    const { start, end } = req.query, platform = String(req.query.platform || 'all');
    if (platform !== 'all' && !PLATFORMS[platform]) return res.status(400).json({ error: 'แพลตฟอร์มไม่ถูกต้อง' });
    if (!validPeriod(start, end)) return res.status(400).json({ error: 'กรุณาระบุวันที่ให้ถูกต้อง ช่วงเวลาไม่เกิน 366 วัน' });
    try {
      res.json({ ...marketplaceSummary(store, { platform, start, end }), updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Marketplace summary failed:', error.code || error.name);
      res.status(500).json({ error: 'โหลดข้อมูลยอดขายออนไลน์ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });
}
