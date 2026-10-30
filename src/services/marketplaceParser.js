// Reads Seller Center exports (Shopee / Lazada / TikTok Shop) into orders + settlements.
// Column names follow the sample exports documented in MARKETPLACE.md. Only the columns listed in SHEETS are
// read: customer name, phone, address and e-mail columns are never touched (province only).
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PLATFORMS, MAX_FILE_BYTES, MAX_ROWS, MAX_UNZIPPED_BYTES, MAX_ZIP_ENTRIES, MarketplaceFileError, fail, norm, text, amount, orderDate, orderId, province } from './marketplace-parse/common.js';
import { readTiktokOrders, readTiktokSettlement } from './marketplace-parse/tiktok.js';
import { readLazadaOrders, readLazadaStatement } from './marketplace-parse/lazada.js';
import { readShopeeOrders, readShopeeIncome } from './marketplace-parse/shopee.js';

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
    // Shopee order export (คำสั่งซื้อของฉัน › Export, Order.all.*.xlsx): one row per product line of an order.
    platform: 'shopee', kind: 'orders', required: ['orderId', 'status', 'orderDate', 'productName', 'quantity', 'netPrice'],
    cols: {
      orderId: ['หมายเลขคำสั่งซื้อ'], status: ['สถานะการสั่งซื้อ'], returnStatus: ['สถานะการคืนเงินหรือคืนสินค้า'], orderDate: ['วันที่ทำการสั่งซื้อ'],
      parentSku: ['เลขอ้างอิง parent sku'], sku: ['เลขอ้างอิง sku (sku reference no.)'], productName: ['ชื่อสินค้า'], variation: ['ชื่อตัวเลือก'],
      quantity: ['จำนวน'], returnQty: ['จำนวนที่ส่งคืน'], netPrice: ['ราคาขายสุทธิ'], province: ['จังหวัด'],
    },
    read: readShopeeOrders,
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

// Public names stay importable from this module.
export { PLATFORMS, MAX_FILE_BYTES, MarketplaceFileError, parseDate } from './marketplace-parse/common.js';
export { lazadaItemStatus } from './marketplace-parse/lazada.js';
