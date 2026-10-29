// Shopee Open Platform v2 (ISV app, ERP System). See MARKETPLACE.md › Shopee API.
// Buyer PII access is off for this app, and nothing personal is read anyway: from the order only order_sn, status,
// create_time, item lines and the recipient province (only when Shopee does not mask it) are kept.
import { createHmac } from 'node:crypto';
import { provinceFromPostcode } from './thaiPostcode.js';

// SHOPEE_ENV=sandbox | live. Hosts per Shopee Open Platform › Developer Guide › API Calls (check after Shopee changes).
export const HOSTS = { sandbox: 'https://partner.test-stable.shopeemobile.com', live: 'https://partner.shopeemobile.com' };
export const shopeeEnv = value => (String(value || 'sandbox').trim().toLowerCase() === 'live' ? 'live' : 'sandbox');
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MAX_ORDER_WINDOW_S = 15 * 86400; // get_order_list refuses time_from..time_to longer than 15 days

export class ShopeeApiError extends Error {
  constructor(message, code = null) { super(message); this.name = 'ShopeeApiError'; this.code = code; }
}

// Signature: HMAC-SHA256(partner_key, base string), lower-case hex.
//   public APIs (auth, token):  partner_id + api_path + timestamp
//   shop APIs:                  partner_id + api_path + timestamp + access_token + shop_id
// timestamp is Unix seconds and must be within 5 minutes of Shopee's clock.
export function signShopee(partnerKey, { partnerId, path, timestamp, accessToken = '', shopId = '' }) {
  return createHmac('sha256', partnerKey).update(`${partnerId}${path}${timestamp}${accessToken}${shopId}`).digest('hex');
}

const RATE_LIMITED = /too_many|rate.?limit|error_busy|frequen/i;
const TOKEN_EXPIRED = /invalid_acce+ss_token|invalid_access_token|access_token.*expire|error_auth/i;
// Params that must never reach a log line.
export const redactUrl = url => url.replace(/([?&](?:sign|access_token|refresh_token|code)=)[^&]*/g, '$1***');

export function createShopeeClient({ partnerId, partnerKey, env = 'sandbox', host: hostOverride = '', fetchImpl = fetch, now = () => Date.now(),
  sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {} }) {
  if (!partnerId || !partnerKey) throw new ShopeeApiError('ยังไม่ได้ตั้งค่า SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY ใน .env');
  // SHOPEE_HOST overrides the default host (the sandbox host differs between older and newer Console apps).
  const host = /^https:\/\/[a-z0-9.-]+$/i.test(String(hostOverride).trim()) ? String(hostOverride).trim() : HOSTS[shopeeEnv(env)];
  const pid = Number(partnerId);
  const ts = () => Math.floor(now() / 1000);

  function signedUrl(path, query = {}, shop = null) {
    const timestamp = ts();
    const url = new URL(host + path);
    const sign = signShopee(partnerKey, { partnerId: pid, path, timestamp, accessToken: shop?.accessToken || '', shopId: shop?.shopId || '' });
    const all = { ...query, partner_id: pid, timestamp, sign, ...(shop && { access_token: shop.accessToken, shop_id: shop.shopId }) };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    return url;
  }

  async function callOnce(method, path, { query, body, shop } = {}) {
    const url = signedUrl(path, query, shop), started = now();
    let response, json = null, error = null;
    try {
      response = await fetchImpl(url, method === 'POST'
        ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) } : { method });
      try { json = JSON.parse(await response.text()); } catch { error = new ShopeeApiError(`Shopee ตอบกลับไม่ถูกต้อง (HTTP ${response.status})`, 'bad_json'); }
      if (!error && (json.error || response.status >= 400)) {
        const code = String(json.error || `http_${response.status}`);
        error = new ShopeeApiError(`Shopee: ${json.message || code}`, code);
        error.rateLimited = response.status === 429 || RATE_LIMITED.test(code);
        error.tokenExpired = TOKEN_EXPIRED.test(`${code} ${json.message || ''}`);
      }
    } catch (e) {
      if (!(e instanceof ShopeeApiError)) error = Object.assign(new ShopeeApiError('เชื่อมต่อ Shopee ไม่ได้', 'network'), { rateLimited: true });
      else error = e;
    }
    log({ endpoint: path, shopId: shop?.shopId || null, httpStatus: response?.status ?? null, error: error?.code || null, durationMs: now() - started });
    if (error) throw error;
    return json;
  }
  // Shopee throttles per partner/shop: back off and retry (1, 2, 4, 8, 16 s) before giving up.
  async function call(method, path, opts) {
    for (let attempt = 0; ; attempt++) {
      try { return await callOnce(method, path, opts); } catch (error) {
        if (!error.rateLimited || attempt >= 5) throw error;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  // Token answers give expire_in in seconds (access ≈ 4 h); the refresh token lasts 30 days and is replaced on every refresh.
  const token = json => {
    const t = json.response || json;
    if (!t.access_token || !t.refresh_token) throw new ShopeeApiError('Shopee ไม่ได้ส่ง token กลับมา');
    return { accessToken: t.access_token, accessExpires: now() + Number(t.expire_in || 14400) * 1000,
      refreshToken: t.refresh_token, refreshExpires: now() + 30 * 86400 * 1000 };
  };

  return {
    env: shopeeEnv(env),
    // Shop authorisation page; Shopee sends the browser to redirect with ?code=…&shop_id=… appended.
    authorizeUrl: redirect => { const u = signedUrl('/api/v2/shop/auth_partner', { redirect }); return u.toString(); },
    exchangeCode: async (code, shopId) => token(await call('POST', '/api/v2/auth/token/get', { body: { code, shop_id: Number(shopId), partner_id: pid } })),
    refresh: async (refreshToken, shopId) => token(await call('POST', '/api/v2/auth/access_token/get', { body: { refresh_token: refreshToken, shop_id: Number(shopId), partner_id: pid } })),
    async shopInfo(shop) {
      const d = await call('GET', '/api/v2/shop/get_shop_info', { shop });
      return { name: String(d.shop_name || ''), region: String(d.region || ''), status: String(d.status || '') };
    },
    // order_sn of orders created in [fromS, toS) (Unix seconds), in ≤ 15-day windows, cursor paging 100 per page.
    async orderSns({ shop, fromS, toS, maxPages = 400 }) {
      const sns = [];
      let pages = 0;
      for (let from = fromS; from < toS; from += MAX_ORDER_WINDOW_S) {
        const to = Math.min(from + MAX_ORDER_WINDOW_S, toS) - 1;
        let cursor = '';
        do {
          if (++pages > maxPages) throw new ShopeeApiError('ออเดอร์ในช่วงนี้มากเกินไป กรุณาเลือกช่วงวันที่สั้นลง');
          const r = (await call('GET', '/api/v2/order/get_order_list', { shop, query: { time_range_field: 'create_time', time_from: from, time_to: to, page_size: 100, cursor } })).response || {};
          for (const o of r.order_list || []) sns.push(String(o.order_sn));
          cursor = r.more ? String(r.next_cursor || '') : '';
        } while (cursor);
      }
      return [...new Set(sns)];
    },
    // Order details, 50 order_sn per call.
    async orderDetails({ shop, orderSns }) {
      const orders = [];
      for (let i = 0; i < orderSns.length; i += 50) {
        const r = (await call('GET', '/api/v2/order/get_order_detail', { shop, query: { order_sn_list: orderSns.slice(i, i + 50).join(','),
          response_optional_fields: 'item_list,recipient_address,order_status,create_time' } })).response || {};
        orders.push(...(r.order_list || []));
      }
      return orders;
    },
    // Payment › get_escrow_detail: the order's income breakdown (fees, escrow_amount = amount paid out to the seller).
    async escrow({ shop, orderSn }) {
      return (await call('GET', '/api/v2/payment/get_escrow_detail', { shop, query: { order_sn: orderSn } })).response || null;
    },
    // Every NORMAL/UNLIST item id (100 per page), then base info 50 per call, then models for items that have them.
    async items({ shop, maxPages = 200 }) {
      const ids = [];
      for (let page = 0, offset = 0; ; page++) {
        if (page >= maxPages) throw new ShopeeApiError('สินค้ามากเกินไป');
        const r = (await call('GET', '/api/v2/product/get_item_list', { shop, query: { offset, page_size: 100, item_status: 'NORMAL' } })).response || {};
        for (const it of r.item || []) ids.push(String(it.item_id));
        if (!r.has_next_page) break;
        offset = Number(r.next_offset);
      }
      const items = [];
      for (let i = 0; i < ids.length; i += 50) {
        const r = (await call('GET', '/api/v2/product/get_item_base_info', { shop, query: { item_id_list: ids.slice(i, i + 50).join(',') } })).response || {};
        items.push(...(r.item_list || []));
      }
      for (const it of items) {
        if (!it.has_model) continue;
        const r = (await call('GET', '/api/v2/product/get_model_list', { shop, query: { item_id: it.item_id } })).response || {};
        it.models = r.model || [];
      }
      return items;
    },
  };
}

const money = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
export const bangkokDayStart = day => Date.parse(day + 'T00:00:00Z') - BANGKOK_OFFSET_MS;
export const bangkokToday = (ms = Date.now()) => new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);

// Same buckets as the Shopee order export (marketplaceParser shopeeStatus): CANCELLED → cancelled,
// TO_RETURN → returned, COMPLETED → completed, everything else (UNPAID, READY_TO_SHIP, SHIPPED, IN_CANCEL…) → pending.
export function shopeeOrderStatus(status) {
  const s = clean(status).toUpperCase();
  if (s === 'CANCELLED') return 'cancelled';
  if (s === 'TO_RETURN') return 'returned';
  if (s === 'COMPLETED') return 'completed';
  return 'pending';
}

// Same sales definition as the export (MARKETPLACE.md › นิยามตัวเลข): line = ราคาขายสุทธิ = model_discounted_price × quantity
// (price after the seller's product discount); order vouchers and Shopee discounts are not deducted.
export function mapShopeeOrder(order) {
  const id = clean(order?.order_sn);
  const created = Number(order?.create_time);
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(id) || !Number.isFinite(created) || created <= 0) return null;
  const statusRaw = clean(order.order_status);
  const status = shopeeOrderStatus(statusRaw);
  const items = (order.item_list || []).map((it, i) => {
    const sku = clean(it.model_sku) || clean(it.item_sku);
    const name = [clean(it.item_name), clean(it.model_name)].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    const quantity = money(it.model_quantity_purchased);
    return { lineKey: `${clean(it.item_id)}:${clean(it.model_id)}#${i}`, sku, name, quantity,
      sales: round2(money(it.model_discounted_price) * quantity), status };
  });
  // Province only, and only when Shopee does not mask it; otherwise from the full postcode, else none (never a guess).
  const address = order.recipient_address || {};
  const named = clean(address.state).replace(/^จังหวัด\s*/, '');
  const fromCode = /^\d{5}$/.test(clean(address.zipcode)) ? provinceFromPostcode(clean(address.zipcode)) : null;
  const province = named && !named.includes('*') ? named : fromCode;
  return { orderId: id, orderDate: bangkokToday(created * 1000), status, statusRaw: statusRaw.slice(0, 120), refund: 0,
    sales: round2(items.reduce((sum, l) => sum + l.sales, 0)), province: province && !province.includes('*') ? province.slice(0, 60) : null,
    source: 'api', items: items.length ? items : null };
}

// Fees / net payout of one order, same settlement key as the income report upload (income:<order_sn>) so a file and the API
// never count it twice. net = escrow_amount; fees = sum of the seller-side fee fields Shopee returns (none returned = no row).
export const SHOPEE_ESCROW_FEES = ['commission_fee', 'service_fee', 'seller_transaction_fee', 'order_ams_commission_fee'];
export function mapShopeeEscrow(escrow) {
  const id = clean(escrow?.order_sn), income = escrow?.order_income || {};
  const net = income.escrow_amount;
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(id) || net === undefined || net === null || !Number.isFinite(Number(net))) return null;
  const present = SHOPEE_ESCROW_FEES.filter(k => income[k] !== undefined && income[k] !== null && Number.isFinite(Number(income[k])));
  if (!present.length) return null; // fees column is NOT NULL: unknown stays missing (blank), never 0
  const detail = Object.fromEntries(present.map(k => [k, round2(Math.abs(Number(income[k])))]));
  return { txnId: `income:${id}`, orderId: id, fees: round2(present.reduce((sum, k) => sum + Math.abs(Number(income[k])), 0)),
    netPayout: round2(Number(net)), detail };
}

// get_item_base_info (+ get_model_list) -> one row per model (model_id 0 = no variations).
// Stock = stock_info_v2.summary_info.total_available_stock; missing → null (unknown), not 0.
const stockOf = info => { const v = info?.summary_info?.total_available_stock; return v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v); };
const priceOf = list => { const v = (list || [])[0]?.current_price; return v === undefined || v === null ? null : money(v); };
export function mapShopeeItem(item) {
  const base = { itemId: clean(item.item_id), itemSku: clean(item.item_sku), name: clean(item.item_name) || 'ไม่ระบุชื่อสินค้า', itemStatus: clean(item.item_status) };
  if (!base.itemId) return [];
  if (!item.has_model || !(item.models || []).length)
    return [{ ...base, modelId: '0', modelSku: '', modelName: '', price: priceOf(item.price_info), stock: stockOf(item.stock_info_v2) }];
  return item.models.map(m => ({ ...base, modelId: clean(m.model_id), modelSku: clean(m.model_sku), modelName: clean(m.model_name),
    price: priceOf(m.price_info), stock: stockOf(m.stock_info_v2) }));
}
