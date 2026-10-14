// Reads Seller Center exports (Shopee / Lazada / TikTok Shop) into orders + settlements.
// Column names follow the sample exports documented in MARKETPLACE.md. Only the columns listed in SHEETS are
// read: customer name, phone, address and e-mail columns are never touched (province only).
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const PLATFORMS = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 200000;
// Zip-bomb guard: measured while inflating, because zip headers can lie about sizes.
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

export class MarketplaceFileError extends Error {
  constructor(message) { super(message); this.status = 400; }
}
const fail = message => { throw new MarketplaceFileError(message); };

const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
function cellValue(value) {
  if (value == null) return '';
  if (value instanceof Date || typeof value !== 'object') return value;
  if ('result' in value) return cellValue(value.result);
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
  if ('text' in value) return cellValue(value.text);
  return '';
}
const text = value => { const v = cellValue(value); return v instanceof Date ? '' : String(v).trim(); };
const round2 = n => Math.round(n * 100) / 100;

function money(value) {
  const v = cellValue(value);
  if (typeof v === 'number') return v;
  if (v instanceof Date) return NaN;
  const t = String(v).replace(/[,\s฿]|THB/gi, '');
  if (t === '' || t === '-') return 0;
  return /^[+-]?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}
function amount(value) {
  const n = money(value);
  if (!Number.isFinite(n)) fail('พบตัวเลขยอดเงินในไฟล์ไม่ถูกต้อง ไฟล์อาจถูกแก้ไขหลัง export กรุณา export ไฟล์ใหม่จาก Seller Center');
  return n;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
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
function orderDate(value) {
  return parseDate(value) || fail('พบวันที่สั่งซื้อในไฟล์ไม่ถูกต้อง ไฟล์อาจถูกแก้ไขหลัง export กรุณา export ไฟล์ใหม่จาก Seller Center');
}
// Description rows (TikTok row 2), totals and blank rows have no valid id and are skipped.
function orderId(value) {
  const v = cellValue(value);
  if (typeof v === 'number' && !Number.isSafeInteger(v)) fail('หมายเลขคำสั่งซื้อในไฟล์ถูกแปลงเป็นตัวเลขจนไม่ครบ (เปิดแล้วบันทึกทับใน Excel) กรุณาใช้ไฟล์ที่ export จาก Seller Center โดยตรง');
  const t = text(v);
  return /^[A-Za-z0-9_-]{5,40}$/.test(t) ? t : '';
}
function province(value) {
  const t = text(value).split('/')[0].replace(/^จังหวัด\s*/, '').trim();
  return !t || t.includes('*') ? null : t.slice(0, 60);
}

// ---------- status buckets: completed (สำเร็จ) / pending (กำลังดำเนินการ) / cancelled (ยกเลิก) / returned (คืนสินค้า)
function tiktokStatus(status, substatus, cancelType, refund, returnQty) {
  const s = norm(status), sub = norm(substatus), t = norm(cancelType);
  if (/ยกเลิก|cancel/.test(s) || t === 'cancel') return 'cancelled';
  if (refund > 0 || returnQty > 0 || /return|refund|คืน/.test(`${t} ${sub}`)) return 'returned';
  if (/เสร็จสมบูรณ์|completed|delivered|จัดส่งสำเร็จ/.test(`${s} ${sub}`)) return 'completed';
  return 'pending';
}
function lazadaItemStatus(status, refund) {
  const s = norm(status);
  if (/cancel/.test(s)) return 'cancelled';
  if (refund > 0 || /return|refund|failed/.test(s)) return 'returned';
  if (/delivered|confirmed|completed/.test(s)) return 'completed';
  return 'pending';
}

// ---------- sheet signatures. `cols` maps a key to accepted header names (compared lower-case, spaces collapsed).
const SHEETS = [
  {
    platform: 'tiktok', kind: 'orders', required: ['orderId', 'status', 'productName', 'quantity', 'subtotalBefore', 'created'],
    cols: {
      orderId: ['order id'], status: ['order status'], substatus: ['order substatus'], cancelType: ['cancelation/return type', 'cancellation/return type'],
      skuId: ['sku id'], sellerSku: ['seller sku'], productName: ['product name'], variation: ['variation'], quantity: ['quantity'],
      returnQty: ['sku quantity of return'], subtotalBefore: ['sku subtotal before discount'], sellerDiscount: ['sku seller discount'],
      refund: ['order refund amount'], created: ['created time'], province: ['province'],
    },
    read: readTiktokOrders,
  },
  {
    platform: 'tiktok', kind: 'settlement', required: ['txnId', 'orderId', 'fees', 'net'],
    cols: {
      txnId: ['หมายเลขคำสั่งซื้อ/การปรับ', 'order/adjustment id'], orderId: ['หมายเลขคำสั่งซื้อที่เกี่ยวข้อง', 'related order id'],
      fees: ['ค่าธรรมเนียมทั้งหมด', 'total fees'], net: ['ยอดการชำระเงินทั้งหมด', 'total settlement amount'],
    },
    read: readTiktokSettlement,
  },
  {
    platform: 'lazada', kind: 'orders', required: ['itemId', 'orderNumber', 'createTime', 'itemName', 'unitPrice', 'status'],
    cols: {
      itemId: ['orderitemid'], orderNumber: ['ordernumber'], createTime: ['createtime'], sellerSku: ['sellersku'], lazadaSku: ['lazadasku'],
      itemName: ['itemname'], variation: ['variation'], unitPrice: ['unitprice'], sellerDiscount: ['sellerdiscounttotal'],
      status: ['status'], refund: ['refundamount'], shipProvince: ['shippingaddress3'], billProvince: ['billingaddr3'],
    },
    read: readLazadaOrders,
  },
  {
    platform: 'lazada', kind: 'balance', required: ['txn', 'time', 'type', 'subType', 'amount'],
    cols: { txn: ['transaction number'], time: ['transaction time'], type: ['type'], subType: ['sub type'], amount: ['amount'] },
    hint: 'ไฟล์นี้เป็นรายการเงินเข้า–ออกของ Lazada ซึ่งไม่มีรายการคำสั่งซื้อ กรุณา export ไฟล์คำสั่งซื้อจาก Lazada Seller Center (คำสั่งซื้อ › Export)',
  },
  {
    platform: 'lazada', kind: 'statement', required: ['statementPeriod', 'cycle', 'feeName', 'amount', 'orderNumber'],
    cols: { statementPeriod: ['ระยะเวลาใบแจ้งยอด'], cycle: ['รหัสรอบบิล'], shortCode: ['short code'], feeName: ['ชื่อรายการธุรกรรม'], amount: ['จำนวนเงิน(รวมภาษี)'], orderNumber: ['หมายเลขคำสั่งซื้อ'] },
    read: readLazadaStatement,
    shopCode: (rows, headerRow, cols) => firstValue(rows.slice(headerRow + 1).map(row => row[cols.shortCode])),
  },
  {
    platform: 'shopee', kind: 'income', required: ['orderId', 'orderDate', 'price', 'payout'],
    cols: {
      orderId: ['หมายเลขคำสั่งซื้อ'], returnId: ['รหัสคืนสินค้า'], orderDate: ['วันที่ทำการสั่งซื้อ'], price: ['สินค้าราคาปกติ'],
      sellerDiscount: ['ส่วนลดสินค้าจากผู้ขาย'], refund: ['จำนวนเงินที่ทำการคืนให้ผู้ซื้อ'],
      payout: ['จำนวนเงินทั้งหมดที่โอนแล้ว (฿)', 'จำนวนเงินทั้งหมดที่โอนแล้ว'],
      feeAms: ['ค่าคอมมิชชั่น ams'], feeCommission: ['ค่าคอมมิชชั่น'], feeService: ['ค่าบริการ'],
      feeInfra: ['ค่าธรรมเนียมโครงสร้างพื้นฐานแพลตฟอร์ม'], feeShippingSaver: ['ค่าธรรมเนียม ของโปรแกรมประหยัดค่าจัดส่ง'],
      feePayment: ['ค่าธุรกรรมการชำระเงิน'],
    },
    read: readShopeeIncome,
    shopCode: rows => labelBelow(rows, 'ชื่อผู้ใช้ (ผู้ขาย)'),
  },
  {
    platform: 'shopee', kind: 'wallet', required: ['type', 'orderId', 'amount', 'balance'],
    cols: { type: ['ประเภทการทำธุรกรรม'], orderId: ['รหัสคำสั่งซื้อ'], amount: ['จำนวนเงิน'], balance: ['ยอดเงินหลังทำธุรกรรมเสร็จสิ้น'] },
    hint: 'ไฟล์นี้เป็นรายการกระเป๋าเงิน Shopee ซึ่งไม่มีรายการคำสั่งซื้อ กรุณา export "รายงานรายรับของฉัน" จาก Shopee Seller Center (การเงิน › รายรับของฉัน)',
  },
];
const SHOPEE_FEES = ['feeAms', 'feeCommission', 'feeService', 'feeInfra', 'feeShippingSaver', 'feePayment'];

// Seller identity found inside a file (Shopee username, Lazada short code); null when the export has none.
const SHOP_CODE = /^[\w.-]{2,60}$/;
function firstValue(values) {
  for (const value of values) { const t = text(value); if (SHOP_CODE.test(t)) return t; }
  return null;
}
function labelBelow(rows, label) {
  for (let r = 0; r < Math.min(rows.length - 1, 10); r++) {
    const i = (rows[r] || []).findIndex(cell => norm(text(cell)) === label);
    if (i >= 0) return firstValue([rows[r + 1]?.[i]]);
  }
  return null;
}

function findHeader(rows, sheet) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const index = new Map();
    rows[r].forEach((cell, i) => { const key = norm(text(cell)); if (key && !index.has(key)) index.set(key, i); });
    const cols = {};
    for (const [key, names] of Object.entries(sheet.cols)) {
      const name = names.find(n => index.has(n));
      if (name !== undefined) cols[key] = index.get(name);
    }
    if (sheet.required.every(key => key in cols)) return { headerRow: r, cols };
  }
  return null;
}
const getter = (row, cols) => key => (key in cols ? row[cols[key]] : '');

function readTiktokOrders(rows, start, cols) {
  const orders = new Map();
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderId'));
    if (!id) continue;
    let order = orders.get(id);
    if (!order) {
      order = { orderId: id, orderDate: orderDate(get('created')), statusRaw: text(get('status')), substatus: text(get('substatus')),
        cancelType: text(get('cancelType')), refund: Math.abs(amount(get('refund'))), province: province(get('province')), returnQty: 0, items: [] };
      orders.set(id, order);
    }
    order.returnQty += Math.max(0, amount(get('returnQty')));
    const sku = text(get('sellerSku')) || text(get('skuId'));
    const name = [text(get('productName')), text(get('variation'))].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    let lineKey = text(get('skuId')) || `${sku}|${name}`;
    if (order.items.some(item => item.lineKey === lineKey)) lineKey += `#${order.items.length}`;
    order.items.push({ lineKey, sku, name, quantity: amount(get('quantity')), sales: round2(amount(get('subtotalBefore')) - Math.abs(amount(get('sellerDiscount')))) });
  }
  return [...orders.values()].map(({ substatus, cancelType, returnQty, ...order }) => {
    const status = tiktokStatus(order.statusRaw, substatus, cancelType, order.refund, returnQty);
    return { ...order, status, source: 'orders', sales: round2(order.items.reduce((sum, item) => sum + item.sales, 0)), items: order.items.map(item => ({ ...item, status })) };
  });
}

function readLazadaOrders(rows, start, cols) {
  const orders = new Map();
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderNumber'));
    if (!id) continue;
    let order = orders.get(id);
    if (!order) {
      const ship = province(get('shipProvince'));
      order = { orderId: id, orderDate: orderDate(get('createTime')), province: ship || province(get('billProvince')), items: [] };
      orders.set(id, order);
    }
    const refund = Math.abs(amount(get('refund'))), statusRaw = text(get('status'));
    const sku = text(get('sellerSku')) || text(get('lazadaSku'));
    const name = [text(get('itemName')), text(get('variation'))].filter(Boolean).join(' · ') || sku || 'ไม่ระบุชื่อสินค้า';
    let lineKey = text(get('itemId')) || `${sku}|${name}`;
    if (order.items.some(item => item.lineKey === lineKey)) lineKey += `#${order.items.length}`;
    // One row is one unit in the Lazada export.
    order.items.push({ lineKey, sku, name, quantity: 1, sales: round2(amount(get('unitPrice')) - Math.abs(amount(get('sellerDiscount')))), refund, statusRaw, status: lazadaItemStatus(statusRaw, refund) });
  }
  return [...orders.values()].map(order => {
    const active = order.items.filter(item => item.status !== 'cancelled');
    const status = !active.length ? 'cancelled' : active.some(item => item.status === 'returned') ? 'returned'
      : active.every(item => item.status === 'completed') ? 'completed' : 'pending';
    const counted = active.length ? active : order.items;
    return { ...order, status, source: 'orders', statusRaw: [...new Set(order.items.map(item => item.statusRaw))].join(', '),
      sales: round2(counted.reduce((sum, item) => sum + item.sales, 0)), refund: round2(order.items.reduce((sum, item) => sum + item.refund, 0)),
      items: order.items.map(({ refund, statusRaw, ...item }) => item) };
  });
}

function readShopeeIncome(rows, start, cols) {
  const orders = new Map(), settlements = [];
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderId'));
    if (!id) continue;
    const fees = -SHOPEE_FEES.reduce((sum, key) => sum + amount(get(key)), 0);
    const line = { price: amount(get('price')), discount: Math.abs(amount(get('sellerDiscount'))), refund: Math.abs(amount(get('refund'))), payout: amount(get('payout')), fees, returnId: text(get('returnId')) };
    const order = orders.get(id) || { orderId: id, orderDate: orderDate(get('orderDate')), price: 0, discount: 0, refund: 0, payout: 0, fees: 0, returnId: '' };
    for (const key of ['price', 'discount', 'refund', 'payout', 'fees']) order[key] += line[key];
    order.returnId ||= line.returnId;
    orders.set(id, order);
  }
  const result = [...orders.values()].map(o => {
    settlements.push({ txnId: `income:${o.orderId}`, orderId: o.orderId, fees: round2(o.fees), netPayout: round2(o.payout) });
    // The income report only lists orders Shopee has paid out, so they are completed unless refunded.
    const status = o.returnId || o.refund > 0 ? 'returned' : 'completed';
    return { orderId: o.orderId, orderDate: o.orderDate, status, statusRaw: status === 'returned' ? 'คืนเงิน/คืนสินค้า' : 'โอนเงินแล้ว',
      sales: round2(o.price - o.discount), refund: round2(o.refund), province: null, items: null, source: 'income' };
  });
  return { orders: result, settlements };
}

function readTiktokSettlement(rows, start, cols) {
  const settlements = [];
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), txnId = orderId(get('txnId')), related = orderId(get('orderId'));
    if (!txnId || !related) continue;
    settlements.push({ txnId, orderId: related, fees: round2(-amount(get('fees'))), netPayout: round2(amount(get('net'))) });
  }
  return { orders: [], settlements };
}

// Lazada Income Overview (ใบแจ้งยอด): one row per money line. Per order and billing cycle,
// netPayout = Σ all lines; fees = product lines (ยอดรวมค่าสินค้า / หักเงินค่าสินค้า) − netPayout.
const LAZADA_PRODUCT_LINES = /^(ยอดรวมค่าสินค้า|หักเงินค่าสินค้า)/;
function readLazadaStatement(rows, start, cols) {
  const groups = new Map();
  for (const row of rows.slice(start)) {
    const get = getter(row, cols), id = orderId(get('orderNumber')), cycle = text(get('cycle'));
    if (!id || !cycle) continue;
    const txnId = `statement:${cycle}:${id}`.slice(0, 120), value = amount(get('amount'));
    const g = groups.get(txnId) || { txnId, orderId: id, product: 0, net: 0 };
    g.net += value;
    if (LAZADA_PRODUCT_LINES.test(text(get('feeName')))) g.product += value;
    groups.set(txnId, g);
  }
  const settlements = [...groups.values()].map(g => ({ txnId: g.txnId, orderId: g.orderId, fees: round2(g.product - g.net), netPayout: round2(g.net) }));
  return { orders: [], settlements };
}

// ---------- file decoding
function parseCsv(source) {
  const firstLine = source.slice(0, source.indexOf('\n') >>> 0);
  const delimiter = [',', '\t', ';'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
      if (rows.length > MAX_ROWS) fail('ไฟล์มีจำนวนแถวมากเกินไป กรุณาแบ่ง export เป็นช่วงวันที่สั้นลง');
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-874').decode(buffer); }
}
// TikTok exports write every cell in its own <row r="N"> element; exceljs keeps only the last one per row number.
// Merge consecutive elements with the same row number before loading.
async function checkUnzippedSize(zip) {
  const tooBig = 'ไฟล์ Excel นี้มีข้อมูลเมื่อคลายออกมาใหญ่เกินไป กรุณาแบ่ง export เป็นช่วงวันที่สั้นลง';
  const files = Object.values(zip.files).filter(file => !file.dir);
  if (files.length > MAX_ZIP_ENTRIES) fail(tooBig);
  let total = 0;
  for (const file of files) {
    await new Promise((resolve, reject) => {
      const stream = file.internalStream('uint8array');
      stream.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_UNZIPPED_BYTES) { stream.pause(); reject(new MarketplaceFileError(tooBig)); }
      }).on('error', reject).on('end', resolve).resume();
    });
  }
}
async function mergeSplitRows(buffer) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { fail('เปิดไฟล์ Excel นี้ไม่ได้ ไฟล์อาจเสียหายหรือตั้งรหัสผ่านไว้ กรุณา export ไฟล์ใหม่จาก Seller Center'); }
  await checkUnzippedSize(zip);
  let changed = false;
  for (const path of Object.keys(zip.files).filter(p => /^xl\/worksheets\/[^/]+\.xml$/.test(p))) {
    const xml = await zip.file(path).async('string');
    let current = null;
    const merged = xml.replace(/(<\/row>\s*)?<row r="(\d+)"[^>]*>/g, (match, close, row) => {
      const same = close && row === current;
      current = row;
      return same ? '' : match;
    });
    if (merged !== xml) { zip.file(path, merged); changed = true; }
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer' }) : buffer;
}
async function readSheets(buffer, fileName) {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) fail('ไฟล์ .xls รุ่นเก่ายังไม่รองรับ กรุณาเปิดไฟล์แล้วบันทึกเป็น .xlsx หรือ export เป็น .csv');
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const workbook = new ExcelJS.Workbook();
    const prepared = await mergeSplitRows(buffer);
    try { await workbook.xlsx.load(prepared); } catch { fail('เปิดไฟล์ Excel นี้ไม่ได้ ไฟล์อาจเสียหายหรือตั้งรหัสผ่านไว้ กรุณา export ไฟล์ใหม่จาก Seller Center'); }
    const sheets = []; let total = 0;
    workbook.eachSheet(worksheet => {
      const rows = [];
      worksheet.eachRow({ includeEmpty: true }, (row, number) => { rows[number - 1] = row.values.slice(1); });
      total += rows.length;
      sheets.push({ name: worksheet.name, rows: Array.from(rows, r => r || []) });
    });
    if (total > MAX_ROWS) fail('ไฟล์มีจำนวนแถวมากเกินไป กรุณาแบ่ง export เป็นช่วงวันที่สั้นลง');
    return sheets;
  }
  if (!['csv', 'txt'].includes(ext)) fail('รองรับเฉพาะไฟล์ Excel (.xlsx) หรือ .csv ที่ export จาก Seller Center');
  return [{ name: fileName, rows: parseCsv(decodeText(buffer)) }];
}

// Returns { orders, settlements, kinds }. Throws MarketplaceFileError with a Thai message the uploader can act on.
export async function parseMarketplaceFile({ buffer, fileName = '', platform }) {
  if (!PLATFORMS[platform]) fail('กรุณาเลือกแพลตฟอร์ม Shopee, Lazada หรือ TikTok Shop');
  if (!buffer?.length) fail('ไฟล์ว่างเปล่า กรุณาเลือกไฟล์ใหม่');
  if (buffer.length > MAX_FILE_BYTES) fail('ไฟล์ใหญ่เกิน 20 MB กรุณาแบ่ง export เป็นช่วงวันที่สั้นลง');
  const sheets = await readSheets(buffer, fileName);
  const found = [];
  for (const { rows } of sheets) {
    for (const sheet of SHEETS) {
      const header = findHeader(rows, sheet);
      if (header) { found.push({ sheet, rows, ...header }); break; }
    }
  }
  const mine = found.filter(f => f.sheet.platform === platform && f.sheet.read);
  if (!mine.length) {
    const other = found.find(f => f.sheet.platform !== platform);
    if (other) fail(`ไฟล์นี้เป็นไฟล์ของ ${PLATFORMS[other.sheet.platform]} แต่เลือกแพลตฟอร์ม ${PLATFORMS[platform]} อยู่ กรุณาเลือกแพลตฟอร์มให้ถูกต้องแล้วอัปโหลดใหม่`);
    const hint = found.find(f => f.sheet.platform === platform && f.sheet.hint);
    if (hint) fail(hint.sheet.hint);
    fail(`ไม่พบหัวคอลัมน์ของไฟล์ ${PLATFORMS[platform]} ไฟล์นี้อาจไม่ใช่ไฟล์ที่ export จาก Seller Center หรือหัวคอลัมน์ถูกแก้ไข กรุณาตรวจสอบไฟล์อีกครั้ง`);
  }
  const orders = new Map(), settlements = new Map();
  let shopCode = null;
  for (const { sheet, rows, headerRow, cols } of mine) {
    shopCode ||= sheet.shopCode?.(rows, headerRow, cols) || null;
    const result = sheet.read(rows, headerRow + 1, cols);
    for (const order of Array.isArray(result) ? result : result.orders) orders.set(order.orderId, order);
    for (const s of Array.isArray(result) ? [] : result.settlements) settlements.set(s.txnId, s);
  }
  if (!orders.size && !settlements.size) fail('ไฟล์นี้ไม่มีรายการคำสั่งซื้อ กรุณาตรวจสอบช่วงวันที่ที่ export');
  return { orders: [...orders.values()], settlements: [...settlements.values()], kinds: [...new Set(mine.map(f => f.sheet.kind))], shopCode };
}
