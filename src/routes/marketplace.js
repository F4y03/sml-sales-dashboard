// Online marketplace sales (Shopee / Lazada / TikTok Shop) from Seller Center exports. See MARKETPLACE.md.
// Uploaders (marketplace_upload) get only "อัปโหลดสำเร็จ" and the upload history — never totals or orders.
// The summary API needs marketplace_view. Data lives in the app SQLite database; SML is not touched.
import express from 'express';
import { createHash } from 'node:crypto';
import { sameSite } from '../middleware/auth.js';
import { requirePermission } from '../middleware/access.js';
import { hasPermission } from '../services/permissionService.js';
import { isReviewer } from '../config/access.js';
import { MAX_FILE_BYTES, MarketplaceFileError, PLATFORMS, parseMarketplaceFile } from '../services/marketplaceParser.js';
import { REVIEWER_MONTHS, reviewerFloor, feeDetailJson, saveMarketplaceUpload, orderDetail, orderFees, marketplaceSummary, resolveUploadShop, deleteMarketplaceUpload, validPeriod, cleanFileName } from '../services/marketplaceStore.js';
import { buildAccountingWorkbook } from '../services/marketplaceAccounting.js';

// Re-exported so existing importers (shop modules, tests) keep working.
export { REVIEWER_MONTHS, reviewerFloor, feeDetailJson, saveMarketplaceUpload, orderDetail, orderFees, marketplaceSummary, resolveUploadShop, deleteMarketplaceUpload } from '../services/marketplaceStore.js';

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
  const listShops = () => store.all('SELECT id,name,active FROM marketplace_shops ORDER BY active DESC,id'); // oldest (main) shop first: pickers default to it
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

  // Per-order fees: sales (same definition as the summary), fees, net, % deducted (fees ÷ sales) and the fee breakdown.
  // Sold orders only (completed + pending); an order without settlement rows has fees/net/percent = null (no data, not 0).
  app.get('/api/marketplace/order-fees', requirePermission('marketplace_view'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.auth.scope === 'territory') return res.status(403).json({ error: 'ยอดขายออนไลน์ไม่รองรับบัญชีที่จำกัดเขต' });
    let { start, end } = req.query;
    const platform = String(req.query.platform || 'all'), shop = String(req.query.shop || 'all');
    const sort = ['date', 'percent', 'fees'].includes(req.query.sort) ? req.query.sort : 'date';
    const q = String(req.query.q || '').trim().slice(0, 80);
    const status = ['completed', 'pending'].includes(req.query.status) ? req.query.status : 'all';
    const fees = ['with', 'without'].includes(req.query.fees) ? req.query.fees : 'all';
    const page = Math.max(0, Math.min(100000, Number.parseInt(req.query.page, 10) || 0)), size = 10;
    if (platform !== 'all' && !PLATFORMS[platform]) return res.status(400).json({ error: 'แพลตฟอร์มไม่ถูกต้อง' });
    if (shop !== 'all' && !/^[1-9]\d{0,8}$/.test(shop)) return res.status(400).json({ error: 'ร้านไม่ถูกต้อง' });
    if (!validPeriod(start, end)) return res.status(400).json({ error: 'กรุณาระบุวันที่ให้ถูกต้อง ช่วงเวลาไม่เกิน 366 วัน' });
    const minDate = isReviewer(req.auth.role) ? reviewerFloor() : null;
    if (minDate && start < minDate) start = minDate;
    try {
      res.json({ ...orderFees(store, { platform, start, end, shop, sort, page, size, q, status, fees }), minDate, page, size });
    } catch (error) {
      console.error('Marketplace order fees failed:', error.code || error.name);
      res.status(500).json({ error: 'โหลดค่าธรรมเนียมรายออเดอร์ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });

  // One order for the order popup: order fields, product lines, settlement rows (fees / net / breakdown). No buyer data.
  app.get('/api/marketplace/order-detail', requirePermission('marketplace_view'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.auth.scope === 'territory') return res.status(403).json({ error: 'ยอดขายออนไลน์ไม่รองรับบัญชีที่จำกัดเขต' });
    const platform = String(req.query.platform || ''), id = String(req.query.id || '');
    if (!PLATFORMS[platform] || !/^[A-Za-z0-9_-]{1,60}$/.test(id)) return res.status(400).json({ error: 'ออเดอร์ไม่ถูกต้อง' });
    const order = orderDetail(store, platform, id);
    // Reviewers only see the last 3 months, like every other marketplace figure.
    if (!order || (isReviewer(req.auth.role) && order.orderDate < reviewerFloor())) return res.status(404).json({ error: 'ไม่พบออเดอร์นี้' });
    res.json(order);
  });

  // Accounting workbook for the filters on screen. Super Admin chooses who holds marketplace_accounting.
  app.get('/api/marketplace/accounting-report', requirePermission('marketplace_accounting'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.auth.scope === 'territory') return res.status(403).json({ error: 'ยอดขายออนไลน์ไม่รองรับบัญชีที่จำกัดเขต' });
    const { start, end } = req.query, platform = String(req.query.platform || 'all'), shop = String(req.query.shop || 'all');
    if (platform !== 'all' && !PLATFORMS[platform]) return res.status(400).json({ error: 'แพลตฟอร์มไม่ถูกต้อง' });
    if (shop !== 'all' && !/^[1-9]\d{0,8}$/.test(shop)) return res.status(400).json({ error: 'ร้านไม่ถูกต้อง' });
    if (!validPeriod(start, end)) return res.status(400).json({ error: 'กรุณาระบุวันที่ให้ถูกต้อง ช่วงเวลาไม่เกิน 366 วัน' });
    try {
      const body = await buildAccountingWorkbook(store, { platform, shop, start, end }, { by: req.auth.full_name || req.auth.username });
      audit.record(req.auth, 'marketplace.accounting_report', 'marketplace', { platform, shop, start, end }, null, req.socket.remoteAddress);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="online-sales-accounting-${platform}-${start}-${end}.xlsx"` }).send(body);
    } catch (error) {
      console.error('Marketplace accounting report failed:', error.code || error.name);
      res.status(500).json({ error: 'ออกรายงานบัญชีไม่สำเร็จ กรุณาลองใหม่' });
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
      if (!isReviewer(req.auth.role)) return res.json({ ...marketplaceSummary(store, { platform, start, end, shop }), updatedAt: new Date().toISOString() });
      // start > end (whole range before the floor) matches no orders.
      const minDate = reviewerFloor(), data = marketplaceSummary(store, { platform, start: start < minDate ? minDate : start, end, shop });
      if (data.bounds?.first && data.bounds.first < minDate) data.bounds.first = minDate;
      if (data.bounds?.last && data.bounds.last < minDate) data.bounds = { ...data.bounds, first: null, last: null };
      res.json({ ...data, minDate, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Marketplace summary failed:', error.code || error.name);
      res.status(500).json({ error: 'โหลดข้อมูลยอดขายออนไลน์ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });
}
