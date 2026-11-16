// Accounting workbook for online sales: order register, platform money, fee types, items to review. No HTTP here.
// Uses the definitions in MARKETPLACE.md. It holds no buyer data and is working paper, not a tax document.
import ExcelJS from 'exceljs';

const SOLD = "('completed','pending')";
const STATUS = { completed: 'สำเร็จ', pending: 'กำลังดำเนินการ', cancelled: 'ยกเลิก', returned: 'คืนสินค้า' };
const PLATFORM = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };
const MONEY = '#,##0.00;[Red]-#,##0.00';
const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const AGED_DAYS = 30;
// Thai names of known fee types (same wording as public/order-fees.js); Lazada names arrive already readable.
const FEE_LABELS = {
  commission_fee: 'ค่าคอมมิชชั่น', service_fee: 'ค่าบริการ', seller_transaction_fee: 'ค่าธุรกรรมการชำระเงิน',
  order_ams_commission_fee: 'ค่าคอมมิชชั่น AMS (Affiliate)', platform_infrastructure_fee: 'ค่าโครงสร้างพื้นฐานแพลตฟอร์ม', seller_order_processing_fee: 'ค่าดำเนินการคำสั่งซื้อ',
  ads_escrow_top_up_fee_or_technical_support_fee: 'หักเติมเงินโฆษณา/ค่าบริการทางเทคนิค', seller_shipping_cost: 'ค่าส่งส่วนที่ร้านออก',
  shopee_other_deduction: 'รายการหักอื่น (Shopee ไม่ได้แยกชื่อ)',
  shipping_saver_fee: 'ค่าโปรแกรมประหยัดค่าจัดส่ง', platform_commission_amount: 'ค่าคอมมิชชั่นแพลตฟอร์ม',
  transaction_fee_amount: 'ค่าธุรกรรม', affiliate_commission_amount: 'ค่าคอมมิชชั่น Affiliate', referral_fee_amount: 'ค่าธรรมเนียมการแนะนำ',
  sfp_service_fee_amount: 'ค่าบริการ SFP', voucher_xtra_service_fee_amount: 'ค่าบริการ Voucher Xtra', flash_sales_service_fee_amount: 'ค่าบริการ Flash Sale',
  live_specials_fee_amount: 'ค่าบริการ LIVE Specials', affiliate_ads_commission_amount: 'ค่าคอมมิชชั่นโฆษณา Affiliate',
  affiliate_partner_commission_amount: 'ค่าคอมมิชชั่น Affiliate Partner', bonus_cashback_service_fee_amount: 'ค่าบริการ Bonus Cashback',
  refund_administration_fee_amount: 'ค่าดำเนินการคืนเงิน', fbt_fulfillment_fee_amount: 'ค่าบริการคลัง FBT', signature_confirmation_fee_amount: 'ค่ายืนยันลายเซ็น',
  shipping_insurance_fee_amount: 'ค่าประกันการขนส่ง', other_fee_amount: 'ค่าธรรมเนียมอื่น (TikTok ไม่ได้แยกชื่อ)',
};
const feeLabel = type => FEE_LABELS[type] || type;
// Plain explanation per fee type for the "ค่าธรรมเนียมตามประเภท" sheet (types not listed get an empty cell).
const FEE_NOTES = {
  commission_fee: 'ส่วนแบ่งการขายที่แพลตฟอร์มหักทุกออเดอร์ คิดเป็น % ของยอดขาย ตามหมวดสินค้า/ประเภทร้าน',
  service_fee: 'ค่าโปรแกรมเสริมที่ร้านสมัคร เช่น โค้ดส่วนลด/ส่งฟรี/Coins Cashback คิดเป็น % ของยอดขาย',
  seller_transaction_fee: 'ค่าธรรมเนียมรับชำระเงิน (บัตร/โอน/ปลายทาง) คิดเป็น % ของยอดที่ลูกค้าจ่าย',
  seller_order_processing_fee: 'ค่าคงที่ต่อออเดอร์ (Shopee เก็บ 1 บาท/ออเดอร์)',
  ads_escrow_top_up_fee_or_technical_support_fee: 'Shopee หักจากรายได้ไปเติมเครดิตโฆษณาของร้าน (ถ้าตั้งเติมอัตโนมัติ) หรือค่าบริการทางเทคนิค',
  seller_shipping_cost: 'ค่าส่งจริงส่วนที่ Shopee ไม่ได้ช่วยและลูกค้าไม่ได้จ่าย ร้านจึงออกเอง (ติดลบ = ร้านได้คืน)',
  shopee_other_deduction: 'ส่วนต่างระหว่างยอดสินค้าของ Shopee กับเงินที่โอน ที่ Shopee ไม่ได้แยกชื่อมา ใส่ไว้ให้ยอดตรงกัน',
  order_ams_commission_fee: 'ค่าคอมมิชชั่นให้ Affiliate ที่ช่วยขาย (เฉพาะออเดอร์ที่มาจาก Affiliate)',
  platform_infrastructure_fee: 'ค่าโครงสร้างพื้นฐานของแพลตฟอร์ม',
  shipping_saver_fee: 'ค่าโปรแกรมประหยัดค่าจัดส่ง',
  'ไม่มีรายละเอียดประเภท': 'ส่วนที่แพลตฟอร์มไม่ได้แยกประเภทมา (ค่าธรรมเนียมรวม − ที่แยกได้)',
};
// Fee columns of the "ขายรายสินค้า" sheet. Types not listed here fall into "other".
const FEE_GROUPS = [
  { key: 'commission', field: 'feeCommission', header: 'ค่าคอมมิชชั่น', types: ['commission_fee', 'platform_commission_amount', 'Commission', 'Commission fee - correction for undercharge', 'Reversal Commission'],
    note: 'ค่าคอมมิชชั่นการขายที่แพลตฟอร์มหัก' },
  { key: 'service', field: 'feeService', header: 'ค่าบริการ', types: ['service_fee'],
    note: 'ค่าบริการโปรแกรมที่ร้านเข้าร่วม เช่น ส่งฟรี หรือโค้ดส่วนลด' },
  { key: 'transaction', field: 'feeTransaction', header: 'ค่าธุรกรรมการชำระเงิน', types: ['seller_transaction_fee', 'transaction_fee_amount', 'Payment Fee', 'Payment fee - correction for undercharge', 'Payment Fee Credit'],
    note: 'ค่าธรรมเนียมรับชำระเงินจากลูกค้า' },
  { key: 'other', field: 'feeOther', header: 'ค่าธรรมเนียมอื่น', types: [],
    note: 'ค่าธรรมเนียมอื่นที่ไม่ใช่ 3 คอลัมน์ข้างหน้า เช่น ค่า Affiliate ค่าแคมเปญ ดูรายการละเอียดในชีต ค่าธรรมเนียมตามประเภท' },
];
const FEE_GROUP_OF = Object.fromEntries(FEE_GROUPS.flatMap(g => g.types.map(t => [t, g.key])));

const bangkokToday = now => new Date(now + 7 * 3600000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// Why an order needs a person to look at it. Missing money data stays missing: it is never treated as 0.
function reviewReasons(o, today) {
  const reasons = [];
  const settled = o.fees !== null;
  if (o.status === 'cancelled' && settled && (o.fees !== 0 || o.net !== 0)) reasons.push('ยกเลิกแล้วแต่มีรายการเงิน');
  if (o.status === 'returned') reasons.push('คืนสินค้า: ตรวจยอดคืนเงินและเอกสารลดหนี้');
  if (o.status === 'completed' && !settled) reasons.push('สำเร็จแล้วแต่ไม่มีข้อมูลการเงิน');
  if (o.status === 'pending' && !settled && daysBetween(o.date, today) > AGED_DAYS) reasons.push(`กำลังดำเนินการเกิน ${AGED_DAYS} วัน`);
  if (settled && o.net < 0) reasons.push('เงินสุทธิติดลบ');
  if (!o.shop) reasons.push('ไม่ระบุร้าน');
  return reasons;
}

export function accountingData(store, { platform = 'all', shop = 'all', start, end, now = Date.now() }) {
  const shopId = shop === 'all' ? null : Number(shop);
  const where = "o.order_date BETWEEN ? AND ? AND (? = 'all' OR o.platform = ?) AND (? IS NULL OR o.shop_id = ?)";
  const params = [start, end, platform, platform, shopId, shopId];
  const today = bangkokToday(now);
  const orders = store.all(`SELECT o.order_date AS date,o.platform,sh.name AS shop,o.order_id AS orderId,o.status,o.status_raw AS statusRaw,o.sales,o.refund,s.fees,s.net
    FROM marketplace_orders o
    LEFT JOIN marketplace_shops sh ON sh.id=o.shop_id
    LEFT JOIN (SELECT platform,order_id,SUM(fees) AS fees,SUM(net_payout) AS net FROM marketplace_settlements GROUP BY platform,order_id) s
      ON s.platform=o.platform AND s.order_id=o.order_id
    WHERE ${where} ORDER BY o.order_date,o.platform,o.order_id`, ...params);

  const summary = new Map();
  for (const o of orders) {
    const row = summary.get(o.platform) || { platform: o.platform, sales: 0, orders: 0, cancelled: 0, returned: 0, returnedSales: 0, refund: 0, fees: null, net: null, settled: 0, unsettledSold: 0, unsettledSales: 0 };
    summary.set(o.platform, row);
    const sold = o.status === 'completed' || o.status === 'pending';
    if (sold) { row.sales += o.sales; row.orders += 1; }
    if (o.status === 'cancelled') row.cancelled += 1;
    if (o.status === 'returned') { row.returned += 1; row.returnedSales += o.sales; row.refund += o.refund; }
    if (o.fees !== null) { row.fees = (row.fees || 0) + o.fees; row.net = (row.net || 0) + o.net; row.settled += 1; }
    else if (sold) { row.unsettledSold += 1; row.unsettledSales += o.sales; }
  }

  // Fee types come from fee_detail. Whatever the breakdown does not explain gets its own row, so each platform ties to its total.
  const feeRows = store.all(`SELECT s.platform,s.order_id AS orderId,s.fees,s.fee_detail AS detail FROM marketplace_settlements s
    JOIN marketplace_orders o ON o.platform=s.platform AND o.order_id=s.order_id WHERE ${where}`, ...params);
  const feeTypes = new Map(), UNEXPLAINED = 'ไม่มีรายละเอียดประเภท';
  const addFee = (p, type, amount) => { const key = p + '\u0000' + type; feeTypes.set(key, (feeTypes.get(key) || 0) + amount); };
  for (const r of feeRows) {
    let explained = 0;
    try {
      for (const [type, amount] of Object.entries(JSON.parse(r.detail || '{}'))) { addFee(r.platform, type, Number(amount)); explained += Number(amount); }
    } catch { /* a bad breakdown falls into the unexplained row */ }
    if (Math.abs(r.fees - explained) >= 0.005) addFee(r.platform, UNEXPLAINED, r.fees - explained);
  }
  const fees = [...feeTypes].map(([key, amount]) => { const [p, type] = key.split('\u0000'); return { platform: p, type, amount: round2(amount) }; })
    .filter(f => f.amount !== 0).sort((a, b) => a.platform.localeCompare(b.platform) || b.amount - a.amount);

  // Sales by product, plus each order's fees shared out to its sold lines by their share of the order's item sales
  // (fees are charged per order, not per product). Lines of an order with no money data add to unsettledSales and
  // leave the fee cells empty: missing is never 0.
  const orderFees = new Map();
  for (const r of feeRows) {
    const key = r.platform + '\u0000' + r.orderId, f = orderFees.get(key) || { total: 0, types: {} };
    orderFees.set(key, f);
    f.total += r.fees;
    let explained = 0;
    try {
      for (const [type, amount] of Object.entries(JSON.parse(r.detail || '{}'))) { f.types[type] = (f.types[type] || 0) + Number(amount); explained += Number(amount); }
    } catch { /* falls into the unexplained column */ }
    if (Math.abs(r.fees - explained) >= 0.005) f.types[UNEXPLAINED] = (f.types[UNEXPLAINED] || 0) + r.fees - explained;
  }
  // Each order's fee breakdown, for one column per fee type in the order register.
  for (const o of orders) { const f = orderFees.get(o.platform + '\u0000' + o.orderId); o.feeTypes = f ? f.types : null; }
  const lines = store.all(`SELECT i.platform,i.order_id AS orderId,UPPER(TRIM(i.sku)) AS sku,i.product_name AS name,i.quantity,i.sales
    FROM marketplace_order_items i JOIN marketplace_orders o ON o.platform=i.platform AND o.order_id=i.order_id
    WHERE ${where} AND o.status IN ${SOLD} AND i.status IN ${SOLD}`, ...params);
  const orderLines = new Map();
  for (const l of lines) { const key = l.platform + '\u0000' + l.orderId, o = orderLines.get(key) || { sales: 0, count: 0 }; orderLines.set(key, o); o.sales += l.sales; o.count += 1; }
  const productMap = new Map();
  for (const l of lines) {
    const key = l.platform + '\u0000' + (l.sku || l.name);
    const p = productMap.get(key) || { platform: l.platform, sku: l.sku, name: l.name, quantity: 0, sales: 0, fees: null, feeTypes: {}, unsettledSales: 0 };
    productMap.set(key, p);
    if (l.name > p.name) p.name = l.name;
    p.quantity += l.quantity; p.sales += l.sales;
    const orderKey = l.platform + '\u0000' + l.orderId, f = orderFees.get(orderKey), o = orderLines.get(orderKey);
    if (!f) { p.unsettledSales += l.sales; continue; }
    const share = o.sales > 0 ? l.sales / o.sales : 1 / o.count;
    p.fees = (p.fees || 0) + f.total * share;
    for (const [type, amount] of Object.entries(f.types)) p.feeTypes[type] = (p.feeTypes[type] || 0) + amount * share;
  }
  const products = [...productMap.values()].map(p => {
    const settledSales = p.sales - p.unsettledSales;
    return { ...p, sales: round2(p.sales), fees: p.fees === null ? null : round2(p.fees), unsettledSales: round2(p.unsettledSales),
      feePct: p.fees === null || settledSales <= 0 ? null : round2(p.fees / settledSales * 100),
      feeTypes: Object.fromEntries(Object.entries(p.feeTypes).map(([t, a]) => [t, round2(a)]).filter(([, a]) => a !== 0)) };
  }).sort((a, b) => a.platform.localeCompare(b.platform) || b.sales - a.sales);
  const soldWithoutItems = store.get(`SELECT COUNT(*) AS n FROM marketplace_orders o WHERE ${where} AND o.status IN ${SOLD} AND o.has_items=0`, ...params).n;

  const unsettled = orders.filter(o => (o.status === 'completed' || o.status === 'pending') && o.fees === null)
    .map(o => ({ ...o, age: daysBetween(o.date, today) }));
  const review = orders.flatMap(o => { const reasons = reviewReasons(o, today); return reasons.length ? [{ ...o, reasons: reasons.join(' · ') }] : []; });
  return { today, orders, summary: [...summary.values()], fees, products, soldWithoutItems, unsettled, review };
}

const TOTAL_FILL = 'FFE2F0D9'; // light green
function addTotalRow(sheet, labelKey, sumKeys, lastDataRow) {
  const row = sheet.getRow(lastDataRow + 2);
  const label = row.getCell(sheet.getColumn(labelKey).number);
  label.value = 'รวม (ตามตัวกรอง)';
  label.note = sheet.getRow(1).values.includes('สถานะ')
    ? 'ผลรวมเฉพาะแถวที่แสดงอยู่ ถ้ากรองคอลัมน์ สถานะ เช่น เลือกเฉพาะ สำเร็จ ยอดรวมจะเปลี่ยนตาม ถ้าไม่กรอง จะรวมทุกสถานะในชีตนี้'
    : 'ผลรวมเฉพาะแถวที่แสดงอยู่ ถ้ากรองข้อมูล (เช่น เลือกช่องทาง) ยอดรวมจะเปลี่ยนตาม';
  for (const key of sumKeys) {
    const col = sheet.getColumn(key), letter = col.letter;
    let result = 0;
    col.eachCell((cell, n) => { if (n > 1 && n <= lastDataRow && typeof cell.value === 'number') result += cell.value; });
    row.getCell(col.number).value = { formula: `SUBTOTAL(109,${letter}2:${letter}${lastDataRow})`, result: round2(result) };
  }
  row.font = { bold: true };
  const line = { style: 'thin', color: { argb: 'FF7F7F7F' } };
  row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }; cell.border = { top: line, bottom: line }; });
}
// Plain-language header comments for the accounting team, shared by every sheet (a column's own note wins).
const HEADER_NOTES = {
  'วันที่สั่งซื้อ': 'วันที่ลูกค้ากดสั่งซื้อ (ไม่ใช่วันส่งของหรือวันที่ได้รับเงิน)',
  'ช่องทาง': 'แพลตฟอร์มที่ขาย',
  'ร้าน': 'ชื่อร้านบนแพลตฟอร์ม',
  'เลขออเดอร์': 'เลขคำสั่งซื้อของแพลตฟอร์ม ใช้ค้นใน Seller Centre ได้',
  'สถานะ': 'สำเร็จ = ลูกค้ารับของแล้ว · กำลังดำเนินการ = ยังไม่รับของ · ยกเลิก · คืนสินค้า',
  'สถานะจากแพลตฟอร์ม': 'สถานะตามที่แพลตฟอร์มส่งมา (ภาษาของแพลตฟอร์ม)',
  'ยอดขาย': 'ราคาสินค้าหลังหักส่วนลดร้าน ไม่รวมค่าส่ง',
  'ยอดคืนเงิน': 'เงินที่คืนให้ลูกค้าเมื่อคืนสินค้า',
  'ค่าธรรมเนียม': 'ค่าธรรมเนียมที่แพลตฟอร์มหักจากออเดอร์นี้ ช่องว่าง = แพลตฟอร์มยังไม่แจ้ง (ไม่ใช่ 0)',
  'เงินสุทธิ': 'เงินที่แพลตฟอร์มโอนให้ร้านจริงสำหรับออเดอร์นี้ ช่องว่าง = แพลตฟอร์มยังไม่แจ้ง (ไม่ใช่ 0)',
  'อายุ (วัน)': 'จำนวนวันนับจากวันสั่งซื้อถึงวันออกรายงาน',
  'เหตุผล': 'สิ่งที่ควรตรวจกับแพลตฟอร์มหรือเอกสาร',
  'ประเภทค่าธรรมเนียม': 'ชื่อประเภทค่าธรรมเนียมตามที่แพลตฟอร์มแจ้ง',
  'จำนวนเงิน': 'ค่าธรรมเนียมประเภทนี้รวมทุกออเดอร์ในช่วงรายงาน (ติดลบ = แพลตฟอร์มคืนเงิน)',
  'ยอดขาย (สำเร็จ + กำลังดำเนินการ)': 'ยอดขายรวมของออเดอร์ที่ไม่ได้ยกเลิกหรือคืนสินค้า (ราคาหลังหักส่วนลดร้าน ไม่รวมค่าส่ง)',
  'จำนวนออเดอร์': 'จำนวนออเดอร์ที่ไม่ได้ยกเลิกหรือคืนสินค้า',
  'ยกเลิก (ออเดอร์)': 'จำนวนออเดอร์ที่ยกเลิก',
  'คืนสินค้า (ออเดอร์)': 'จำนวนออเดอร์ที่ลูกค้าคืนสินค้า',
  'ยอดขายของออเดอร์คืนสินค้า': 'ยอดขายเดิมของออเดอร์ที่ถูกคืน (ไม่รวมอยู่ในยอดขาย)',
  'ค่าธรรมเนียม (ทุกสถานะ)': 'ค่าธรรมเนียมทั้งหมดที่แพลตฟอร์มหัก รวมออเดอร์ยกเลิก/คืนสินค้าที่ยังถูกหัก',
  'เงินสุทธิจากแพลตฟอร์ม (ทุกสถานะ)': 'เงินที่แพลตฟอร์มโอนให้ร้านจริง รวมทุกสถานะ',
  'ออเดอร์ที่มีข้อมูลการเงิน': 'จำนวนออเดอร์ที่แพลตฟอร์มแจ้งค่าธรรมเนียมแล้ว',
  'ออเดอร์ขายที่ไม่มีข้อมูลการเงิน': 'จำนวนออเดอร์ที่ยังไม่สำเร็จ แพลตฟอร์มจึงยังไม่แจ้งค่าธรรมเนียม',
  'ยอดขายที่ไม่มีข้อมูลการเงิน': 'ยอดขายของออเดอร์ที่ยังไม่สำเร็จ ยังไม่รู้ค่าธรรมเนียม',
};
function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 16, style: c.money ? { numFmt: MONEY } : c.style ? { numFmt: c.style } : {} }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  columns.forEach((c, i) => { const note = c.note ?? HEADER_NOTES[c.header]; if (note) sheet.getRow(1).getCell(i + 1).note = note; }); // header comment: what the column is
  for (const row of rows) sheet.addRow(row);
  // Light-green fill for total columns (header + data rows).
  columns.forEach((c, i) => {
    if (!c.fill) return;
    // A fill hides Excel's gridlines, so draw thin lines in the gridline colour.
    const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fill } };
    const line = { style: 'thin', color: { argb: 'FFD4D4D4' } };
    const border = { top: line, left: line, bottom: line, right: line };
    for (let r = 1; r <= sheet.rowCount; r++) { const cell = sheet.getRow(r).getCell(i + 1); cell.fill = fill; cell.border = border; }
  });
  return sheet;
}

const orderColumns = [
  { header: 'วันที่สั่งซื้อ', key: 'date', width: 13 }, { header: 'ช่องทาง', key: 'platformName', width: 13 }, { header: 'ร้าน', key: 'shop', width: 20 },
  { header: 'เลขออเดอร์', key: 'orderId', width: 24 }, { header: 'สถานะ', key: 'statusName', width: 15 },
];
const withNames = o => ({ ...o, platformName: PLATFORM[o.platform] || o.platform, statusName: STATUS[o.status] || o.status });

export async function buildAccountingWorkbook(store, filter, meta = {}) {
  const data = accountingData(store, filter);
  const workbook = new ExcelJS.Workbook();
  const shopName = filter.shop === 'all' ? 'ทุกร้าน' : store.get('SELECT name FROM marketplace_shops WHERE id=?', Number(filter.shop))?.name || 'ไม่พบร้าน';

  const totals = data.summary.reduce((t, r) => {
    for (const k of ['sales', 'orders', 'cancelled', 'returned', 'returnedSales', 'refund', 'settled', 'unsettledSold', 'unsettledSales']) t[k] = (t[k] || 0) + r[k];
    if (r.fees !== null) { t.fees = (t.fees || 0) + r.fees; t.net = (t.net || 0) + r.net; }
    return t;
  }, { fees: null, net: null });
  const summaryRows = data.summary.map(r => ({ ...r, name: PLATFORM[r.platform] }));
  if (summaryRows.length) summaryRows.push({ ...totals, name: 'รวม' });
  const summary = addSheet(workbook, 'สรุป', [
    { header: 'ช่องทาง', key: 'name', width: 14 }, { header: 'ยอดขาย (สำเร็จ + กำลังดำเนินการ)', key: 'sales', width: 22, money: true }, { header: 'จำนวนออเดอร์', key: 'orders', width: 12 },
    { header: 'ยกเลิก (ออเดอร์)', key: 'cancelled', width: 12 }, { header: 'คืนสินค้า (ออเดอร์)', key: 'returned', width: 12 }, { header: 'ยอดขายของออเดอร์คืนสินค้า', key: 'returnedSales', width: 18, money: true }, { header: 'ยอดคืนเงิน', key: 'refund', width: 14, money: true },
    { header: 'ค่าธรรมเนียม (ทุกสถานะ)', key: 'fees', width: 16, money: true }, { header: 'เงินสุทธิจากแพลตฟอร์ม (ทุกสถานะ)', key: 'net', width: 20, money: true }, { header: 'ออเดอร์ที่มีข้อมูลการเงิน', key: 'settled', width: 14 },
    { header: 'ออเดอร์ขายที่ไม่มีข้อมูลการเงิน', key: 'unsettledSold', width: 16 }, { header: 'ยอดขายที่ไม่มีข้อมูลการเงิน', key: 'unsettledSales', width: 18, money: true },
  ], summaryRows);
  if (summaryRows.length) summary.getRow(summary.rowCount).font = { bold: true };

  // One row per order stays (totals tie to the summary); an order with several products lists them in one cell.
  const itemsOf = new Map();
  for (const i of store.all(`SELECT i.platform,i.order_id AS orderId,TRIM(i.sku) AS sku,i.product_name AS name,i.quantity
    FROM marketplace_order_items i JOIN marketplace_orders o ON o.platform=i.platform AND o.order_id=i.order_id
    WHERE ${"o.order_date BETWEEN ? AND ? AND (? = 'all' OR o.platform = ?) AND (? IS NULL OR o.shop_id = ?)"} ORDER BY i.line_key`,
  filter.start, filter.end, filter.platform, filter.platform, filter.shop === 'all' ? null : Number(filter.shop), filter.shop === 'all' ? null : Number(filter.shop))) {
    // Lines of the same SKU in one order (Lazada sends one line per piece) are shown once with their quantities added.
    const key = i.platform + '\u0000' + i.orderId, list = itemsOf.get(key) || [];
    itemsOf.set(key, list);
    const same = list.find(x => (i.sku ? x.sku === i.sku : !x.sku && x.name === i.name));
    if (same) same.quantity += i.quantity; else list.push({ ...i });
  }
  const withItems = o => {
    const list = itemsOf.get(o.platform + '\u0000' + o.orderId) || [];
    return { ...withNames(o), skus: list.map(i => i.sku || '-').join('\n') || null,
      productNames: list.map(i => (list.length > 1 || i.quantity !== 1 ? `${i.name} × ${i.quantity}` : i.name)).join('\n') || null };
  };
  // One column per fee type (by Thai name, largest total first), placed before the order's total fee. Empty = not charged / no data.
  const typeTotals = new Map();
  for (const o of data.orders) for (const [t, a] of Object.entries(o.feeTypes || {})) typeTotals.set(feeLabel(t), (typeTotals.get(feeLabel(t)) || 0) + a);
  const feeTypeCols = [...typeTotals].filter(([, a]) => Math.abs(a) >= 0.005).sort((a, b) => b[1] - a[1])
    .map(([label], i) => ({ header: label, key: `feeType${i}`, width: Math.max(14, label.length + 2), money: true, note: FEE_NOTES[Object.keys(FEE_LABELS).find(k => FEE_LABELS[k] === label) || label] || undefined }));
  const colOfLabel = new Map(feeTypeCols.map(c => [c.header, c.key]));
  const withFeeTypes = o => {
    const out = withItems(o);
    for (const [t, a] of Object.entries(o.feeTypes || {})) { const k = colOfLabel.get(feeLabel(t)); if (k) out[k] = round2((out[k] || 0) + a); }
    return out;
  };
  const register = addSheet(workbook, 'ทะเบียนขายรายออเดอร์', [...orderColumns.slice(0, 4),
    { header: 'SKU', key: 'skus', width: 18, note: 'รหัสสินค้าในออเดอร์ ถ้ามีหลายสินค้าจะอยู่คนละบรรทัดในช่องเดียว ช่องว่าง = แพลตฟอร์มไม่ได้ส่งรายการสินค้ามา' },
    { header: 'ชื่อสินค้า', key: 'productNames', width: 48, note: 'ชื่อสินค้าในออเดอร์ (× จำนวนชิ้น) ถ้ามีหลายสินค้าจะอยู่คนละบรรทัดในช่องเดียว ยอดขายของแถวเป็นยอดรวมทั้งออเดอร์' },
    orderColumns[4],
    { header: 'สถานะจากแพลตฟอร์ม', key: 'statusRaw', width: 20 }, { header: 'ยอดขาย', key: 'sales', money: true }, { header: 'ยอดคืนเงิน', key: 'refund', money: true },
    ...feeTypeCols,
    { header: 'ค่าธรรมเนียมรวม', key: 'fees', money: true, note: 'ผลรวมค่าธรรมเนียมทุกประเภททางซ้าย' }, { header: 'เงินสุทธิ', key: 'net', money: true },
  ], data.orders.map(withFeeTypes));
  // Every cell top-aligned so each order reads on its first line; SKU line N matches product line N, so the name column
  // is made wide enough that a name never wraps onto a second line.
  const longest = Math.max(20, ...register.getColumn('productNames').values.slice(2).flatMap(v => String(v ?? '').split('\n').map(s => s.length)));
  register.getColumn('productNames').width = Math.min(longest * 1.05 + 2, 110);
  register.eachRow((row, n) => { if (n > 1) row.eachCell({ includeEmpty: true }, cell => { cell.alignment = { ...cell.alignment, vertical: 'top' }; }); });
  for (const key of ['skus', 'productNames']) register.getColumn(key).eachCell((cell, n) => { if (n > 1) cell.alignment = { wrapText: true, vertical: 'top' }; });
  // Total row under a blank row (so Excel's filter and sort leave it alone). SUBTOTAL(109) adds only the rows the
  // filter shows, e.g. filter สถานะ = สำเร็จ to get the completed total.
  if (data.orders.length) addTotalRow(register, 'statusRaw', ['sales', 'refund', ...feeTypeCols.map(c => c.key), 'fees', 'net'], data.orders.length + 1);
  const unsettledSheet = addSheet(workbook, 'ไม่มีข้อมูลการเงิน', [...orderColumns, { header: 'ยอดขาย', key: 'sales', money: true }, { header: 'อายุ (วัน)', key: 'age', width: 10 }], data.unsettled.map(withNames));
  if (data.unsettled.length) addTotalRow(unsettledSheet, 'statusName', ['sales'], data.unsettled.length + 1);
  const feeSheet = addSheet(workbook, 'ค่าธรรมเนียมตามประเภท', [{ header: 'ช่องทาง', key: 'name', width: 14 }, { header: 'ประเภทค่าธรรมเนียม', key: 'type', width: 36 }, { header: 'จำนวนเงิน', key: 'amount', money: true }, { header: 'คำอธิบาย', key: 'note', width: 70 }],
    data.fees.map(f => ({ ...f, type: feeLabel(f.type), note: FEE_NOTES[f.type] || null, name: PLATFORM[f.platform] })));
  if (data.fees.length) addTotalRow(feeSheet, 'type', ['amount'], data.fees.length + 1);
  const SHARED = 'แพลตฟอร์มหักเป็นรายออเดอร์ ถ้าออเดอร์มีหลายสินค้า จะแบ่งให้แต่ละสินค้าตามสัดส่วนยอดขาย';
  // Fee types folded into the three groups shown in the order popup; anything else goes to "other" (shown only if present).
  const productRows = data.products.map(p => {
    const sums = {};
    for (const [type, amount] of Object.entries(p.feeTypes)) { const g = FEE_GROUP_OF[type] || 'other'; sums[g] = (sums[g] || 0) + amount; }
    return { ...p, productName: p.name, name: PLATFORM[p.platform], unsettledSales: p.unsettledSales || null, settledSales: round2(p.sales - p.unsettledSales) || null,
      ...Object.fromEntries(FEE_GROUPS.map(g => [g.field, sums[g.key] === undefined ? null : round2(sums[g.key])])) };
  });
  const productSheet = addSheet(workbook, 'ขายรายสินค้า', [
    { header: 'ช่องทาง', key: 'name', width: 14, note: 'แพลตฟอร์มที่ขาย' },
    { header: 'SKU', key: 'sku', width: 22, note: 'รหัสสินค้าที่ร้านตั้งไว้บนแพลตฟอร์ม' },
    { header: 'ชื่อสินค้า', key: 'productName', width: 48, note: 'ชื่อสินค้าตามที่ลงขายบนแพลตฟอร์ม (อาจไม่ตรงกับชื่อใน SML)' },
    { header: 'จำนวน', key: 'quantity', width: 10, note: 'จำนวนชิ้นที่ขาย ไม่รวมออเดอร์ที่ยกเลิกหรือคืนสินค้า' },
    { header: 'ยอดขายที่สำเร็จแล้ว', key: 'settledSales', width: 22, money: true, note: 'ลูกค้ารับของแล้ว และแพลตฟอร์มแจ้งค่าธรรมเนียมแล้ว ค่าธรรมเนียมในแถวนี้คิดจากยอดนี้' },
    { header: 'ยอดขายที่ยังไม่สำเร็จ', key: 'unsettledSales', width: 22, money: true, note: 'ลูกค้ายังไม่รับของ จึงยังไม่รู้ค่าธรรมเนียม เมื่อสำเร็จ ยอดจะย้ายไปช่อง ยอดขายที่สำเร็จแล้ว เอง' },
    { header: 'ยอดขายรวม', key: 'sales', width: 16, money: true, fill: TOTAL_FILL, note: 'ยอดขายที่สำเร็จแล้ว + ยอดขายที่ยังไม่สำเร็จ (ราคาหลังหักส่วนลดร้าน ไม่รวมค่าส่ง)' },
    ...FEE_GROUPS.filter(g => g.key !== 'other' || productRows.some(p => p.feeOther !== null)).map(g => ({ header: g.header, key: g.field, width: 22, money: true,
      note: `${g.note} (${SHARED})` })),
    { header: 'ค่าธรรมเนียมรวม', key: 'fees', width: 18, money: true, fill: TOTAL_FILL, note: 'ค่าธรรมเนียมทุกคอลัมน์ทางซ้ายรวมกัน คิดเฉพาะยอดขายที่สำเร็จแล้ว ช่องว่าง = ยังไม่มีออเดอร์สำเร็จ' },
  ], productRows);
  if (productRows.length) addTotalRow(productSheet, 'productName', productSheet.columns.slice(3).map(c => c.key), productRows.length + 1);
  const reviewSheet = addSheet(workbook, 'รายการที่ต้องตรวจ', [...orderColumns, { header: 'ยอดขาย', key: 'sales', money: true }, { header: 'ยอดคืนเงิน', key: 'refund', money: true }, { header: 'ค่าธรรมเนียม', key: 'fees', money: true }, { header: 'เงินสุทธิ', key: 'net', money: true }, { header: 'เหตุผล', key: 'reasons', width: 48 }],
    data.review.map(withNames));
  if (data.review.length) addTotalRow(reviewSheet, 'statusName', ['sales', 'refund', 'fees', 'net'], data.review.length + 1);

  const notes = workbook.addWorksheet('หมายเหตุ');
  notes.columns = [{ width: 28 }, { width: 100 }];
  notes.addRows([
    ['ช่วงวันที่สั่งซื้อ', `${filter.start} ถึง ${filter.end}`],
    ['ช่องทาง', filter.platform === 'all' ? 'ทุกช่องทาง' : PLATFORM[filter.platform]],
    ['ร้าน', shopName],
    ['ออกรายงานเมื่อ', new Date(filter.now ?? Date.now()).toISOString()],
    ['ออกโดย', meta.by || ''],
    [],
    ['ยอดขาย', 'ราคาสินค้าหลังหักส่วนลดจากร้าน ไม่รวมค่าส่ง และไม่หักส่วนลดจากแพลตฟอร์ม นับเฉพาะสำเร็จ + กำลังดำเนินการ'],
    ['วันที่', 'วันที่สร้างคำสั่งซื้อ ไม่ใช่วันจัดส่งหรือวันรับเงิน ต้องกำหนดเกณฑ์รับรู้รายได้ตามนโยบายบัญชีของบริษัท'],
    ['ค่าธรรมเนียม / เงินสุทธิ', 'รวมทุกรายการเงินของออเดอร์ในช่วงนี้ ไม่ว่าเงินจะโอนเมื่อใด ช่องว่าง = ไม่มีข้อมูล ไม่ใช่ 0'],
    ['ยอดที่ไม่มีข้อมูลการเงิน', 'ยังไม่มีข้อมูลการเงินในระบบ อาจยังไม่โอนหรือยังไม่ได้นำเข้า จึงไม่ควรใช้เป็นยอดลูกหนี้โดยไม่ตรวจกับแพลตฟอร์ม'],
    ['ขายรายสินค้า', data.soldWithoutItems ? `ไม่รวม ${data.soldWithoutItems} ออเดอร์ที่ไม่มีรายการสินค้า ยอดรวมของชีตนี้จึงอาจต่ำกว่ายอดขายในชีตสรุป` : 'ออเดอร์ขายในช่วงนี้มีรายการสินค้าครบ'],
    ['ขายรายสินค้า: ค่าธรรมเนียม', 'แพลตฟอร์มหักค่าธรรมเนียมเป็นรายออเดอร์ ชีตนี้จึงปันส่วนให้สินค้าตามสัดส่วนยอดขายในออเดอร์ (เป็นค่าประมาณต่อสินค้า) นับเฉพาะออเดอร์สำเร็จ + กำลังดำเนินการ ยอดรวมจึงอาจต่ำกว่าค่าธรรมเนียมในชีตสรุปซึ่งนับทุกสถานะ วางเมาส์ที่หัวคอลัมน์เพื่อดูคำอธิบาย'],
    ['ขายรายสินค้า: ค่าขนส่ง', 'ข้อมูลที่ระบบเก็บไม่มีค่าขนส่งจริงของแต่ละออเดอร์ มีเฉพาะค่าธรรมเนียมที่แพลตฟอร์มหัก ค่าที่เกี่ยวกับการจัดส่ง (เช่น โปรแกรมส่งฟรี) รวมอยู่ในค่าธรรมเนียมแล้ว ดูยอดแยกได้ในชีต ค่าธรรมเนียมตามประเภท'],
    ['ไม่มีในรายงานนี้', 'ภาษีขาย/ภาษีซื้อ, ภาษีหัก ณ ที่จ่าย, ค่าส่งที่ผู้ซื้อจ่าย, ส่วนลดจากแพลตฟอร์ม, ต้นทุนสินค้า และวันที่/รอบที่เงินโอนเข้าบัญชี'],
    ['สถานะเอกสาร', 'เป็นเอกสารประกอบการทำงาน ไม่ใช่รายงานภาษีขายหรือใบกำกับภาษี'],
  ]);
  notes.getColumn(1).font = { bold: true };
  notes.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  // Tab order shown in Excel (sheets are built in a different order because some depend on others).
  const TAB_ORDER = ['ทะเบียนขายรายออเดอร์', 'ขายรายสินค้า', 'ค่าธรรมเนียมตามประเภท', 'รายการที่ต้องตรวจ', 'ไม่มีข้อมูลการเงิน', 'สรุป', 'หมายเหตุ'];
  for (const sheet of workbook.worksheets) { const i = TAB_ORDER.indexOf(sheet.name); sheet.orderNo = i < 0 ? TAB_ORDER.length : i; }
  workbook.views = [{ activeTab: 0, firstSheet: 0 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
