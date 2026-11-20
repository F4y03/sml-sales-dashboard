// หน้าเว็บไซต์ — WooCommerce (proplusaudio.com) sales analytics. Access is checked in src/middleware/access.js
// (canViewExecSales: Super Admin or a per-user grant by Super Admin) for the page and every /api/exec-sales route.
// Keys stay on the server (wooCommerceApi.js). Results are cached in memory for 1 minute per query so the shop
// is not hammered. Nothing touches SML.
import ExcelJS from 'exceljs';
import { canViewOrders } from '../middleware/access.js';
import { createWooClient, WooError } from '../services/wooCommerceApi.js';
import { provinceFromPostcode } from '../services/thaiPostcode.js';

const TTL = 60 * 1000; // matches the page auto-refresh
const PAID = new Set(['processing', 'completed', 'on-hold']); // statuses WooCommerce Analytics counts as sales
const INTERVALS = ['hour', 'day', 'week', 'month'];
const MAX_ORDER_PAGES = 50; // 5,000 orders per range; beyond that the order-based charts say they are partial
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
const bangkok = iso => new Date(Date.parse(String(iso).replace(/Z?$/, 'Z')) + 7 * 3600000); // *_gmt → Bangkok wall clock (UTC fields)
const plain = v => String(v ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();

const REGIONS = {
  'กรุงเทพฯ และปริมณฑล': ['กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ', 'สมุทรสาคร', 'นครปฐม'],
  'ภาคเหนือ': ['เชียงใหม่', 'เชียงราย', 'ลำพูน', 'ลำปาง', 'แพร่', 'น่าน', 'พะเยา', 'แม่ฮ่องสอน', 'อุตรดิตถ์', 'ตาก', 'สุโขทัย', 'พิษณุโลก', 'พิจิตร', 'กำแพงเพชร', 'เพชรบูรณ์', 'นครสวรรค์', 'อุทัยธานี'],
  'ภาคตะวันออก': ['ชลบุรี', 'ระยอง', 'จันทบุรี', 'ตราด', 'ฉะเชิงเทรา', 'ปราจีนบุรี', 'สระแก้ว'],
  'ภาคตะวันออกเฉียงเหนือ': ['นครราชสีมา', 'บุรีรัมย์', 'สุรินทร์', 'ศรีสะเกษ', 'อุบลราชธานี', 'ยโสธร', 'ชัยภูมิ', 'อำนาจเจริญ', 'บึงกาฬ', 'หนองบัวลำภู', 'ขอนแก่น', 'อุดรธานี', 'เลย', 'หนองคาย', 'มหาสารคาม', 'ร้อยเอ็ด', 'กาฬสินธุ์', 'สกลนคร', 'นครพนม', 'มุกดาหาร'],
  'ภาคใต้': ['นครศรีธรรมราช', 'กระบี่', 'พังงา', 'ภูเก็ต', 'สุราษฎร์ธานี', 'ระนอง', 'ชุมพร', 'สงขลา', 'สตูล', 'ตรัง', 'พัทลุง', 'ปัตตานี', 'ยะลา', 'นราธิวาส'],
};
const REGION_OF = new Map(Object.entries(REGIONS).flatMap(([r, list]) => list.map(p => [p, r])));
export const regionOf = province => (!province ? 'ไม่ระบุ' : REGION_OF.get(province) || 'ภาคกลาง');
export function provinceOf(order) {
  const p = provinceFromPostcode(order.shipping?.postcode) || provinceFromPostcode(order.billing?.postcode);
  if (p) return p;
  const state = order.shipping?.state || order.billing?.state;
  return state === 'TH-10' ? 'กรุงเทพมหานคร' : null;
}

export function installExecSales(app, { env = process.env, fetchImpl } = {}) {
  const woo = createWooClient(env, fetchImpl);
  const cache = new Map();
  function cached(key, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.promise;
    const promise = fn().catch(error => { cache.delete(key); throw error; });
    cache.set(key, { at: Date.now(), promise });
    if (cache.size > 80) for (const [k, v] of cache) if (Date.now() - v.at >= TTL || cache.size > 80) cache.delete(k);
    return promise;
  }
  const bad = message => Object.assign(new Error(message), { status: 400, publicMessage: message });
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (error) {
      if (error instanceof WooError) return res.status(error.status).json({ error: error.message, code: error.code });
      if (error?.publicMessage) return res.status(error.status).json({ error: error.publicMessage });
      console.error('Exec sales failed:', error?.code || error?.name || 'INTERNAL');
      res.status(500).json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' });
    }
  };
  function range(q) {
    const { start, end } = q;
    if (!validDate(start) || !validDate(end) || start > end || daysBetween(start, end) > 366) throw bad('กรุณาเลือกช่วงวันที่ให้ถูกต้อง (ไม่เกิน 366 วัน)');
    const days = daysBetween(start, end);
    const prevEnd = addDays(start, -1);
    return { start, end, days, prevStart: addDays(prevEnd, -(days - 1)), prevEnd };
  }

  // wc-analytics revenue stats, all pages. Each interval: start date/time + the subtotals the cards and charts need.
  async function revenue(start, end, interval) {
    const intervals = [];
    let totals = {};
    for (let page = 1; page <= 12; page++) {
      const r = await woo.analytics('reports/revenue/stats', { query: { interval, after: start + 'T00:00:00', before: end + 'T23:59:59', per_page: 100, page, order: 'asc', orderby: 'date' } });
      totals = r.data?.totals || totals;
      for (const i of r.data?.intervals || []) {
        const s = i.subtotals || {};
        intervals.push({ key: String(i.interval), start: String(i.date_start || '').replace(' ', 'T'), end: String(i.date_end || '').replace(' ', 'T'),
          net: num(s.net_revenue), orders: num(s.orders_count), aov: num(s.avg_order_value), discount: num(s.coupons), refunds: Math.abs(num(s.refunds)) });
      }
      if (page >= (r.totalPages || 1)) break;
    }
    return { totals: { net: num(totals.net_revenue), orders: num(totals.orders_count), aov: num(totals.avg_order_value), discount: num(totals.coupons), refunds: Math.abs(num(totals.refunds)), gross: num(totals.gross_sales) }, intervals };
  }
  async function allOrders(start, end) {
    const out = [];
    let truncated = false;
    for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
      const r = await woo.wc('orders', { query: { status: 'any', after: start + 'T00:00:00', before: end + 'T23:59:59', per_page: 100, page, orderby: 'date', order: 'asc',
        _fields: 'id,status,date_created_gmt,total,shipping,billing' } });
      out.push(...(r.data || []));
      if (page >= r.totalPages) break;
      if (page === MAX_ORDER_PAGES) truncated = true;
    }
    return { orders: out, truncated };
  }
  const bucketOf = days => (days <= 92 ? 'day' : 'month');
  const bucketKey = (ymd, bucket) => (bucket === 'day' ? ymd : ymd.slice(0, 7));

  async function overview(rg) {
    const { start, end, prevStart, prevEnd, days } = rg;
    const sparkInterval = days <= 2 ? 'hour' : 'day';
    const bucket = bucketOf(days);
    const section = p => p.then(value => ({ ok: true, ...value }), error => ({ ok: false, error: error instanceof WooError ? error.message : 'ดึงข้อมูลส่วนนี้ไม่สำเร็จ' }));
    const ordersP = allOrders(start, end);
    const [kpis, statusChart, products, categories, provinces, statusTotals] = await Promise.all([
      section((async () => {
        const [cur, prev] = await Promise.all([revenue(start, end, sparkInterval), revenue(prevStart, prevEnd, 'day')]);
        return { current: cur.totals, previous: prev.totals, spark: cur.intervals.map(i => ({ start: i.start, net: i.net, orders: i.orders, aov: i.aov, discount: i.discount, refunds: i.refunds })), sparkInterval };
      })()),
      section(ordersP.then(({ orders, truncated }) => {
        const statuses = new Map(); // status → Map(bucket → count)
        for (const o of orders) {
          const k = bucketKey(bangkok(o.date_created_gmt).toISOString().slice(0, 10), bucket);
          if (!statuses.has(o.status)) statuses.set(o.status, new Map());
          const m = statuses.get(o.status); m.set(k, (m.get(k) || 0) + 1);
        }
        return { bucket, truncated, series: [...statuses].map(([status, m]) => ({ status, counts: Object.fromEntries(m) })) };
      })),
      section((async () => {
        const q = orderby => woo.analytics('reports/products', { query: { after: start + 'T00:00:00', before: end + 'T23:59:59', orderby, order: 'desc', per_page: 10, extended_info: true } });
        const map = r => (r.data || []).map(p => ({ id: p.product_id, name: plain(p.extended_info?.name) || `สินค้า #${p.product_id}`, sku: p.extended_info?.sku || '', net: num(p.net_revenue), qty: num(p.items_sold), orders: num(p.orders_count) }));
        const [byNet, byQty] = await Promise.all([q('net_revenue'), q('items_sold')]);
        return { byNet: map(byNet), byQty: map(byQty) };
      })()),
      section(woo.analytics('reports/categories', { query: { after: start + 'T00:00:00', before: end + 'T23:59:59', orderby: 'net_revenue', order: 'desc', per_page: 100, extended_info: true } })
        .then(r => ({ items: (r.data || []).map(c => ({ id: c.category_id, name: plain(c.extended_info?.name) || `หมวด #${c.category_id}`, net: num(c.net_revenue), qty: num(c.items_sold) })).filter(c => c.net > 0) }))),
      section(ordersP.then(({ orders, truncated }) => {
        const prov = new Map(), reg = new Map();
        for (const o of orders) {
          if (!PAID.has(o.status)) continue;
          const p = provinceOf(o), r = regionOf(p), t = num(o.total);
          const a = prov.get(p || 'ไม่ระบุ') || { name: p || 'ไม่ระบุ', region: r, total: 0, orders: 0 }; a.total += t; a.orders++; prov.set(a.name, a);
          const b = reg.get(r) || { name: r, total: 0, orders: 0 }; b.total += t; b.orders++; reg.set(r, b);
        }
        const sort = m => [...m.values()].sort((x, y) => y.total - x.total);
        return { truncated, provinces: sort(prov).slice(0, 10), regions: sort(reg) };
      })),
      section(woo.wc('reports/orders/totals').then(r => ({ items: (r.data || []).map(s => ({ status: s.slug, name: plain(s.name), total: num(s.total) })) }))),
    ]);
    return { ...rg, generatedAt: new Date().toISOString(), kpis, statusChart, products, categories, provinces, statusTotals };
  }

  app.get('/api/exec-sales/me', handle((req, res) => res.json({ canViewOrders: canViewOrders(req.auth), configured: woo.configured() })));

  app.get('/api/exec-sales/overview', handle(async (req, res) => {
    const rg = range(req.query);
    if (!woo.configured()) await woo.wc('orders'); // throws the Thai "not configured" 503
    res.json(await cached(`ov:${rg.start}:${rg.end}`, () => overview(rg)));
  }));

  app.get('/api/exec-sales/timeline', handle(async (req, res) => {
    const rg = range(req.query);
    let interval = INTERVALS.includes(req.query.interval) ? req.query.interval : 'day';
    if (interval === 'hour' && rg.days > 7) interval = 'day'; // hourly only up to 7 days (≤ 168 points)
    const data = await cached(`tl:${rg.start}:${rg.end}:${interval}`, async () => {
      const [cur, prev] = await Promise.all([revenue(rg.start, rg.end, interval), revenue(rg.prevStart, rg.prevEnd, interval)]);
      return { ...rg, interval, current: cur.intervals.map(i => ({ start: i.start, end: i.end, net: i.net, orders: i.orders })), previous: prev.intervals.map(i => ({ start: i.start, net: i.net })) };
    });
    res.json(data);
  }));

  // Excel / CSV of the same (cached) numbers the page shows.
  app.get('/api/exec-sales/export', handle(async (req, res) => {
    const rg = range(req.query);
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const [ov, tl] = await Promise.all([
      cached(`ov:${rg.start}:${rg.end}`, () => overview(rg)),
      cached(`tl:${rg.start}:${rg.end}:day`, async () => { const [cur, prev] = await Promise.all([revenue(rg.start, rg.end, 'day'), revenue(rg.prevStart, rg.prevEnd, 'day')]); return { ...rg, interval: 'day', current: cur.intervals.map(i => ({ start: i.start, end: i.end, net: i.net, orders: i.orders })), previous: prev.intervals.map(i => ({ start: i.start, net: i.net })) }; }),
    ]);
    const sheets = [];
    if (ov.kpis.ok) sheets.push(['สรุป', ['ตัวชี้วัด', `ช่วงนี้ (${rg.start} ถึง ${rg.end})`, `ช่วงก่อน (${rg.prevStart} ถึง ${rg.prevEnd})`],
      [['ยอดขายสุทธิ (บาท)', 'net'], ['จำนวนออเดอร์', 'orders'], ['ยอดเฉลี่ยต่อออเดอร์ (บาท)', 'aov'], ['ส่วนลดรวม (บาท)', 'discount'], ['ยอดคืนเงิน (บาท)', 'refunds']].map(([l, k]) => [l, ov.kpis.current[k], ov.kpis.previous[k]])]);
    sheets.push(['ยอดขายรายวัน', ['วันที่', 'ยอดขายสุทธิ (บาท)', 'ออเดอร์'], tl.current.map(i => [i.start.slice(0, 10), i.net, i.orders])]);
    if (ov.products.ok) sheets.push(['สินค้าขายดี', ['อันดับ', 'สินค้า', 'SKU', 'ยอดขายสุทธิ (บาท)', 'จำนวนชิ้น', 'ออเดอร์'], ov.products.byNet.map((p, i) => [i + 1, p.name, p.sku, p.net, p.qty, p.orders])]);
    if (ov.categories.ok) sheets.push(['หมวดหมู่', ['หมวดหมู่', 'ยอดขายสุทธิ (บาท)', 'จำนวนชิ้น'], ov.categories.items.map(c => [c.name, c.net, c.qty])]);
    if (ov.provinces.ok) sheets.push(['จังหวัด-ภาค', ['ประเภท', 'ชื่อ', 'ยอดตามออเดอร์ (บาท)', 'ออเดอร์'], [...ov.provinces.regions.map(r => ['ภาค', r.name, r.total, r.orders]), ...ov.provinces.provinces.map(p => ['จังหวัด', p.name, p.total, p.orders])]]);
    const name = `exec-sales-${rg.start}-${rg.end}`;
    if (format === 'csv') {
      const cell = v => (typeof v === 'number' ? String(v) : `"${String(v ?? '').replace(/"/g, '""')}"`);
      const lines = sheets.flatMap(([title, head, rows]) => [cell(title), head.map(cell).join(','), ...rows.map(r => r.map(cell).join(',')), '']);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` });
      return res.send('﻿' + lines.join('\r\n'));
    }
    const wb = new ExcelJS.Workbook();
    for (const [title, head, rows] of sheets) {
      const ws = wb.addWorksheet(title);
      ws.addRow(head).font = { bold: true };
      for (const r of rows) ws.addRow(r);
      ws.columns.forEach((c, i) => { c.width = i === 0 ? 24 : 18; if (/บาท|ปี /.test(head[i] || '') || (title === 'สรุป' && i > 0)) c.numFmt = '#,##0.00'; });
    }
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` });
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }));
}
