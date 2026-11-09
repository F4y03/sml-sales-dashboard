// Accounting workbook for online sales: order register, platform money, fee types, items to review. No HTTP here.
// Uses the definitions in MARKETPLACE.md. It holds no buyer data and is working paper, not a tax document.
import ExcelJS from 'exceljs';

const SOLD = "('completed','pending')";
const STATUS = { completed: 'สำเร็จ', pending: 'กำลังดำเนินการ', cancelled: 'ยกเลิก', returned: 'คืนสินค้า' };
const PLATFORM = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };
const MONEY = '#,##0.00;[Red]-#,##0.00';
const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const AGED_DAYS = 30;

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
  const feeRows = store.all(`SELECT s.platform,s.fees,s.fee_detail AS detail FROM marketplace_settlements s
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

  const products = store.all(`SELECT i.platform,COALESCE(NULLIF(UPPER(TRIM(i.sku)),''),'') AS sku,MAX(i.product_name) AS name,SUM(i.quantity) AS quantity,SUM(i.sales) AS sales
    FROM marketplace_order_items i JOIN marketplace_orders o ON o.platform=i.platform AND o.order_id=i.order_id
    WHERE ${where} AND o.status IN ${SOLD} AND i.status IN ${SOLD}
    GROUP BY i.platform,CASE WHEN TRIM(i.sku)='' THEN i.product_name ELSE UPPER(TRIM(i.sku)) END ORDER BY i.platform,sales DESC`, ...params);
  const soldWithoutItems = store.get(`SELECT COUNT(*) AS n FROM marketplace_orders o WHERE ${where} AND o.status IN ${SOLD} AND o.has_items=0`, ...params).n;

  const unsettled = orders.filter(o => (o.status === 'completed' || o.status === 'pending') && o.fees === null)
    .map(o => ({ ...o, age: daysBetween(o.date, today) }));
  const review = orders.flatMap(o => { const reasons = reviewReasons(o, today); return reasons.length ? [{ ...o, reasons: reasons.join(' · ') }] : []; });
  return { today, orders, summary: [...summary.values()], fees, products, soldWithoutItems, unsettled, review };
}

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 16, style: c.money ? { numFmt: MONEY } : {} }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  for (const row of rows) sheet.addRow(row);
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

  addSheet(workbook, 'ทะเบียนขายรายออเดอร์', [...orderColumns,
    { header: 'สถานะจากแพลตฟอร์ม', key: 'statusRaw', width: 20 }, { header: 'ยอดขาย', key: 'sales', money: true }, { header: 'ยอดคืนเงิน', key: 'refund', money: true },
    { header: 'ค่าธรรมเนียม', key: 'fees', money: true }, { header: 'เงินสุทธิ', key: 'net', money: true },
  ], data.orders.map(withNames));
  addSheet(workbook, 'ไม่มีข้อมูลการเงิน', [...orderColumns, { header: 'ยอดขาย', key: 'sales', money: true }, { header: 'อายุ (วัน)', key: 'age', width: 10 }], data.unsettled.map(withNames));
  addSheet(workbook, 'ค่าธรรมเนียมตามประเภท', [{ header: 'ช่องทาง', key: 'name', width: 14 }, { header: 'ประเภทค่าธรรมเนียม', key: 'type', width: 36 }, { header: 'จำนวนเงิน', key: 'amount', money: true }],
    data.fees.map(f => ({ ...f, name: PLATFORM[f.platform] })));
  addSheet(workbook, 'ขายรายสินค้า', [{ header: 'ช่องทาง', key: 'name', width: 14 }, { header: 'SKU', key: 'sku', width: 22 }, { header: 'ชื่อสินค้า', key: 'productName', width: 48 }, { header: 'จำนวน', key: 'quantity', width: 10 }, { header: 'ยอดขาย', key: 'sales', money: true }],
    data.products.map(p => ({ ...p, productName: p.name, name: PLATFORM[p.platform] })));
  addSheet(workbook, 'รายการที่ต้องตรวจ', [...orderColumns, { header: 'ยอดขาย', key: 'sales', money: true }, { header: 'ยอดคืนเงิน', key: 'refund', money: true }, { header: 'ค่าธรรมเนียม', key: 'fees', money: true }, { header: 'เงินสุทธิ', key: 'net', money: true }, { header: 'เหตุผล', key: 'reasons', width: 48 }],
    data.review.map(withNames));

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
    ['ไม่มีในรายงานนี้', 'ภาษีขาย/ภาษีซื้อ, ภาษีหัก ณ ที่จ่าย, ค่าส่งที่ผู้ซื้อจ่าย, ส่วนลดจากแพลตฟอร์ม, ต้นทุนสินค้า และวันที่/รอบที่เงินโอนเข้าบัญชี'],
    ['สถานะเอกสาร', 'เป็นเอกสารประกอบการทำงาน ไม่ใช่รายงานภาษีขายหรือใบกำกับภาษี'],
  ]);
  notes.getColumn(1).font = { bold: true };
  notes.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
