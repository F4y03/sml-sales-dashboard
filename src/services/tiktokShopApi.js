// TikTok Shop Open API (API version 202309) for the in-house seller app. See MARKETPLACE.md › TikTok Shop API.
// Only the order fields the marketplace tables already store are read: no buyer name, phone, address or email —
// recipient_address is reduced to the province name, like the Seller Center export.
import { createHmac } from 'node:crypto';

export const API_BASE = 'https://open-api.tiktokglobalshop.com';
export const AUTH_BASE = 'https://auth.tiktok-shops.com';
export const AUTHORIZE_URL = 'https://services.tiktokshop.com/open/authorize';
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export class TikTokApiError extends Error {
  constructor(message, code = null) { super(message); this.name = 'TikTokApiError'; this.code = code; }
}

// Signature: HMAC-SHA256(secret, secret + path + sorted(key+value, without sign/access_token) + body + secret), hex.
export function signRequest(secret, path, query, body = '') {
  const params = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort().map(k => k + query[k]).join('');
  return createHmac('sha256', secret).update(secret + path + params + body + secret).digest('hex');
}

const RATE_LIMITED = /too many requests|rate limit/i;
export function createTikTokClient({ appKey, appSecret, fetchImpl = fetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (!appKey || !appSecret) throw new TikTokApiError('ยังไม่ได้ตั้งค่า TIKTOK_APP_KEY / TIKTOK_APP_SECRET ใน .env');
  const unwrap = async response => {
    let json;
    try { json = await response.json(); } catch { throw new TikTokApiError(`TikTok ตอบกลับไม่ถูกต้อง (HTTP ${response.status})`); }
    if (json.code !== 0) {
      const error = new TikTokApiError(`TikTok: ${json.message || 'ไม่ทราบสาเหตุ'}`, json.code ?? null);
      error.rateLimited = response.status === 429 || RATE_LIMITED.test(String(json.message || ''));
      throw error;
    }
    return json.data || {};
  };
  // Token endpoints answer absolute unix-second expiry times.
  const token = data => ({
    accessToken: data.access_token, accessExpires: Number(data.access_token_expire_in) * 1000,
    refreshToken: data.refresh_token, refreshExpires: Number(data.refresh_token_expire_in) * 1000,
    sellerName: data.seller_name || '',
  });
  const tokenCall = async (path, params) => {
    const url = new URL(path, AUTH_BASE);
    for (const [k, v] of Object.entries({ app_key: appKey, app_secret: appSecret, ...params })) url.searchParams.set(k, v);
    const data = await unwrap(await fetchImpl(url, { method: 'GET' }));
    if (!data.access_token || !data.refresh_token) throw new TikTokApiError('TikTok ไม่ได้ส่ง token กลับมา');
    return token(data);
  };
  // Finance endpoints share a small regional rate limit: back off and retry (1, 2, 4, 8, 16 s) before giving up.
  async function call(method, path, options = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await callOnce(method, path, options); } catch (error) {
        if (!error.rateLimited || attempt >= 5) throw error;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  async function callOnce(method, path, { accessToken, shopCipher, query = {}, body } = {}) {
    const json = body === undefined ? '' : JSON.stringify(body);
    const params = { ...query, app_key: appKey, timestamp: String(Math.floor(now() / 1000)) };
    if (shopCipher) params.shop_cipher = shopCipher;
    params.sign = signRequest(appSecret, path, params, json);
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers = { 'content-type': 'application/json', 'x-tts-access-token': accessToken };
    return unwrap(await fetchImpl(url, { method, headers, body: json || undefined }));
  }
  return {
    authorizeUrl: (serviceId, state) => `${AUTHORIZE_URL}?service_id=${encodeURIComponent(serviceId)}&state=${encodeURIComponent(state)}`,
    exchangeCode: code => tokenCall('/api/v2/token/get', { auth_code: code, grant_type: 'authorized_code' }),
    refresh: refreshToken => tokenCall('/api/v2/token/refresh', { refresh_token: refreshToken, grant_type: 'refresh_token' }),
    async shops(accessToken) {
      const data = await call('GET', '/authorization/202309/shops', { accessToken });
      return (data.shops || []).map(s => ({ id: String(s.id), name: String(s.name || ''), cipher: String(s.cipher || ''), region: s.region }));
    },
    // Orders created in [fromMs, toMs). Follows next_page_token until the last page.
    async searchOrders({ accessToken, shopCipher, fromMs, toMs, maxPages = 400 }) {
      const orders = [];
      let pageToken = '';
      for (let page = 0; page < maxPages; page++) {
        const query = { page_size: '50', sort_field: 'create_time', sort_order: 'ASC', ...(pageToken && { page_token: pageToken }) };
        const data = await call('POST', '/order/202309/orders/search', { accessToken, shopCipher, query,
          body: { create_time_ge: Math.floor(fromMs / 1000), create_time_lt: Math.floor(toMs / 1000) } });
        orders.push(...(data.orders || []));
        pageToken = data.next_page_token || '';
        if (!pageToken) return orders;
      }
      throw new TikTokApiError('ออเดอร์ในช่วงนี้มากเกินไป กรุณาเลือกช่วงวันที่สั้นลง');
    },
    // Returns / refunds for the given orders, keyed by order id (50 order ids per call).
    async returnsByOrder({ accessToken, shopCipher, orderIds }) {
      const byOrder = new Map();
      for (let i = 0; i < orderIds.length; i += 50) {
        let pageToken = '';
        do {
          const query = { page_size: '50', ...(pageToken && { page_token: pageToken }) };
          const data = await call('POST', '/return_refund/202309/returns/search', { accessToken, shopCipher, query, body: { order_ids: orderIds.slice(i, i + 50) } });
          for (const r of data.return_orders || []) {
            const list = byOrder.get(String(r.order_id)) || [];
            list.push(r);
            byOrder.set(String(r.order_id), list);
          }
          pageToken = data.next_page_token || '';
        } while (pageToken);
      }
      return byOrder;
    },
    // Settled money (Finance API, scope seller.finance.info): every transaction of the daily statements
    // whose statement_time is in [fromMs, toMs). Orders settle days after they are created, so callers pass toMs = now.
    async statementTransactions({ accessToken, shopCipher, fromMs, toMs, maxPages = 400 }) {
      const ids = [];
      let pageToken = '', page = 0;
      do {
        const query = { page_size: '100', sort_field: 'statement_time', statement_time_ge: String(Math.floor(fromMs / 1000)),
          statement_time_lt: String(Math.floor(toMs / 1000)), ...(pageToken && { page_token: pageToken }) };
        const data = await call('GET', '/finance/202309/statements', { accessToken, shopCipher, query });
        ids.push(...(data.statements || []).map(st => String(st.id)));
        pageToken = data.next_page_token || '';
      } while (pageToken && ++page < maxPages);
      const transactions = [];
      for (const id of ids) {
        pageToken = ''; page = 0;
        await sleep(300); // stay well under the shared Finance API limit
        do {
          const query = { page_size: '100', sort_field: 'order_create_time', ...(pageToken && { page_token: pageToken }) };
          const data = await call('GET', `/finance/202309/statements/${encodeURIComponent(id)}/statement_transactions`, { accessToken, shopCipher, query });
          transactions.push(...(data.statement_transactions || []));
          pageToken = data.next_page_token || '';
        } while (pageToken && ++page < maxPages);
      }
      return transactions;
    },
  };
}

const money = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

// One statement transaction -> the same settlement row the finance file gives (MARKETPLACE.md):
// fees = ค่าธรรมเนียมทั้งหมด as a positive deduction (API fee_amount is negative), net = ยอดการชำระเงินทั้งหมด.
// Transactions without an order (shop-level adjustments) are skipped, as in the file reader.
export function mapTikTokSettlement(tx) {
  const txnId = clean(tx?.id), orderId = clean(tx?.order_id);
  if (!txnId || !orderId) return null;
  return { txnId, orderId, fees: round2(-money(tx.fee_amount)), netPayout: round2(money(tx.settlement_amount)) };
}

// Order create_time (unix seconds) as the Thai calendar day, ค.ศ. YYYY-MM-DD — same day the Seller Center export shows.
export const bangkokDate = seconds => new Date(Number(seconds) * 1000 + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
// Bangkok midnight of a YYYY-MM-DD day, as epoch ms.
export const bangkokDayStart = day => Date.parse(day + 'T00:00:00Z') - BANGKOK_OFFSET_MS;

// A return that was cancelled or rejected leaves the order as it was.
const activeReturn = r => !/CANCEL|REJECT/i.test(String(r.return_status || ''));

// Same buckets and sales definition as the export parser (MARKETPLACE.md › นิยามตัวเลข):
// sales = Σ(original price − |seller discount|) per line; platform discounts are not deducted.
export function mapTikTokOrder(order, returns = []) {
  const id = clean(order.id);
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(id)) return null;
  const statusRaw = clean(order.status);
  const active = returns.filter(activeReturn);
  const refund = round2(active.reduce((sum, r) => sum + Math.abs(money(r.refund_amount?.refund_total)), 0));
  const status = /CANCEL/i.test(statusRaw) ? 'cancelled' : active.length ? 'returned' : /COMPLETED|DELIVERED/i.test(statusRaw) ? 'completed' : 'pending';
  // 202309 line items are one row per unit: group by SKU into lines with a quantity.
  const lines = new Map();
  for (const li of order.line_items || []) {
    const sku = clean(li.seller_sku) || clean(li.sku_id);
    const name = [clean(li.product_name), clean(li.sku_name)].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    const lineKey = clean(li.sku_id) || `${sku}|${name}`;
    const line = lines.get(lineKey) || { lineKey, sku, name, quantity: 0, sales: 0, status };
    line.quantity += 1;
    line.sales = round2(line.sales + money(li.original_price) - Math.abs(money(li.seller_discount)));
    lines.set(lineKey, line);
  }
  const items = [...lines.values()];
  const province = clean((order.recipient_address?.district_info || []).find(d => d.address_level === 'L1')?.address_name)
    .replace(/^จังหวัด\s*/, '').slice(0, 60) || null;
  return { orderId: id, orderDate: bangkokDate(order.create_time), status, statusRaw: statusRaw.slice(0, 120),
    sales: round2(items.reduce((sum, item) => sum + item.sales, 0)), refund, province, source: 'api', items };
}
