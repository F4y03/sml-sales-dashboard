// Lazada Open Platform (Thailand) for the in-house seller app. See MARKETPLACE.md › Lazada API.
// Only the order fields the marketplace tables already store are read: no buyer name, phone, address or email —
// address_shipping is reduced to the province (address3), like the Seller Center export.
import { createHmac } from 'node:crypto';
import { lazadaItemStatus } from './marketplaceParser.js';

export const API_BASE = 'https://api.lazada.co.th/rest';
export const AUTH_BASE = 'https://auth.lazada.com/rest';
// Thai login page directly: auth.lazada.com defaults to Malaysia and loses the query when the seller switches country.
export const AUTHORIZE_URL = 'https://api.lazada.co.th/oauth/authorize';
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export class LazadaApiError extends Error {
  constructor(message, code = null) { super(message); this.name = 'LazadaApiError'; this.code = code; }
}

// Signature: HMAC-SHA256(secret, apiPath + sorted(key+value, without sign)), upper-case hex.
export function signRequest(secret, path, params) {
  const joined = Object.keys(params).filter(k => k !== 'sign').sort().map(k => k + params[k]).join('');
  return createHmac('sha256', secret).update(path + joined).digest('hex').toUpperCase();
}

// Lazada ids are JSON numbers that can exceed 2^53: quote long digit runs of id fields before parsing.
const BIG_IDS = /("(?:order_id|order_number|order_item_id|order_no|orderItem_no|seller_id|user_id)"\s*:\s*)(\d{16,})/g;
export const parseLazadaJson = body => JSON.parse(body.replace(BIG_IDS, '$1"$2"'));

const RATE_LIMITED = /ApiCallLimit|AppCallLimit|SellerCallLimit|AccessFrequency|too many|rate limit/i;
export function createLazadaClient({ appKey, appSecret, fetchImpl = fetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!appKey || !appSecret) throw new LazadaApiError('ยังไม่ได้ตั้งค่า LAZADA_APP_KEY / LAZADA_APP_SECRET ใน .env');
  const unwrap = async response => {
    let json;
    try { json = parseLazadaJson(await response.text()); } catch { throw new LazadaApiError(`Lazada ตอบกลับไม่ถูกต้อง (HTTP ${response.status})`); }
    if (String(json.code ?? '0') !== '0') {
      const error = new LazadaApiError(`Lazada: ${json.message || json.code || 'ไม่ทราบสาเหตุ'}`, json.code ?? null);
      error.rateLimited = response.status === 429 || RATE_LIMITED.test(`${json.code} ${json.message || ''}`);
      throw error;
    }
    return json;
  };
  async function callOnce(base, path, params = {}, accessToken = null) {
    const query = { ...params, app_key: appKey, timestamp: String(now()), sign_method: 'sha256', ...(accessToken && { access_token: accessToken }) };
    query.sign = signRequest(appSecret, path, query);
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return unwrap(await fetchImpl(url, { method: 'GET' }));
  }
  // Lazada throttles per app and per seller: back off and retry (1, 2, 4, 8, 16 s) before giving up.
  async function call(base, path, params, accessToken) {
    for (let attempt = 0; ; attempt++) {
      try { return await callOnce(base, path, params, accessToken); } catch (error) {
        if (!error.rateLimited || attempt >= 5) throw error;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  // Token endpoints answer lifetimes in seconds; stored as absolute epoch ms.
  const token = json => {
    if (!json.access_token || !json.refresh_token) throw new LazadaApiError('Lazada ไม่ได้ส่ง token กลับมา');
    const info = (json.country_user_info || []).find(c => /^th$/i.test(c.country)) || (json.country_user_info || [])[0] || {};
    return { accessToken: json.access_token, accessExpires: now() + Number(json.expires_in) * 1000,
      refreshToken: json.refresh_token, refreshExpires: now() + Number(json.refresh_expires_in) * 1000,
      sellerId: String(info.seller_id || info.user_id || ''), shortCode: String(info.short_code || '') };
  };
  return {
    authorizeUrl: (redirectUri, state) => `${AUTHORIZE_URL}?response_type=code&force_auth=true&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(appKey)}&state=${encodeURIComponent(state)}`,
    exchangeCode: async code => token(await call(AUTH_BASE, '/auth/token/create', { code })),
    refresh: async refreshToken => token(await call(AUTH_BASE, '/auth/token/refresh', { refresh_token: refreshToken })),
    async seller(accessToken) {
      const d = (await call(API_BASE, '/seller/get', {}, accessToken)).data || {};
      return { sellerId: String(d.seller_id || ''), name: String(d.name || d.name_company || ''), shortCode: String(d.short_code || '') };
    },
    // Orders created in [fromMs, toMs), oldest first, 100 per page.
    async searchOrders({ accessToken, fromMs, toMs, maxPages = 400 }) {
      const orders = [];
      for (let page = 0; page < maxPages; page++) {
        const data = (await call(API_BASE, '/orders/get', { created_after: isoBangkok(fromMs), created_before: isoBangkok(toMs - 1000),
          sort_by: 'created_at', sort_direction: 'ASC', offset: String(page * 100), limit: '100' }, accessToken)).data || {};
        const list = data.orders || [];
        orders.push(...list);
        if (list.length < 100) return orders;
      }
      throw new LazadaApiError('ออเดอร์ในช่วงนี้มากเกินไป กรุณาเลือกช่วงวันที่สั้นลง');
    },
    // Order items for the given orders, keyed by order id (50 order ids per call).
    async itemsByOrder({ accessToken, orderIds }) {
      const byOrder = new Map();
      for (let i = 0; i < orderIds.length; i += 50) {
        const data = (await call(API_BASE, '/orders/items/get', { order_ids: '[' + orderIds.slice(i, i + 50).join(',') + ']' }, accessToken)).data || [];
        for (const o of data) byOrder.set(String(o.order_id), o.order_items || []);
      }
      return byOrder;
    },
    // Finance › transaction details (the same money lines as the Income Overview statement), transaction dates start..end.
    async transactions({ accessToken, startDay, endDay, maxPages = 400 }) {
      const rows = [];
      for (let page = 0; page < maxPages; page++) {
        const data = (await call(API_BASE, '/finance/transaction/details/get', { start_time: startDay, end_time: endDay, offset: String(page * 500), limit: '500' }, accessToken)).data;
        const list = Array.isArray(data) ? data : [];
        rows.push(...list);
        if (list.length < 500) return rows;
        await sleep(300);
      }
      throw new LazadaApiError('รายการเงินในช่วงนี้มากเกินไป กรุณาเลือกช่วงวันที่สั้นลง');
    },
  };
}

const money = value => { const n = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

// Epoch ms as Lazada's ISO 8601 with the Bangkok offset, e.g. 2026-10-01T00:00:00+07:00.
export const isoBangkok = ms => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 19) + '+07:00';
// Bangkok midnight of a YYYY-MM-DD day, as epoch ms.
export const bangkokDayStart = day => Date.parse(day + 'T00:00:00Z') - BANGKOK_OFFSET_MS;
export const bangkokToday = (ms = Date.now()) => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
// created_at "2026-10-01 10:00:00 +0700" -> Thai calendar day ค.ศ. YYYY-MM-DD (same day the Seller Center export shows).
export function lazadaDate(value) {
  const m = clean(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*([+-]\d{2}):?(\d{2}))?/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}${m[3] ? `${m[3]}:${m[4] || '00'}` : '+07:00'}`);
  return Number.isFinite(ms) ? bangkokToday(ms) : null;
}

// Same buckets and sales definition as the export reader (MARKETPLACE.md › นิยามตัวเลข): one item = one unit,
// sales = Σ(item_price − |voucher_seller|) of items not cancelled; order = cancelled only when every item is.
export function mapLazadaOrder(order, items = []) {
  const id = clean(order?.order_number || order?.order_id);
  const orderDate = lazadaDate(order?.created_at);
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(id) || !orderDate) return null;
  const lines = items.map((it, i) => {
    const statusRaw = clean(it.status);
    const sku = clean(it.sku) || clean(it.shop_sku);
    const name = [clean(it.name), clean(it.variation)].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    return { lineKey: clean(it.order_item_id) || `${sku}|${name}#${i}`, sku, name, quantity: 1,
      sales: round2(money(it.item_price) - Math.abs(money(it.voucher_seller))), statusRaw, status: lazadaItemStatus(statusRaw, 0) };
  });
  if (!lines.length) for (const s of order.statuses || []) lines.push({ statusRaw: clean(s), status: lazadaItemStatus(clean(s), 0), sales: 0 });
  const active = lines.filter(l => l.status !== 'cancelled');
  const status = !active.length ? 'cancelled' : active.some(l => l.status === 'returned') ? 'returned'
    : active.every(l => l.status === 'completed') ? 'completed' : 'pending';
  const counted = active.length ? active : lines;
  const province = clean(order.address_shipping?.address3 || order.address_billing?.address3).split('/')[0].replace(/^จังหวัด\s*/, '').trim();
  return { orderId: id, orderDate, status, statusRaw: [...new Set(lines.map(l => l.statusRaw))].join(', ').slice(0, 120),
    sales: round2(counted.reduce((sum, l) => sum + l.sales, 0)), refund: 0,
    province: !province || province.includes('*') ? null : province.slice(0, 60), source: 'api',
    items: items.length ? lines.map(({ statusRaw, ...l }) => l) : null };
}

// One finance transaction line -> a settlement row. Per order the rows sum to the statement file's figures:
// net = Σ amount, fees = Σ product lines (ยอดรวมค่าสินค้า / หักเงินค่าสินค้า) − net. Lines without an order are skipped.
const PRODUCT_LINES = /^(ยอดรวมค่าสินค้า|หักเงินค่าสินค้า|item price credit|reversal item price)/i;
export function mapLazadaTransaction(tx) {
  const orderId = clean(tx?.order_no), txn = clean(tx?.transaction_number);
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(orderId) || !txn) return null;
  const amount = money(tx.amount), product = PRODUCT_LINES.test(clean(tx.fee_name)) ? amount : 0;
  // Lazada gives every line of one item (price credit, commission, payment fee…) the same transaction_number and
  // orderItem_no, so the fee type and date are needed to keep each line as its own row.
  return { txnId: `api:${txn}:${clean(tx.orderItem_no)}:${clean(tx.fee_type || tx.fee_name)}:${clean(tx.transaction_date)}`.slice(0, 120), orderId, fees: round2(product - amount), netPayout: round2(amount) };
}
