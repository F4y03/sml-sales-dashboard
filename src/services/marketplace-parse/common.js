// Shared cell/date/number helpers for the Seller Center file readers.

export const PLATFORMS = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 200000;
// Zip-bomb guard: measured while inflating, because zip headers can lie about sizes.
export const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2000;

export class MarketplaceFileError extends Error {
  constructor(message) { super(message); this.status = 400; }
}
export const fail = message => { throw new MarketplaceFileError(message); };

export const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export function cellValue(value) {
  if (value == null) return '';
  if (value instanceof Date || typeof value !== 'object') return value;
  if ('result' in value) return cellValue(value.result);
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
  if ('text' in value) return cellValue(value.text);
  return '';
}
export const text = value => { const v = cellValue(value); return v instanceof Date ? '' : String(v).trim(); };
export const round2 = n => Math.round(n * 100) / 100;

export function money(value) {
  const v = cellValue(value);
  if (typeof v === 'number') return v;
  if (v instanceof Date) return NaN;
  const t = String(v).replace(/[,\s฿]|THB/gi, '');
  if (t === '' || t === '-') return 0;
  return /^[+-]?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}
export function amount(value) {
  const n = money(value);
  if (!Number.isFinite(n)) fail('พบตัวเลขยอดเงินในไฟล์ไม่ถูกต้อง ไฟล์อาจถูกแก้ไขหลัง export กรุณา export ไฟล์ใหม่จาก Seller Center');
  return n;
}

export const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export const pad = n => String(n).padStart(2, '0');
// Returns ค.ศ. YYYY-MM-DD or null. Excel dates arrive as UTC wall-clock Dates from exceljs.
// Slash dates are day-first (TikTok TH: 30/09/2026); พ.ศ. years are converted.
export function parseDate(value) {
  const v = cellValue(value);
  let y, m, d, r;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    [y, m, d] = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  } else if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const date = new Date(Math.round((v - 25569) * 86400000));
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    const t = String(v).trim();
    if ((r = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/))) [y, m, d] = [+r[1], +r[2], +r[3]];
    else if ((r = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\D|$)/))) {
      [d, m, y] = [+r[1], +r[2], +r[3]];
      if (m > 12 && d <= 12) [d, m] = [m, d];
    } else if ((r = t.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*\.?[ -](\d{4})(?:\D|$)/))) [d, m, y] = [+r[1], MONTHS[r[2].toLowerCase()], +r[3]];
    else return null;
  }
  if (y > 2400) y -= 543;
  if (!m || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function orderDate(value) {
  return parseDate(value) || fail('พบวันที่สั่งซื้อในไฟล์ไม่ถูกต้อง ไฟล์อาจถูกแก้ไขหลัง export กรุณา export ไฟล์ใหม่จาก Seller Center');
}
// Description rows (TikTok row 2), totals and blank rows have no valid id and are skipped.
export function orderId(value) {
  const v = cellValue(value);
  if (typeof v === 'number' && !Number.isSafeInteger(v)) fail('หมายเลขคำสั่งซื้อในไฟล์ถูกแปลงเป็นตัวเลขจนไม่ครบ (เปิดแล้วบันทึกทับใน Excel) กรุณาใช้ไฟล์ที่ export จาก Seller Center โดยตรง');
  const t = text(v);
  return /^[A-Za-z0-9_-]{5,40}$/.test(t) ? t : '';
}
export function province(value) {
  const t = text(value).split('/')[0].replace(/^จังหวัด\s*/, '').trim();
  return !t || t.includes('*') ? null : t.slice(0, 60);
}


export const getter = (row, cols) => key => (key in cols ? row[cols[key]] : '');
