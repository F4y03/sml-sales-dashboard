// WooCommerce REST client (server side only). WC_KEY / WC_SECRET never leave this process: the browser talks to
// /api/online-orders/* (src/routes/online-orders.js), which calls this module with Basic Auth over HTTPS.
const DEFAULT_BASE = 'https://proplusaudio.com/wp-json/wc/v3/';

export class WooError extends Error {
  constructor(message, status = 502, code = 'WOO_ERROR') { super(message); this.status = status; this.code = code; }
}

export function createWooClient(env = process.env, fetchImpl = globalThis.fetch) {
  const base = String(env.WC_BASE_URL || DEFAULT_BASE).replace(/\/?$/, '/');
  // wc-analytics lives beside wc/v3 under the same /wp-json/ root.
  const analyticsBase = base.replace(/wc\/v3\/$/, 'wc-analytics/');
  const configured = () => Boolean(env.WC_KEY && env.WC_SECRET);
  const authHeader = () => 'Basic ' + Buffer.from(`${env.WC_KEY}:${env.WC_SECRET}`).toString('base64');

  async function call(root, path, { method = 'GET', query, body, timeout = 20000 } = {}) {
    if (!configured()) throw new WooError('ยังไม่ได้ตั้งค่าการเชื่อมต่อเว็บไซต์ (WC_KEY / WC_SECRET) กรุณาติดต่อผู้ดูแลระบบ', 503, 'WOO_NOT_CONFIGURED');
    const url = new URL(path.replace(/^\//, ''), root);
    if (!url.protocol.startsWith('https')) throw new WooError('WC_BASE_URL ต้องเป็น https เท่านั้น', 503, 'WOO_INSECURE');
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: authHeader(), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new WooError(timedOut ? 'เว็บไซต์ตอบช้าเกินไป กรุณาลองใหม่อีกครั้ง' : 'เชื่อมต่อเว็บไซต์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 504, timedOut ? 'WOO_TIMEOUT' : 'WOO_NETWORK');
    }
    let data = null;
    const text = await response.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const map = {
        401: ['คีย์เชื่อมต่อเว็บไซต์ไม่ถูกต้องหรือหมดอายุ กรุณาติดต่อผู้ดูแลระบบ', 502],
        403: ['คีย์เชื่อมต่อเว็บไซต์ไม่มีสิทธิ์ทำรายการนี้ (ต้องเป็นสิทธิ์ Read/Write)', 502],
        404: ['ไม่พบข้อมูลที่ร้องขอบนเว็บไซต์', 404],
        429: ['เรียกข้อมูลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', 429],
      };
      const [message, status] = map[response.status] || [response.status >= 500 ? 'เว็บไซต์ขัดข้องชั่วคราว กรุณาลองใหม่' : 'เว็บไซต์ไม่ยอมรับคำขอนี้', response.status >= 500 ? 502 : 400];
      // Log the upstream code only (never the URL with query/credentials or the body).
      console.error('WooCommerce request failed:', response.status, data?.code || '');
      throw new WooError(message, status, 'WOO_' + response.status);
    }
    if (data === null && text) throw new WooError('เว็บไซต์ตอบกลับในรูปแบบที่อ่านไม่ได้', 502, 'WOO_BAD_JSON');
    return { data, total: Number(response.headers.get('x-wp-total')) || 0, totalPages: Number(response.headers.get('x-wp-totalpages')) || 0 };
  }
  // Binary GET (slip images) under wc/v3. Returns { type, body } for image responses only.
  async function image(path, { timeout = 20000 } = {}) {
    if (!configured()) throw new WooError('ยังไม่ได้ตั้งค่าการเชื่อมต่อเว็บไซต์ (WC_KEY / WC_SECRET) กรุณาติดต่อผู้ดูแลระบบ', 503, 'WOO_NOT_CONFIGURED');
    const url = new URL(path.replace(/^\//, ''), base);
    if (!url.protocol.startsWith('https')) throw new WooError('WC_BASE_URL ต้องเป็น https เท่านั้น', 503, 'WOO_INSECURE');
    let response;
    try { response = await fetchImpl(url, { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new WooError('โหลดรูปจากเว็บไซต์ไม่สำเร็จ', 504, 'WOO_NETWORK'); }
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new WooError('ไม่พบรูปสลิป', 404, 'WOO_' + response.status);
    return { type, body: Buffer.from(await response.arrayBuffer()) };
  }
  return {
    configured,
    image,
    wc: (path, options) => call(base, path, options),
    analytics: (path, options) => call(analyticsBase, path, options),
  };
}
