// Accounting workbook for website (WooCommerce) orders — same layout, header notes, total rows and colours as the
// marketplace "รายงานบัญชี" (marketplaceAccounting.js), built from WooCommerce orders fetched for the date range.
// Working paper only: not a tax document. Nothing is written to WooCommerce or SML.
import ExcelJS from 'exceljs';
import { addSheet, addTotalRow, TOTAL_FILL } from './marketplaceAccounting.js';

// Sales = the statuses WooCommerce Analytics counts as sales (same set as the เว็บไซต์ page).
export const SOLD = new Set(['completed', 'processing', 'on-hold']);
export const WOO_STATUS = { completed: 'สำเร็จ', processing: 'กำลังดำเนินการ', 'on-hold': 'กำลังดำเนินการ (พักไว้)', pending: 'รอชำระเงิน', cancelled: 'ยกเลิก', refunded: 'คืนเงิน', failed: 'ชำระไม่สำเร็จ', 'checkout-draft': 'ร่าง' };
const RAW_STATUS = { completed: 'Completed', processing: 'Processing', 'on-hold': 'On hold', pending: 'Pending payment', cancelled: 'Cancelled', refunded: 'Refunded', failed: 'Failed', 'checkout-draft': 'Draft' };
const AGED_DAYS = 7;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const fmtMoney = v => round2(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = v => String(v ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim();
// WooCommerce *_gmt → Bangkok date / time.
const bkk = gmt => (gmt ? new Date(Date.parse(String(gmt).replace(/Z?$/, 'Z')) + 7 * 3600000).toISOString() : null);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export function wooAccountingData(orders, { now = Date.now() } = {}) {
  const today = new Date(now + 7 * 3600000).toISOString().slice(0, 10);
  const rows = orders.map(o => {
    const created = bkk(o.date_created_gmt), paid = bkk(o.date_paid_gmt);
    const items = (o.line_items || []).map(i => ({ sku: String(i.sku || '').trim(), name: plain(i.name), quantity: num(i.quantity), sales: num(i.total) }));
    const refund = round2((o.refunds || []).reduce((s, r) => s + Math.abs(num(r.total)), 0));
    const sales = round2(items.reduce((s, i) => s + i.sales, 0));
    return {
      id: o.id, orderId: String(o.number || o.id), status: o.status, statusName: WOO_STATUS[o.status] || o.status, statusRaw: RAW_STATUS[o.status] || o.status,
      date: created ? created.slice(0, 10) : null, time: created ? created.slice(11, 16) : null, paidDate: paid ? paid.slice(0, 10) : null,
      payment: o.payment_method_title || o.payment_method || '', items, sales,
      discount: round2(num(o.discount_total)), shipping: round2(num(o.shipping_total)), tax: round2(num(o.total_tax)), refund, total: round2(num(o.total)),
    };
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));

  const by = s => rows.filter(r => r.status === s);
  const sold = rows.filter(r => SOLD.has(r.status));
  const sum = (list, k) => round2(list.reduce((s, r) => s + r[k], 0));
  const summary = rows.length ? [{
    name: 'เว็บไซต์', sales: sum(sold, 'sales'), orders: sold.length, discount: sum(sold, 'discount'), shipping: sum(sold, 'shipping'), tax: sum(sold, 'tax'), total: sum(sold, 'total'),
    refund: sum(rows, 'refund'), cancelled: by('cancelled').length, refunded: by('refunded').length, refundedSales: sum(by('refunded'), 'sales'),
    pending: by('pending').length + by('failed').length, pendingTotal: sum([...by('pending'), ...by('failed')], 'total'),
  }] : [];

  // Product sales: sold orders only, one row per SKU (or name when no SKU).
  const products = new Map();
  for (const r of sold) for (const i of r.items) {
    const key = i.sku || '\u0000' + i.name, p = products.get(key) || { sku: i.sku || null, productName: i.name, quantity: 0, completedSales: 0, openSales: 0 };
    p.quantity += i.quantity;
    if (r.status === 'completed') p.completedSales += i.sales; else p.openSales += i.sales;
    products.set(key, p);
  }
  const productRows = [...products.values()].map(p => ({ ...p, completedSales: round2(p.completedSales) || null, openSales: round2(p.openSales) || null, sales: round2(p.completedSales + p.openSales) }))
    .sort((a, b) => b.sales - a.sales);

  // Orders a person should look at.
  const review = [];
  for (const r of rows) {
    const reasons = [], age = r.date ? daysBetween(r.date, today) : 0;
    if (['pending', 'on-hold'].includes(r.status) && age >= AGED_DAYS) reasons.push(`ค้างสถานะ "${r.statusName}" ${age} วัน ตรวจว่าลูกค้าชำระเงินแล้วหรือควรยกเลิก`);
    if (r.status === 'processing' && age > 2) reasons.push(`ชำระแล้วแต่ยังไม่จัดส่ง ${age} วัน`);
    if (SOLD.has(r.status) && !r.paidDate) reasons.push('สถานะเป็นยอดขาย แต่ไม่มีวันที่ชำระเงิน (เช่น โอนเงิน/เก็บเงินปลายทาง) ตรวจกับบัญชีธนาคาร');
    if (r.refund > 0 && r.status !== 'refunded') reasons.push(`มีการคืนเงินบางส่วน ${fmtMoney(r.refund)} บาท`);
    if (r.items.some(i => !i.sku)) reasons.push('มีสินค้าที่ไม่มี SKU จับคู่กับ SML ไม่ได้');
    if (reasons.length) review.push({ ...r, age, reasons: reasons.join('\n') });
  }
  const unpaid = rows.filter(r => ['pending', 'failed'].includes(r.status)).map(r => ({ ...r, age: r.date ? daysBetween(r.date, today) : null }));
  const paidRows = rows.filter(r => r.paidDate).sort((a, b) => a.paidDate.localeCompare(b.paidDate));
  return { rows, summary, productRows, review, unpaid, paidRows, soldWithoutItems: sold.filter(r => !r.items.length).length };
}

const orderColumns = [
  { header: 'วันที่สั่งซื้อ', key: 'date', width: 13, date: true }, { header: 'ช่องทาง', key: 'platformName', width: 11 },
  { header: 'เลขออเดอร์', key: 'orderId', width: 14, note: 'เลขคำสั่งซื้อบนเว็บไซต์ ใช้ค้นในหน้า จัดการออเดอร์ออนไลน์ หรือหลังร้าน WooCommerce ได้' },
  { header: 'สถานะ', key: 'statusName', width: 22, note: 'สำเร็จ = ส่งของแล้ว · กำลังดำเนินการ = ชำระแล้ว/รอตรวจสลิป ยังไม่ส่ง · รอชำระเงิน · ยกเลิก · คืนเงิน · ชำระไม่สำเร็จ' },
];
const named = r => ({ ...r, platformName: 'เว็บไซต์' });

export async function buildWooAccountingWorkbook(orders, filter, meta = {}) {
  const data = wooAccountingData(orders, filter);
  const workbook = new ExcelJS.Workbook();

  const summary = addSheet(workbook, 'สรุป', [
    { header: 'ช่องทาง', key: 'name', width: 12 },
    { header: 'ยอดขาย (สำเร็จ + กำลังดำเนินการ)', key: 'sales', width: 22, money: true, note: 'ราคาสินค้าหลังหักส่วนลด ไม่รวมค่าส่ง ของออเดอร์สถานะ สำเร็จ / กำลังดำเนินการ / พักไว้' },
    { header: 'จำนวนออเดอร์', key: 'orders', width: 12, note: 'จำนวนออเดอร์สถานะ สำเร็จ / กำลังดำเนินการ / พักไว้' },
    { header: 'ส่วนลด', key: 'discount', width: 14, money: true, note: 'ส่วนลด/คูปองของออเดอร์ขาย (หักไว้แล้วในยอดขาย)' },
    { header: 'ค่าส่งที่ลูกค้าจ่าย', key: 'shipping', width: 16, money: true },
    { header: 'ภาษี', key: 'tax', width: 12, money: true, note: 'ภาษีที่ WooCommerce คำนวณแยก (0 = ร้านไม่ได้เปิดคำนวณภาษีบนเว็บ ราคาอาจรวมภาษีแล้ว)' },
    { header: 'ยอดรวมที่ลูกค้าจ่าย', key: 'total', width: 18, money: true, fill: TOTAL_FILL, note: 'ยอดขาย + ค่าส่ง + ภาษี (ยอดที่ลูกค้าต้องชำระ) ของออเดอร์ขาย' },
    { header: 'ยอดคืนเงิน', key: 'refund', width: 14, money: true, note: 'เงินที่คืนให้ลูกค้าในออเดอร์ช่วงนี้ (ทุกสถานะ รวมคืนบางส่วน)' },
    { header: 'ยกเลิก (ออเดอร์)', key: 'cancelled', width: 12 }, { header: 'คืนเงิน (ออเดอร์)', key: 'refunded', width: 12 },
    { header: 'ยอดขายของออเดอร์คืนเงิน', key: 'refundedSales', width: 18, money: true },
    { header: 'รอชำระ / ชำระไม่สำเร็จ (ออเดอร์)', key: 'pending', width: 16 }, { header: 'ยอดที่ยังไม่ชำระ', key: 'pendingTotal', width: 16, money: true },
  ], data.summary);

  const withItems = r => ({ ...named(r),
    skus: r.items.map(i => i.sku || '-').join('\n') || null,
    productNames: r.items.map(i => (r.items.length > 1 || i.quantity !== 1 ? `${i.name} × ${i.quantity}` : i.name)).join('\n') || null,
    unitPrices: r.items.map(i => (i.quantity ? fmtMoney(i.sales / i.quantity) : '-')).join('\n') || null,
    lineSales: r.items.map(i => fmtMoney(i.sales)).join('\n') || null });
  const register = addSheet(workbook, 'ทะเบียนขายรายออเดอร์', [orderColumns[0],
    { header: 'เวลาสั่งซื้อ', key: 'time', width: 10, note: 'เวลาที่ลูกค้าสั่งซื้อ (เวลาไทย)' },
    { header: 'วันที่ชำระเงิน', key: 'paidDate', width: 13, date: true, note: 'วันที่ระบบชำระเงินยืนยันการจ่าย (บัตร/QR) ช่องว่าง = ยังไม่ชำระ หรือชำระนอกระบบ เช่น โอนเงิน/เก็บเงินปลายทาง' },
    orderColumns[1], orderColumns[2],
    { header: 'SKU', key: 'skus', width: 18, note: 'รหัสสินค้าในออเดอร์ ถ้ามีหลายสินค้าจะอยู่คนละบรรทัดในช่องเดียว' },
    { header: 'ชื่อสินค้า', key: 'productNames', width: 48, note: 'ชื่อสินค้าในออเดอร์ (× จำนวนชิ้น) ยอดขายของแถวเป็นยอดรวมทั้งออเดอร์' },
    { header: 'ราคา/ชิ้น', key: 'unitPrices', width: 13, note: 'ราคาขายต่อชิ้นหลังหักส่วนลด (บรรทัดตรงกับ SKU)' },
    { header: 'ยอดขายรายสินค้า', key: 'lineSales', width: 15, note: 'ยอดขายของแต่ละสินค้า (บรรทัดตรงกับ SKU) รวมกันเท่ากับคอลัมน์ ยอดขาย' },
    orderColumns[3],
    { header: 'สถานะจากเว็บไซต์', key: 'statusRaw', width: 18, note: 'สถานะตามที่ WooCommerce ส่งมา' },
    { header: 'วิธีชำระเงิน', key: 'payment', width: 22 },
    { header: 'ยอดขาย', key: 'sales', money: true, fill: 'FFDDEBF7', note: 'ราคาสินค้าหลังหักส่วนลด ไม่รวมค่าส่งและภาษี' },
    { header: 'ส่วนลด', key: 'discount', money: true }, { header: 'ค่าส่ง', key: 'shipping', money: true }, { header: 'ภาษี', key: 'tax', money: true },
    { header: 'ยอดคืนเงิน', key: 'refund', money: true },
    { header: 'ยอดรวมออเดอร์', key: 'total', money: true, fill: TOTAL_FILL, note: 'ยอดที่ลูกค้าต้องชำระ = ยอดขาย + ค่าส่ง + ภาษี (ก่อนหักเงินคืน)' },
  ], data.rows.map(withItems));
  const longest = Math.max(20, ...register.getColumn('productNames').values.slice(2).flatMap(v => String(v ?? '').split('\n').map(s => s.length)));
  register.getColumn('productNames').width = Math.min(longest * 1.05 + 2, 110);
  register.eachRow((row, n) => { if (n > 1) row.eachCell({ includeEmpty: true }, cell => { cell.alignment = { ...cell.alignment, vertical: 'top' }; }); });
  for (const key of ['skus', 'productNames']) register.getColumn(key).eachCell((cell, n) => { if (n > 1) cell.alignment = { wrapText: true, vertical: 'top' }; });
  for (const key of ['unitPrices', 'lineSales']) register.getColumn(key).eachCell((cell, n) => { if (n > 1) cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'right' }; });
  if (data.rows.length) addTotalRow(register, 'payment', ['sales', 'discount', 'shipping', 'tax', 'refund', 'total'], data.rows.length + 1);

  const productSheet = addSheet(workbook, 'ขายรายสินค้า', [
    { header: 'SKU', key: 'sku', width: 22, note: 'รหัสสินค้าบนเว็บไซต์' },
    { header: 'ชื่อสินค้า', key: 'productName', width: 48, note: 'ชื่อสินค้าตามที่ลงขายบนเว็บไซต์ (อาจไม่ตรงกับชื่อใน SML)' },
    { header: 'จำนวน', key: 'quantity', width: 10, note: 'จำนวนชิ้นที่ขาย ไม่รวมออเดอร์ยกเลิก/คืนเงิน/ยังไม่ชำระ' },
    { header: 'ยอดขายที่สำเร็จแล้ว', key: 'completedSales', width: 20, money: true, note: 'ออเดอร์สถานะ สำเร็จ (ส่งของแล้ว)' },
    { header: 'ยอดขายที่ยังไม่สำเร็จ', key: 'openSales', width: 20, money: true, note: 'ออเดอร์ที่ชำระแล้วหรือรอตรวจสลิป แต่ยังไม่ส่งของ' },
    { header: 'ยอดขายรวม', key: 'sales', width: 16, money: true, fill: TOTAL_FILL, note: 'ราคาหลังหักส่วนลด ไม่รวมค่าส่ง' },
  ], data.productRows);
  if (data.productRows.length) addTotalRow(productSheet, 'productName', ['quantity', 'completedSales', 'openSales', 'sales'], data.productRows.length + 1);

  const paidSheet = addSheet(workbook, 'ชำระเงินในช่วงนี้', [
    { header: 'วันที่ชำระเงิน', key: 'paidDate', width: 13, date: true }, ...orderColumns, { header: 'วิธีชำระเงิน', key: 'payment', width: 22 },
    { header: 'ยอดรวมออเดอร์', key: 'total', money: true, fill: TOTAL_FILL }, { header: 'ยอดคืนเงิน', key: 'refund', money: true },
  ], data.paidRows.map(named));
  if (data.paidRows.length) addTotalRow(paidSheet, 'payment', ['total', 'refund'], data.paidRows.length + 1);

  const reviewSheet = addSheet(workbook, 'รายการที่ต้องตรวจ', [...orderColumns, { header: 'ยอดรวมออเดอร์', key: 'total', money: true }, { header: 'ยอดคืนเงิน', key: 'refund', money: true },
    { header: 'อายุ (วัน)', key: 'age', width: 10 }, { header: 'เหตุผล', key: 'reasons', width: 60 }], data.review.map(named));
  reviewSheet.getColumn('reasons').eachCell((cell, n) => { if (n > 1) cell.alignment = { wrapText: true, vertical: 'top' }; });
  if (data.review.length) addTotalRow(reviewSheet, 'statusName', ['total', 'refund'], data.review.length + 1);

  const unpaidSheet = addSheet(workbook, 'ยังไม่ชำระเงิน', [...orderColumns, { header: 'ยอดรวมออเดอร์', key: 'total', money: true }, { header: 'อายุ (วัน)', key: 'age', width: 10 }], data.unpaid.map(named));
  if (data.unpaid.length) addTotalRow(unpaidSheet, 'statusName', ['total'], data.unpaid.length + 1);

  const notes = workbook.addWorksheet('หมายเหตุ');
  notes.columns = [{ width: 28 }, { width: 100 }];
  notes.addRows([
    ['ช่วงวันที่สั่งซื้อ', `${filter.start} ถึง ${filter.end}`],
    ['ช่องทาง', 'เว็บไซต์ proplusaudio.com (WooCommerce)'],
    ['ออกรายงานเมื่อ', new Date(filter.now ?? Date.now()).toISOString()],
    ['ออกโดย', meta.by || ''],
    ...(filter.truncated ? [['ข้อมูลไม่ครบ', 'ช่วงนี้มีออเดอร์เกิน 5,000 รายการ รายงานนี้มีเฉพาะ 5,000 รายการแรก กรุณาแบ่งช่วงวันที่ให้สั้นลง']] : []),
    [],
    ['ยอดขาย', 'ราคาสินค้าหลังหักส่วนลด ไม่รวมค่าส่งและภาษี นับเฉพาะ สำเร็จ + กำลังดำเนินการ (รวมพักไว้/รอตรวจสลิป) ตามเกณฑ์ของ WooCommerce Analytics'],
    ['วันที่', 'วันที่สร้างคำสั่งซื้อ (เวลาไทย) ไม่ใช่วันจัดส่งหรือวันรับเงิน ต้องกำหนดเกณฑ์รับรู้รายได้ตามนโยบายบัญชีของบริษัท'],
    ['ชำระเงินในช่วงนี้', 'ออเดอร์ในช่วงนี้ที่ระบบชำระเงินบันทึกวันที่จ่าย (บัตร/QR) การโอนเงินหรือเก็บเงินปลายทางอาจไม่มีวันที่ ต้องกระทบยอดกับบัญชีธนาคาร'],
    ['ค่าธรรมเนียม', 'เว็บไซต์ไม่ได้ส่งค่าธรรมเนียมของผู้ให้บริการชำระเงิน (บัตร/QR) มา จึงไม่มีในรายงานนี้ ต้องดูจากรายงานของผู้ให้บริการชำระเงิน'],
    ['ขายรายสินค้า', data.soldWithoutItems ? `ไม่รวม ${data.soldWithoutItems} ออเดอร์ที่ไม่มีรายการสินค้า` : 'ออเดอร์ขายในช่วงนี้มีรายการสินค้าครบ'],
    ['ไม่มีในรายงานนี้', 'ภาษีหัก ณ ที่จ่าย, ค่าธรรมเนียมรับชำระเงิน, ต้นทุนสินค้า และวันที่เงินเข้าบัญชีจริง'],
    ['สถานะเอกสาร', 'เป็นเอกสารประกอบการทำงาน ไม่ใช่รายงานภาษีขายหรือใบกำกับภาษี'],
  ]);
  notes.getColumn(1).font = { bold: true };
  notes.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  const TAB_ORDER = ['ทะเบียนขายรายออเดอร์', 'ขายรายสินค้า', 'ชำระเงินในช่วงนี้', 'รายการที่ต้องตรวจ', 'ยังไม่ชำระเงิน', 'สรุป', 'หมายเหตุ'];
  for (const sheet of workbook.worksheets) { const i = TAB_ORDER.indexOf(sheet.name); sheet.orderNo = i < 0 ? TAB_ORDER.length : i; }
  workbook.views = [{ activeTab: 0, firstSheet: 0 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
