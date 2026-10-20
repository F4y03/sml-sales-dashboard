// Copies the online-sales tables (marketplace_*) to one Google Sheet, read-only from the dashboard's point of view.
// Auth: a Google service account key file (GOOGLE_SHEETS_KEY_FILE, kept in data/, never in Git) signed with node:crypto;
// the sheet (GOOGLE_SHEETS_ID) must be shared with the service account as Editor. Every export rewrites the tabs in full,
// so the sheet always equals the dashboard. Definitions follow MARKETPLACE.md (sales = completed + pending; no fee data = blank, not 0).
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets/';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const PLATFORM = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };
const STATUS = { completed: 'สำเร็จ', pending: 'กำลังดำเนินการ', cancelled: 'ยกเลิก', returned: 'คืนสินค้า' };
const SOLD = "('completed','pending')";

export class GoogleSheetsError extends Error {
  constructor(message) { super(message); this.name = 'GoogleSheetsError'; }
}

const b64url = value => Buffer.from(value).toString('base64url');

export function loadServiceAccount(file) {
  let key;
  try { key = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new GoogleSheetsError('อ่านไฟล์ key ของ Google ไม่ได้ (GOOGLE_SHEETS_KEY_FILE)'); }
  if (key.type !== 'service_account' || !key.client_email || !key.private_key) throw new GoogleSheetsError('ไฟล์ key ของ Google ไม่ใช่ Service Account');
  return { email: key.client_email, privateKey: key.private_key };
}

export function createSheetsClient({ account, fetchImpl = fetch, now = () => Date.now() }) {
  let cached = null;
  async function token() {
    if (cached && cached.expires - now() > 60000) return cached.value;
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: account.email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.privateKey).toString('base64url');
    const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.access_token) throw new GoogleSheetsError(`Google ไม่ให้สิทธิ์ (${json.error || response.status})`);
    cached = { value: json.access_token, expires: now() + Number(json.expires_in || 3600) * 1000 };
    return cached.value;
  }
  async function api(method, path, body) {
    const response = await fetchImpl(SHEETS_URL + path, { method, headers: { authorization: 'Bearer ' + await token(), 'content-type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const hint = response.status === 403 || response.status === 404 ? ' — ตรวจว่าแชร์ชีตให้อีเมล Service Account เป็น Editor และ GOOGLE_SHEETS_ID ถูกต้อง' : '';
      throw new GoogleSheetsError(`Google Sheets: ${json.error?.message || response.status}${hint}`);
    }
    return json;
  }
  return {
    // Rewrites each tab (created when missing) with the given rows; row 1 is the header.
    // `remove`: titles of tabs this export used to write (old layouts) — deleted when present; other tabs are never touched.
    async writeTabs(spreadsheetId, tabs, remove = []) {
      const id = encodeURIComponent(spreadsheetId);
      const meta = await api('GET', `${id}?fields=sheets.properties(sheetId,title)`);
      const sheets = (meta.sheets || []).map(s => s.properties);
      const have = new Set(sheets.map(s => s.title));
      const missing = tabs.filter(t => !have.has(t.title));
      const stale = sheets.filter(s => remove.includes(s.title));
      const requests = [...missing.map(t => ({ addSheet: { properties: { title: t.title } } })), ...stale.map(s => ({ deleteSheet: { sheetId: s.sheetId } }))];
      if (requests.length) await api('POST', `${id}:batchUpdate`, { requests });
      await api('POST', `${id}/values:batchClear`, { ranges: tabs.map(t => `'${t.title}'`) });
      await api('POST', `${id}/values:batchUpdate`, { valueInputOption: 'RAW', data: tabs.map(t => ({ range: `'${t.title}'!A1`, values: t.rows })) });
    },
  };
}

// The three tabs + an info tab, straight from the dashboard tables. Blank (not 0) where the source has no value.
export function buildExportTabs(store, at = new Date()) {
  const orders = store.all(`SELECT o.platform,s.name AS shop,o.order_id,o.order_date,o.status,o.status_raw,o.sales,o.refund,o.province,o.source,o.updated_at,
      f.fees,f.net FROM marketplace_orders o LEFT JOIN marketplace_shops s ON s.id=o.shop_id
      LEFT JOIN (SELECT platform,order_id,SUM(fees) AS fees,SUM(net_payout) AS net FROM marketplace_settlements GROUP BY platform,order_id) f
        ON f.platform=o.platform AND f.order_id=o.order_id
    ORDER BY o.order_date,o.platform,o.order_id`);
  const items = store.all(`SELECT i.platform,i.order_id,o.order_date,i.sku,i.product_name,i.quantity,i.sales,i.status
    FROM marketplace_order_items i JOIN marketplace_orders o ON o.platform=i.platform AND o.order_id=i.order_id
    ORDER BY o.order_date,i.platform,i.order_id,i.line_key`);
  const daily = store.all(`SELECT order_date,platform,COUNT(*) AS orders,ROUND(SUM(sales),2) AS sales FROM marketplace_orders
    WHERE status IN ${SOLD} GROUP BY order_date,platform ORDER BY order_date,platform`);
  const blank = v => (v === null || v === undefined ? '' : v);
  // One set of tabs per platform ("Shopee · ออเดอร์", …), each platform's own data only.
  const tabs = Object.entries(PLATFORM).flatMap(([code, label]) => [
    { title: `${label} · ออเดอร์`, rows: [['ร้าน', 'เลขออเดอร์', 'วันที่สร้าง', 'สถานะ', 'สถานะจากแพลตฟอร์ม', 'ยอดขาย', 'ยอดคืนเงิน', 'จังหวัด', 'ค่าธรรมเนียม', 'เงินที่ได้รับสุทธิ', 'ที่มา', 'อัปเดตล่าสุด'],
      ...orders.filter(o => o.platform === code).map(o => [blank(o.shop), o.order_id, o.order_date, STATUS[o.status] || o.status, o.status_raw,
        o.sales, o.refund, blank(o.province), blank(o.fees), blank(o.net), o.source === 'api' ? 'API' : 'ไฟล์', o.updated_at])] },
    { title: `${label} · สินค้า`, rows: [['เลขออเดอร์', 'วันที่สร้าง', 'SKU', 'ชื่อสินค้า', 'จำนวน', 'ยอดขาย', 'สถานะ'],
      ...items.filter(i => i.platform === code).map(i => [i.order_id, i.order_date, i.sku, i.product_name, i.quantity, i.sales, STATUS[i.status] || i.status])] },
    { title: `${label} · สรุปรายวัน`, rows: [['วันที่', 'ออเดอร์ (สำเร็จ + กำลังดำเนินการ)', 'ยอดขาย'],
      ...daily.filter(d => d.platform === code).map(d => [d.order_date, d.orders, d.sales])] },
  ]);
  const count = code => orders.filter(o => o.platform === code).length;
  tabs.push({ title: 'ข้อมูล', rows: [['ส่งออกล่าสุด', at.toISOString()], ['ที่มา', 'SML Dashboard › ยอดขายออนไลน์ (เขียนทับทั้งแท็บทุกครั้ง อย่าแก้ข้อมูลในแท็บเหล่านี้)'],
    ['ยอดขาย', 'ราคาสินค้าหลังหักส่วนลดร้าน ไม่รวมค่าส่ง'], ['สรุปรายวัน', 'นับเฉพาะ สำเร็จ + กำลังดำเนินการ'],
    ['ค่าธรรมเนียม / สุทธิ', 'ว่าง = ยังไม่มีข้อมูลการเงิน (ไม่ใช่ 0) · ยังไม่หักต้นทุนสินค้า จึงไม่ใช่กำไร'],
    ...Object.entries(PLATFORM).map(([code, label]) => [`ออเดอร์ ${label}`, count(code)])] });
  return tabs;
}

// Tabs of the first, all-platforms layout; removed from the sheet on the next export.
export const OLD_TABS = ['ออเดอร์', 'สินค้า', 'สรุปรายวัน'];
