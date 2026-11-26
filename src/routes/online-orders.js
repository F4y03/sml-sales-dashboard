// จัดการออเดอร์ออนไลน์ — WooCommerce orders of the company website (proplusaudio.com).
// Access: src/middleware/access.js lets /api/online-orders/* through only with orders_view or orders_update;
// every write below additionally requires orders_update. The permission screen (/api/admin/order-permissions)
// is Super Admin only. WooCommerce keys stay on the server (src/services/wooCommerceApi.js). Nothing touches SML.
import { ORDER_PERMISSIONS } from '../config/access.js';
import { requirePermission, requireSuperAdmin, canViewOrders } from '../middleware/access.js';
import { hasPermission } from '../services/permissionService.js';
import { createWooClient, WooError } from '../services/wooCommerceApi.js';
import { buildWooAccountingWorkbook } from '../services/wooAccounting.js';

const STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];
const LEVELS = ['none', 'view', 'update'];
const BKK_OFFSET = 7 * 3600 * 1000;
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const orderId = v => (/^\d{1,12}$/.test(String(v)) && Number(v) > 0 ? Number(v) : null);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
// WooCommerce notes / option values may carry HTML; the browser only ever gets plain text.
const plain = v => String(v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8211;/g, '–').trim();
const gmt = v => (v ? String(v).replace(/Z?$/, 'Z') : null); // WooCommerce *_gmt fields have no zone suffix
const httpsUrl = v => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);
const fullName = a => [a?.first_name, a?.last_name].filter(Boolean).join(' ').trim();
const addressLines = a => [a?.company, a?.address_1, a?.address_2, [a?.city, a?.state, a?.postcode].filter(Boolean).join(' '), a?.country && a.country !== 'TH' ? a.country : ''].map(x => String(x || '').trim()).filter(Boolean);
// Start of "today" in Bangkok, as a UTC instant.
const bangkokDayStart = (now = Date.now()) => { const d = new Date(now + BKK_OFFSET); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - BKK_OFFSET); };
const wooTime = date => date.toISOString().slice(0, 19);

// ตรวจชำระ queue = pending / on-hold, plus bank-transfer orders the website already moved to processing that nobody
// has confirmed in the Dashboard yet (confirm stores VERIFIED_KEY in the order meta).
export const VERIFIED_KEY = 'prplus_payment_verified';
const isTransfer = o => o.payment_method === 'bacs' || /โอน|transfer/i.test(String(o.payment_method_title || ''));
const isVerified = o => (o.meta_data || []).some(m => m.key === VERIFIED_KEY && m.value);
export const needsVerify = o => ['pending', 'on-hold'].includes(o.status) || (o.status === 'processing' && isTransfer(o) && !isVerified(o));

export function summarizeOrder(o) {
  return {
    needsVerify: needsVerify(o),
    id: o.id, number: String(o.number || o.id), status: o.status,
    dateCreated: gmt(o.date_created_gmt), total: num(o.total), currency: o.currency || 'THB',
    customer: fullName(o.billing) || fullName(o.shipping) || 'ไม่ระบุชื่อ',
    phone: o.billing?.phone || o.shipping?.phone || '',
    paymentMethod: o.payment_method_title || o.payment_method || '',
    itemCount: (o.line_items || []).reduce((s, i) => s + num(i.quantity), 0),
    hasNote: Boolean(String(o.customer_note || '').trim()),
  };
}

export function detailOrder(o) {
  return {
    ...summarizeOrder(o),
    datePaid: gmt(o.date_paid_gmt), dateCompleted: gmt(o.date_completed_gmt),
    subtotal: (o.line_items || []).reduce((s, i) => s + num(i.subtotal), 0),
    shippingTotal: num(o.shipping_total), discountTotal: num(o.discount_total), totalTax: num(o.total_tax),
    transactionId: o.transaction_id || '',
    // ธนาคารที่ลูกค้าแจ้งโอน (saved by the site's แจ้งชำระเงิน form)
    fromBank: plain((o.meta_data || []).find(m => m.key === '_pp_from_bank' && typeof m.value === 'string')?.value || '').slice(0, 80),
    customerNote: plain(o.customer_note),
    billing: { name: fullName(o.billing), phone: o.billing?.phone || '', email: o.billing?.email || '', lines: addressLines(o.billing) },
    shipping: { name: fullName(o.shipping) || fullName(o.billing), phone: o.shipping?.phone || o.billing?.phone || '', lines: addressLines(o.shipping).length ? addressLines(o.shipping) : addressLines(o.billing) },
    shippingMethods: (o.shipping_lines || []).map(l => ({ title: plain(l.method_title), total: num(l.total) })),
    fees: (o.fee_lines || []).map(l => ({ name: plain(l.name), total: num(l.total) })),
    coupons: (o.coupon_lines || []).map(l => l.code).filter(Boolean),
    items: (o.line_items || []).map(i => ({
      name: plain(i.name), sku: i.sku || '', quantity: num(i.quantity), price: num(i.price), total: num(i.total),
      image: httpsUrl(i.image?.src),
      options: (i.meta_data || []).filter(m => m.key && !String(m.key).startsWith('_') && typeof (m.display_value ?? m.value) !== 'object')
        .map(m => ({ name: plain(m.display_key || m.key), value: plain(m.display_value ?? m.value) })),
    })),
  };
}

// Payment slips: slip plugins keep the image URL in order meta (keys vary by plugin) or link it in an order note.
// Only https image links are passed on; nothing else from meta reaches the browser.
const IMG = /https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/gi;
export function findSlips(order, notes = []) {
  const urls = new Set();
  for (const m of order.meta_data || []) {
    const v = typeof m.value === 'string' ? m.value : JSON.stringify(m.value ?? '');
    if (/slip|payment|transfer|proof|receipt|สลิป/i.test(String(m.key)) || /slip/i.test(v)) for (const u of v.match(IMG) || []) urls.add(u);
  }
  for (const n of notes) for (const u of String(n.note || '').match(IMG) || []) urls.add(u);
  return [...urls].slice(0, 6);
}
const mapNote = n => ({ id: n.id, author: n.author || '', date: gmt(n.date_created_gmt), note: plain(n.note), customerNote: Boolean(n.customer_note) });

export function installOnlineOrders(app, store, audit, { env = process.env, fetchImpl } = {}) {
  const woo = createWooClient(env, fetchImpl);
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (error) {
      if (error instanceof WooError) return res.status(error.status).json({ error: error.message, code: error.code });
      if (error?.status && error?.publicMessage) return res.status(error.status).json({ error: error.publicMessage });
      console.error('Online orders failed:', error?.code || error?.name || 'INTERNAL');
      res.status(500).json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' });
    }
  };
  const bad = message => Object.assign(new Error(message), { status: 400, publicMessage: message });
  const canUpdate = user => hasPermission(user, 'orders_update');
  // All processing orders (up to 1,000), used to split them into "not yet checked" vs "ready to ship".
  async function processingOrders(query = {}) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const r = await woo.wc('orders', { query: { status: 'processing', per_page: 100, page, orderby: 'date', order: 'desc', ...query } });
      out.push(...(r.data || []));
      if (page >= (r.totalPages || 1)) break;
    }
    return out;
  }

  app.get('/api/online-orders/me', handle((req, res) => res.json({
    canUpdate: canUpdate(req.auth), canManagePermissions: req.auth.role === 'super_admin', configured: woo.configured(),
    canAccounting: hasPermission(req.auth, 'marketplace_accounting'),
  })));

  app.get('/api/online-orders/summary', handle(async (_req, res) => {
    const todayStart = bangkokDayStart();
    const count = query => woo.wc('orders', { query: { per_page: 1, _fields: 'id', ...query } }).then(r => r.total);
    const [pending, onHold, { processing, unverified }, overdue, completedToday] = await Promise.all([
      count({ status: 'pending' }),
      count({ status: 'on-hold' }),
      (async () => {
        const all = await processingOrders({ _fields: 'id,status,payment_method,payment_method_title,meta_data' });
        return { processing: all.length, unverified: all.filter(needsVerify).length };
      })(),
      count({ status: 'processing', before: wooTime(new Date(Date.now() - 2 * 86400000)), dates_are_gmt: true }),
      (async () => {
        // "ส่งแล้ววันนี้" = orders marked completed since 00:00 Bangkok time (modified_after narrows the scan).
        let n = 0;
        for (let page = 1; page <= 5; page++) {
          const r = await woo.wc('orders', { query: { status: 'completed', modified_after: wooTime(todayStart), dates_are_gmt: true, per_page: 100, page, _fields: 'id,date_completed_gmt' } });
          n += (r.data || []).filter(o => o.date_completed_gmt && Date.parse(gmt(o.date_completed_gmt)) >= todayStart.getTime()).length;
          if (page >= r.totalPages) break;
        }
        return n;
      })(),
    ]);
    res.json({ awaitingPayment: pending + onHold + unverified, pending, onHold, unverified, processing: processing - unverified, completedToday, overdue, checkedAt: new Date().toISOString() });
  }));

  app.get('/api/online-orders', handle(async (req, res) => {
    // 'verify' = ตรวจชำระ queue: waiting for payment or for the slip to be checked.
    // Tab groups: verify = ตรวจชำระ, closed = ยกเลิก/คืนเงิน/ชำระไม่สำเร็จ.
    const GROUPS = { verify: 'on-hold,pending', closed: 'cancelled,refunded,failed' };
    const status = req.query.status === 'any' || GROUPS[req.query.status] ? req.query.status : STATUSES.includes(req.query.status) ? req.query.status : 'processing';
    const page = Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const perPage = Math.min(100, Math.max(10, Number.parseInt(req.query.per_page, 10) || 50));
    const search = text(req.query.q, 80);
    // Optional filters used when a chart on หน้าเว็บไซต์ links here: order date range (shop time) and product id.
    const start = validDate(req.query.start) ? req.query.start : null;
    const end = validDate(req.query.end) ? req.query.end : start;
    if (start && end < start) throw bad('ช่วงวันที่ไม่ถูกต้อง');
    const product = orderId(req.query.product);
    const filters = { search, after: start ? start + 'T00:00:00' : undefined, before: end ? end + 'T23:59:59' : undefined, product: product || undefined };
    if (status === 'verify' || status === 'processing') {
      // Split processing orders by needsVerify, then page in memory.
      const proc = await processingOrders(filters);
      let rows = proc.filter(o => needsVerify(o) === (status === 'verify'));
      if (status === 'verify') {
        const waiting = [];
        for (let p = 1; p <= 10; p++) {
          const r = await woo.wc('orders', { query: { status: GROUPS.verify, per_page: 100, page: p, orderby: 'date', order: 'desc', ...filters } });
          waiting.push(...(r.data || []));
          if (p >= (r.totalPages || 1)) break;
        }
        rows = [...new Map([...waiting, ...rows].map(o => [o.id, o])).values()].sort((a, b) => String(b.date_created_gmt).localeCompare(String(a.date_created_gmt)));
      }
      const total = rows.length, totalPages = Math.max(1, Math.ceil(total / perPage));
      return res.json({ status, page, perPage, search, start, end, product, total, totalPages, orders: rows.slice((page - 1) * perPage, page * perPage).map(summarizeOrder) });
    }
    const r = await woo.wc('orders', { query: { status: GROUPS[status] || status, page, per_page: perPage, orderby: 'date', order: 'desc', ...filters } });
    res.json({ status, page, perPage, search, start, end, product, total: r.total, totalPages: r.totalPages, orders: (r.data || []).map(summarizeOrder) });
  }));

  // Shop name/address for the A6 shipping label's sender block. Optional: the label still prints without it.
  let storeCache = null;
  app.get('/api/online-orders/store', handle(async (_req, res) => {
    if (!storeCache || Date.now() - storeCache.at > 3600000) {
      const r = await woo.wc('settings/general').catch(() => ({ data: [] }));
      const get = id => (r.data || []).find(s => s.id === id)?.value || '';
      storeCache = { at: Date.now(), data: { name: text(env.WC_SENDER_NAME, 120) || 'PROPLUS AUDIO', phone: text(env.WC_SENDER_PHONE, 40),
        lines: [get('woocommerce_store_address'), get('woocommerce_store_address_2'), [get('woocommerce_store_city'), get('woocommerce_store_postcode')].filter(Boolean).join(' ')].filter(Boolean) } };
    }
    res.json(storeCache.data);
  }));

  app.get('/api/online-orders/sales', handle(async (req, res) => {
    const { start, end } = req.query;
    if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 366) throw bad('กรุณาเลือกช่วงวันที่ให้ถูกต้อง (ไม่เกิน 366 วัน)');
    const [salesR, topR] = await Promise.all([
      woo.wc('reports/sales', { query: { date_min: start, date_max: end } }),
      woo.wc('reports/top_sellers', { query: { date_min: start, date_max: end } }),
    ]);
    const report = Array.isArray(salesR.data) ? salesR.data[0] || {} : {};
    const totalSales = num(report.total_sales), orders = num(report.total_orders);
    // Daily chart: wc-analytics revenue stats (interval=day); falls back to the legacy report's per-day totals.
    let daily = [], dailySource = 'wc-analytics';
    try {
      for (let page = 1; page <= 4; page++) {
        const r = await woo.analytics('reports/revenue/stats', { query: { interval: 'day', after: start + 'T00:00:00', before: end + 'T23:59:59', per_page: 100, page, order: 'asc' } });
        for (const i of r.data?.intervals || []) daily.push({ date: String(i.interval).slice(0, 10), sales: num(i.subtotals?.total_sales), orders: num(i.subtotals?.orders_count) });
        if (page >= (r.totalPages || 1)) break;
      }
    } catch {
      dailySource = 'reports/sales';
      daily = Object.entries(report.totals || {}).map(([date, t]) => ({ date: date.slice(0, 10), sales: num(t.sales), orders: num(t.orders) }));
    }
    daily.sort((a, b) => a.date.localeCompare(b.date));
    const top = (Array.isArray(topR.data) ? topR.data : []).slice(0, 10);
    // Enrich the top sellers with SKU / image / price (best effort).
    const ids = top.map(t => t.product_id).filter(Boolean);
    const products = new Map();
    if (ids.length) {
      const r = await woo.wc('products', { query: { include: ids.join(','), per_page: ids.length, _fields: 'id,sku,price,images' } }).catch(() => ({ data: [] }));
      for (const p of r.data || []) products.set(p.id, p);
    }
    res.json({
      start, end, totalSales, orders, averagePerOrder: orders ? totalSales / orders : 0,
      netSales: num(report.net_sales), totalItems: num(report.total_items), totalRefunds: num(report.total_refunds),
      daily, dailySource,
      topSellers: top.map(t => { const p = products.get(t.product_id); return { productId: t.product_id, name: plain(t.name), quantity: num(t.quantity), sku: p?.sku || '', price: num(p?.price), image: httpsUrl(p?.images?.[0]?.src) }; }),
    });
  }));

  // รายงานบัญชี (same workbook layout as the marketplace one; same marketplace_accounting permission, on top of the
  // order-page permission checked in access.js). Orders by order date (shop time), every status.
  app.get('/api/online-orders/accounting-report', requirePermission('marketplace_accounting'), handle(async (req, res) => {
    const { start, end } = req.query;
    if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 366) throw bad('กรุณาระบุวันที่ให้ถูกต้อง ช่วงเวลาไม่เกิน 366 วัน');
    const orders = [];
    let truncated = false;
    for (let page = 1; page <= 50; page++) {
      const r = await woo.wc('orders', { query: { status: 'any', after: start + 'T00:00:00', before: end + 'T23:59:59', per_page: 100, page, orderby: 'date', order: 'asc',
        _fields: 'id,number,status,date_created_gmt,date_paid_gmt,payment_method,payment_method_title,line_items,discount_total,shipping_total,total_tax,total,refunds' } });
      orders.push(...(r.data || []));
      if (page >= r.totalPages) break;
      if (page === 50) truncated = true;
    }
    const body = await buildWooAccountingWorkbook(orders, { start, end, truncated }, { by: req.auth.full_name || req.auth.username });
    audit.record(req.auth, 'orders.accounting_report', 'online_orders', { start, end, orders: orders.length }, null, req.socket.remoteAddress);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="website-accounting-${start}-${end}.xlsx"` }).send(body);
  }));

  app.get('/api/online-orders/:id', handle(async (req, res) => {
    const id = orderId(req.params.id);
    if (!id) throw bad('เลขออเดอร์ไม่ถูกต้อง');
    const [order, notes, seed] = await Promise.all([woo.wc(`orders/${id}`), woo.wc(`orders/${id}/notes`, { query: { type: 'any' } }), seedSlips(id)]);
    const slips = [...seed.map(s => `/api/online-orders/${id}/slip/${s}`), ...findSlips(order.data, notes.data || [])].slice(0, 6);
    res.json({ order: { ...detailOrder(order.data), slips }, notes: (notes.data || []).map(mapNote), canUpdate: canUpdate(req.auth) });
  }));

  // Seed Confirm slips, via the "PRPLUS Dashboard – slip" Code Snippet on the website (wc/v3/prplus-slips/<order>).
  // Missing snippet / any error → no slips (the page then says none were found).
  async function seedSlips(id) {
    try {
      const r = await woo.wc(`prplus-slips/${id}`);
      return (r.data?.slips || []).filter(s => s.type === 'seed_confirm_log' && Number.isInteger(s.id) && s.id > 0).map(s => s.id);
    } catch { return []; }
  }
  // Slip image proxy: the WooCommerce key stays on the server; only slips that belong to this order are served.
  app.get('/api/online-orders/:id/slip/:slip', handle(async (req, res) => {
    const id = orderId(req.params.id), slip = orderId(req.params.slip);
    if (!id || !slip) throw bad('เลขออเดอร์ไม่ถูกต้อง');
    if (!(await seedSlips(id)).includes(slip)) throw Object.assign(new Error('nf'), { status: 404, publicMessage: 'ไม่พบสลิปของออเดอร์นี้' });
    const img = await woo.image(`prplus-slip-image/${slip}`);
    res.set({ 'Content-Type': img.type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(img.body);
  }));

  // ตรวจการชำระเงิน: confirm → mark paid (sets date_paid) and move to processing, with an internal note of who checked;
  // reject → note only (status unchanged), optionally visible to the customer. Only for pending / on-hold orders.
  app.post('/api/online-orders/:id/payment', requirePermission('orders_update'), handle(async (req, res) => {
    const id = orderId(req.params.id), action = req.body?.action;
    if (!id) throw bad('เลขออเดอร์ไม่ถูกต้อง');
    if (!['confirm', 'reject'].includes(action)) throw bad('คำสั่งไม่ถูกต้อง');
    const extra = text(req.body.note, 500), transferAt = text(req.body.transferAt, 40);
    const cur = (await woo.wc(`orders/${id}`, { query: { _fields: 'id,status,total,payment_method,payment_method_title,meta_data' } })).data;
    if (!cur || !needsVerify(cur)) throw bad('ออเดอร์นี้ไม่ได้อยู่ในสถานะรอชำระ/รอตรวจสลิปแล้ว กรุณารีเฟรช');
    const who = req.auth.full_name || req.auth.username;
    const amount = Number(cur.total || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
    let order = null;
    if (action === 'confirm') {
      order = (await woo.wc(`orders/${id}`, { method: 'PUT', body: { set_paid: true, status: 'processing', meta_data: [{ key: VERIFIED_KEY, value: `${who} ${new Date().toISOString()}` }] } })).data;
      await woo.wc(`orders/${id}/notes`, { method: 'POST', body: { customer_note: false, note: `ตรวจสอบการชำระเงินแล้ว ยอด ฿${amount}${transferAt ? `
เวลาโอนตามสลิป: ${transferAt}` : ''}${extra ? `
หมายเหตุ: ${extra}` : ''}
โดย ${who} (Dashboard)` } });
    } else {
      if (!extra) throw bad('กรุณาระบุเหตุผลที่ไม่พบยอดเงิน');
      const notify = req.body.notifyCustomer === true;
      await woo.wc(`orders/${id}/notes`, { method: 'POST', body: { customer_note: notify, note: notify ? `ร้านยังตรวจไม่พบยอดชำระของคำสั่งซื้อนี้: ${extra}
กรุณาติดต่อร้านหรือส่งหลักฐานการโอนอีกครั้ง` : `ตรวจไม่พบยอดเงิน: ${extra}
โดย ${who} (Dashboard)` } });
    }
    audit.record(req.auth, action === 'confirm' ? 'orders.payment_confirm' : 'orders.payment_reject', 'online_orders', { orderId: id, from: cur.status }, null, req.socket.remoteAddress);
    res.json({ ok: true, status: order?.status || cur.status });
  }));

  app.put('/api/online-orders/:id/status', requirePermission('orders_update'), handle(async (req, res) => {
    const id = orderId(req.params.id), status = req.body?.status;
    if (!id) throw bad('เลขออเดอร์ไม่ถูกต้อง');
    if (!STATUSES.includes(status)) throw bad('สถานะไม่ถูกต้อง');
    const before = await woo.wc(`orders/${id}`, { query: { _fields: 'id,status' } });
    const r = await woo.wc(`orders/${id}`, { method: 'PUT', body: { status } });
    audit.record(req.auth, 'orders.status', 'online_orders', { orderId: id, from: before.data?.status, to: status }, null, req.socket.remoteAddress);
    res.json({ order: detailOrder(r.data) });
  }));

  app.post('/api/online-orders/:id/notes', requirePermission('orders_update'), handle(async (req, res) => {
    const id = orderId(req.params.id), kind = req.body?.kind;
    if (!id) throw bad('เลขออเดอร์ไม่ถูกต้อง');
    let note, customerNote;
    if (kind === 'tracking') {
      const tracking = text(req.body.tracking, 60), carrier = text(req.body.carrier, 60);
      if (!tracking || !/^[\w\- ]+$/.test(tracking)) throw bad('กรุณากรอกเลขพัสดุ (ตัวอักษรภาษาอังกฤษ ตัวเลข และ - เท่านั้น)');
      if (!carrier) throw bad('กรุณาเลือกบริษัทขนส่ง');
      note = `จัดส่งสินค้าแล้ว\nขนส่ง: ${carrier}\nเลขพัสดุ: ${tracking}`;
      customerNote = true;
    } else if (kind === 'internal' || kind === 'serial') {
      const body = text(req.body.text, 1000);
      if (!body) throw bad(kind === 'serial' ? 'กรุณากรอก Serial number' : 'กรุณากรอกข้อความโน้ต');
      note = kind === 'serial' ? `Serial number: ${body}` : body;
      customerNote = false;
    } else throw bad('ประเภทโน้ตไม่ถูกต้อง');
    const r = await woo.wc(`orders/${id}/notes`, { method: 'POST', body: { note, customer_note: customerNote } });
    audit.record(req.auth, 'orders.note', 'online_orders', { orderId: id, kind }, null, req.socket.remoteAddress);
    res.status(201).json({ note: mapNote(r.data || {}) });
  }));

  // ---------- จัดการสิทธิ์ (Super Admin only) ----------
  const levelOf = codes => (codes.includes('orders_update') ? 'update' : codes.includes('orders_view') ? 'view' : 'none');
  function permissionRows() {
    const users = store.all(`SELECT u.id,u.username,u.full_name,u.is_active,u.role_id,r.code AS role,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id ORDER BY (r.code='super_admin') DESC,(r.code='admin') DESC,u.username`);
    const placeholders = ORDER_PERMISSIONS.map(() => '?').join(',');
    const rolePerms = store.all(`SELECT rp.role_id,p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.code IN (${placeholders})`, ...ORDER_PERMISSIONS);
    const userPerms = store.all(`SELECT up.user_id,p.code FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE p.code IN (${placeholders})`, ...ORDER_PERMISSIONS);
    const execGrants = new Set(store.all("SELECT up.user_id FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE p.code='exec_sales_view'").map(x => x.user_id));
    return users.map(u => {
      const roleLevel = u.role === 'super_admin' ? 'update' : levelOf(rolePerms.filter(x => x.role_id === u.role_id).map(x => x.code));
      const userLevel = levelOf(userPerms.filter(x => x.user_id === u.id).map(x => x.code));
      const effective = LEVELS[Math.max(LEVELS.indexOf(roleLevel), LEVELS.indexOf(userLevel))];
      return { id: u.id, username: u.username, fullName: u.full_name || '', active: Boolean(u.is_active), role: u.role, roleName: u.role_name, roleLevel, userLevel, effective,
        // หน้าเว็บไซต์: Super Admin always; others only by a per-user grant (role grants are ignored, see canViewExecSales).
        execSales: u.role === 'super_admin' || execGrants.has(u.id) };
    });
  }
  function permissionLog() {
    return store.all(`SELECT l.id,l.action,l.created_at,l.details,a.username AS actor FROM activity_logs l LEFT JOIN users a ON a.id=l.user_id WHERE l.action IN ('orders.permission','exec_sales.permission') ORDER BY l.id DESC LIMIT 100`).map(row => {
      let d = {}; try { d = JSON.parse(row.details) || {}; } catch {}
      const target = Number.isInteger(d.userId) ? store.get('SELECT username,full_name FROM users WHERE id=?', d.userId) : null;
      return { id: row.id, at: row.created_at ? row.created_at.replace(' ', 'T') + 'Z' : null, actor: row.actor || '—', target: target?.username || d.username || '(ลบแล้ว)', targetName: target?.full_name || '', kind: row.action === 'exec_sales.permission' ? 'exec_sales' : 'orders', from: d.from, to: d.to };
    });
  }
  const adminHandle = fn => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { fn(req, res); } catch (error) {
      if (error?.publicMessage) return res.status(error.status).json({ error: error.publicMessage });
      console.error('Order permissions failed:', error?.code || 'INTERNAL');
      res.status(500).json({ error: 'บันทึกสิทธิ์ไม่สำเร็จ กรุณาลองใหม่' });
    }
  };
  app.get('/api/admin/order-permissions', requireSuperAdmin, adminHandle((_req, res) => res.json({ users: permissionRows(), log: permissionLog() })));
  app.put('/api/admin/order-permissions/:id', requireSuperAdmin, adminHandle((req, res) => {
    const id = orderId(req.params.id), level = req.body?.level;
    if (!id) throw bad('ผู้ใช้ไม่ถูกต้อง');
    if (!LEVELS.includes(level)) throw bad('ระดับสิทธิ์ไม่ถูกต้อง');
    const target = store.get('SELECT u.id,u.username,r.code AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', id);
    if (!target) throw Object.assign(new Error('not found'), { status: 404, publicMessage: 'ไม่พบผู้ใช้' });
    if (target.role === 'super_admin') throw bad('Super Admin มีสิทธิ์ทั้งหมดอยู่แล้ว เปลี่ยนไม่ได้');
    const before = permissionRows().find(u => u.id === id);
    store.transaction(() => {
      store.run(`DELETE FROM user_permissions WHERE user_id=? AND permission_id IN (SELECT id FROM permissions WHERE code IN (${ORDER_PERMISSIONS.map(() => '?').join(',')}))`, id, ...ORDER_PERMISSIONS);
      const grant = level === 'update' ? ORDER_PERMISSIONS : level === 'view' ? ['orders_view'] : [];
      for (const code of grant) store.run('INSERT INTO user_permissions SELECT ?,id FROM permissions WHERE code=?', id, code);
      audit.record(req.auth, 'orders.permission', 'online_orders', { userId: id, username: target.username, from: before.userLevel, to: level }, null, req.socket.remoteAddress);
    });
    res.json({ user: permissionRows().find(u => u.id === id), log: permissionLog() });
  }));
  app.put('/api/admin/order-permissions/:id/exec-sales', requireSuperAdmin, adminHandle((req, res) => {
    const id = orderId(req.params.id), enabled = req.body?.enabled;
    if (!id) throw bad('ผู้ใช้ไม่ถูกต้อง');
    if (typeof enabled !== 'boolean') throw bad('ค่าสิทธิ์ไม่ถูกต้อง');
    const target = store.get('SELECT u.id,u.username,r.code AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', id);
    if (!target) throw Object.assign(new Error('not found'), { status: 404, publicMessage: 'ไม่พบผู้ใช้' });
    if (target.role === 'super_admin') throw bad('Super Admin เห็นเมนูเว็บไซต์เสมอ เปลี่ยนไม่ได้');
    const before = permissionRows().find(u => u.id === id).execSales;
    store.transaction(() => {
      store.run("DELETE FROM user_permissions WHERE user_id=? AND permission_id=(SELECT id FROM permissions WHERE code='exec_sales_view')", id);
      if (enabled) store.run("INSERT INTO user_permissions SELECT ?,id FROM permissions WHERE code='exec_sales_view'", id);
      audit.record(req.auth, 'exec_sales.permission', 'exec_sales', { userId: id, username: target.username, from: before, to: enabled }, null, req.socket.remoteAddress);
    });
    res.json({ user: permissionRows().find(u => u.id === id), log: permissionLog() });
  }));
  return { canViewOrders };
}
