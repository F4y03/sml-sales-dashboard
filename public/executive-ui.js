const element = id => document.getElementById(id);
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const money = value => value == null ? 'ข้อมูลไม่ครบ' : '฿' + number.format(value);
const percent = value => value == null ? 'ไม่มีฐานเทียบ' : `${value > 0 ? '↑ +' : value < 0 ? '↓ ' : ''}${number.format(value)}%`;
const margin = (profit, revenue) => profit != null && revenue > 0 ? profit / revenue * 100 : null;
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
let current = null, activeTeam = 'staff', controller, requestId = 0;
const today = new Date();
element('end').value = iso(today);
element('start').value = iso(new Date(today.getFullYear(), today.getMonth(), 1));
const targetKey = () => `executive-target:${element('start').value}:${element('end').value}`;
function restoreTarget() {
  try { element('target').value = localStorage.getItem(targetKey()) || ''; } catch { element('target').value = ''; }
  formatTarget();
}
function formatTarget() {
  const input = element('target');
  const position = input.selectionStart ?? input.value.length;
  const offset = input.value.slice(0, position).replaceAll(',', '').length;
  const raw = input.value.replaceAll(',', '');
  const valid = /^\d+(\.\d{0,2})?$/.test(raw);
  input.setCustomValidity(raw && (!valid || !Number.isFinite(Number(raw)) || Number(raw) <= 0) ? 'กรอกเป้ามากกว่า 0 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง' : '');
  if (!valid) return;
  const [whole, fraction] = raw.split('.');
  input.value = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
  let cursor = 0, consumed = 0;
  while (cursor < input.value.length && consumed < offset) {
    if (input.value[cursor] !== ',') consumed++;
    cursor++;
  }
  if (document.activeElement === input) input.setSelectionRange(cursor, cursor);
}
function node(tag, text, className = '') {
  const result = document.createElement(tag);
  result.textContent = text; result.className = className; return result;
}
function targetValue() {
  const value = Number(element('target').value.replaceAll(',', ''));
  return Number.isFinite(value) && value > 0 && element('target').validity.valid ? value : null;
}
function renderTarget() {
  if (!current) return;
  const target = targetValue();
  element('achievement').textContent = target ? number.format(current.net / target * 100) + '%' : 'ยังไม่ตั้งเป้า';
  element('progress').value = target ? Math.max(0, Math.min(100, current.net / target * 100)) : 0;
  element('remaining').textContent = target ? (current.net >= target ? 'เกินเป้า ' + money(current.net - target) : 'เหลืออีก ' + money(target - current.net)) : 'กรอกเป้าของช่วงวันที่ด้านบน';
}
function renderTeam() {
  element('branches-tab').setAttribute('aria-pressed', String(activeTeam === 'branches'));
  element('staff-tab').setAttribute('aria-pressed', String(activeTeam === 'staff'));
  const container = element('leaders'); container.replaceChildren();
  current[activeTeam].forEach((item, index) => {
    const row = node('div', '', 'leader');
    row.append(node('span', index + 1, 'rank'), node('span', item.name), node('strong', money(item.sales))); container.append(row);
  });
  if (!current[activeTeam].length) container.append(node('p', 'ไม่พบรายการในช่วงวันที่เลือก', 'note'));
}
function render() {
  element('net').textContent = money(current.net);
  element('net-note').textContent = `ขาย/เพิ่มหนี้ ${money(current.sales)} − คืน ${money(current.returns)}`;
  element('sales-invoice-count').textContent = current.salesInvoiceCount == null ? '—' : `${number.format(current.salesInvoiceCount)} บิล`;
  element('average-sale').textContent = current.averageSale == null ? 'ยังไม่มีบิลขายสำหรับคำนวณค่าเฉลี่ย' : `ยอดเฉลี่ย ${money(current.averageSale)} / บิล · ก่อนหักคืน`;
  element('mom').textContent = percent(current.mom);
  element('mom').className = current.mom == null || current.mom === 0 ? '' : current.mom > 0 ? 'positive' : 'negative';
  element('yoy').textContent = `MoM เทียบเดือนก่อน · YoY ${percent(current.yoy)}`;
  renderTarget();
  const body = element('products'); body.replaceChildren();
  current.products.forEach((product, index) => {
    const row = node('tr', ''), name = node('td', `${index + 1}. ${product.name || product.code}`);
    name.append(node('small', product.code));
    const rate = margin(product.profit, product.revenue);
    const profit = node('td', money(product.profit), rate != null && rate < 10 ? 'warning' : '');
    profit.append(node('small', rate == null ? 'ต้นทุน/ฐานรายได้ไม่ครบ' : `${number.format(rate)}%${rate < 10 ? ' · กำไรต่ำ' : ''}`));
    row.append(name, node('td', money(product.sales)), profit); body.append(row);
  });
  if (!current.products.length) {
    const row = node('tr', ''), cell = node('td', 'ไม่พบรายการสินค้าในช่วงวันที่เลือก');
    cell.colSpan = 3; row.append(cell); body.append(row);
  }
  renderTeam();
  const alerts = [];
  current.declines.forEach(branch => alerts.push({ category: 'ยอดขายลดลง', icon: '↘', title: branch.name, description: 'เทียบเดือนก่อน · ตรวจสอบทีมขายและลูกค้าหลัก', value: `−${number.format((1 - branch.sales / branch.previous) * 100)}%`, caption: 'ยอดรายการขาย', detail: 'growth' }));
  current.products.filter(product => product.stock != null && product.stock <= 5 && product.sales > 0).forEach(product => alerts.push({ category: 'สต๊อกใกล้หมด', icon: '▦', title: product.name || product.code, description: 'สินค้าขายดี · ตรวจสอบสต๊อกจริงก่อนเติมสินค้า', value: `${number.format(product.stock)} ${product.unit || 'หน่วยมาตรฐาน'}`, caption: 'คงเหลือในทะเบียน', yellow: true, product }));
  current.unusual.forEach(bill => {
    const mismatch = bill.difference > Math.max(100, Math.abs(bill.total) * .05);
    alerts.push({ category: mismatch ? 'ยอดเอกสารไม่ตรง' : 'บิลมูลค่าสูง', icon: mismatch ? '≠' : '↗', title: `เอกสาร ${bill.docNo}`, description: `${bill.date} · ${mismatch ? `ยอดเอกสาร ${money(bill.total)} · ` : ''}ตรวจ VAT/ส่วนลดและเอกสารต้นทาง`, value: money(mismatch ? bill.difference : bill.total), caption: mismatch ? 'ส่วนต่างที่ควรตรวจสอบ' : 'มูลค่าเอกสาร', bill });
  });
  element('alerts').replaceChildren();
  alerts.forEach(alert => {
    const row = node('article', '', `alert${alert.yellow ? ' yellow' : ''}`), action = node('button', 'ตรวจสอบ →', 'alert-action');
    const icon = node('span', alert.icon, 'alert-icon');
    icon.setAttribute('aria-hidden', 'true');
    const content = node('div', '', 'alert-content');
    content.append(node('span', alert.category, 'alert-category'), node('h3', alert.title), node('p', alert.description));
    const metric = node('div', '', 'alert-metric');
    metric.append(node('strong', alert.value), node('small', alert.caption));
    action.setAttribute('aria-label', `ตรวจสอบ ${alert.title}`);
    row.append(icon, content, metric);
    action.type = 'button';
    action.addEventListener('click', () => openDetail(alert.product ? 'stock' : alert.bill ? 'bill' : alert.detail, alert.bill, alert.product));
    row.append(action); element('alerts').append(row);
  });
  if (!alerts.length) element('alerts').append(node('p', 'ไม่พบการเตือนตามเกณฑ์ที่ตรวจได้ (ไม่รวมสต๊อก/ต้นทุนที่ไม่มีข้อมูล)', 'note'));
  element('alert-count').textContent = `${alerts.length} เรื่อง`;
  element('updated').textContent = `ช่วง ${current.start} – ${current.end} · ${number.format(current.count)} เอกสาร · อัปเดต ${new Date(current.updatedAt).toLocaleString('th-TH')}`;
}
function openDetail(kind, bill, product) {
  if (!current) return;
  element('detail-title').textContent = { net: 'เอกสารขายและรับคืน', activity: 'จำนวนบิลขายและยอดเฉลี่ยต่อบิล', growth: 'เปรียบเทียบช่วงเวลา', target: 'ความคืบหน้าเป้ายอดขาย', bill: 'ตรวจสอบเอกสาร', stock: 'ตรวจสอบสินค้าสต๊อกใกล้หมด' }[kind];
  const body = element('detail-body'); body.replaceChildren();
  body.append(node('p', `ช่วงวันที่ ${current.start} – ${current.end}`, 'detail-period'));
  const metrics = node('div', '', 'detail-metrics');
  function metric(label, value, caption = '', tone = '') {
    const card = node('div', '', 'detail-stat');
    card.append(node('span', label), node('strong', value, tone), node('small', caption));
    metrics.append(card);
  }
  let explanation = '', caution = '';
  if (kind === 'stock') {
    body.append(node('h3', product.name || product.code, 'detail-table-title'));
    metric('รหัสสินค้า', product.code, 'สินค้า Top 5 ตามยอดขายสุทธิ');
    metric('คงเหลือในทะเบียน', `${number.format(product.stock)} ${product.unit || 'หน่วยมาตรฐาน'}`, 'ยอดทะเบียนปัจจุบัน ไม่ใช่ยอดย้อนหลัง', 'warning');
    metric('ยอดรายการขายสุทธิ', money(product.sales), 'ตามช่วงวันที่ที่เลือก');
    explanation = 'สินค้านี้อยู่ใน 5 อันดับทำยอดสูงสุด มียอดขายสุทธิเป็นบวก และยอดคงเหลือในทะเบียนไม่เกิน 5 หน่วยมาตรฐาน จึงควรตรวจสอบความพร้อมของสินค้าก่อนรับออเดอร์เพิ่ม';
    caution = 'ข้อมูลคงเหลือจากทะเบียนสินค้า SML ไม่ใช่สต๊อกพร้อมขายสด ยังไม่หักยอดจองหรือแสดงสินค้าแยกคลัง ไม่สามารถสรุปจำนวนวันที่ขายได้หรือจำนวนที่ควรสั่งซื้อจากยอดนี้เพียงอย่างเดียว';
  }
  if (kind === 'net') {
    metric('ยอดขายสุทธิ', money(current.net), 'หลังหักรับคืน / ลดหนี้', 'positive');
    metric('ขายและเพิ่มหนี้', money(current.sales), 'ยอดรวมตามเอกสาร');
    metric('รับคืน / ลดหนี้', money(current.returns), 'ยอดที่หักออกจากการขาย');
    explanation = 'ยอดขายสุทธิ = ยอดขาย + เพิ่มหนี้ − รับคืน / ลดหนี้ ใช้ดูภาพรวมการขายตามช่วงวันที่เลือก';
    caution = 'ยอดตามเอกสาร ไม่ใช่เงินสดที่รับแล้ว และไม่ใช่กำไร ตัดเอกสารยกเลิกและสำเนา';
  }
  if (kind === 'activity') {
    metric('จำนวนบิลขาย', current.salesInvoiceCount == null ? '—' : number.format(current.salesInvoiceCount) + ' บิล', 'เฉพาะเอกสารขาย');
    metric('ยอดเฉลี่ยต่อบิล', current.averageSale == null ? 'ยังไม่มีบิลขาย' : money(current.averageSale), 'ก่อนหักรับคืน');
    explanation = 'ยอดเฉลี่ยต่อบิล = ยอดรวมเอกสารขาย ÷ จำนวนบิลขายทั้งหมด ช่วยดูว่าจะเพิ่มยอดด้วยจำนวนบิล หรือเพิ่มมูลค่าต่อบิล';
    caution = 'ไม่รวมเพิ่มหนี้ รับคืน เอกสารยกเลิก และสำเนา ค่าเฉลี่ยไม่ใช่ยอดขายสุทธิต่อบิล';
  }
  if (kind === 'growth') {
    metric('ยอดขายสุทธิปัจจุบัน', money(current.net), 'ช่วงวันที่เลือก');
    metric('เทียบเดือนก่อน · MoM', percent(current.mom), money(current.previousNet), current.mom == null ? '' : current.mom < 0 ? 'negative' : 'positive');
    metric('เทียบปีก่อน · YoY', percent(current.yoy), money(current.yearNet), current.yoy == null ? '' : current.yoy < 0 ? 'negative' : 'positive');
    explanation = 'การเติบโต = (ยอดปัจจุบัน − ยอดช่วงก่อน) ÷ ยอดช่วงก่อน × 100 ใช้ MoM ดูแนวโน้มระยะสั้น และ YoY ประกอบการดูฤดูกาล';
    caution = 'เลื่อนวันที่ย้อนหลังตามเดือนและปี จำกัดวันตามสิ้นเดือน จำนวนวันอาจต่างกัน ไม่คำนวณ % เมื่อยอดฐานเป็นศูนย์หรือติดลบ';
  }
  if (kind === 'target') {
    const target = targetValue();
    metric('เป้ายอดขาย', target ? money(target) : 'ยังไม่ตั้งเป้า', 'สำหรับช่วงวันที่เลือก');
    metric('ทำได้แล้ว', money(current.net), target ? number.format(current.net / target * 100) + '% ของเป้า' : 'กรอกเป้าในช่องด้านบน');
    metric(target && current.net >= target ? 'เกินเป้าแล้ว' : 'ยอดที่ต้องทำเพิ่ม', target ? money(Math.abs(target - current.net)) : '—', 'เทียบกับยอดขายสุทธิ');
    explanation = target ? 'ใช้ยอดที่ต้องทำเพิ่มกำหนดงานให้ทีมขาย ความคืบหน้าคำนวณจากยอดขายสุทธิ ÷ เป้า × 100' : 'ปิดหน้าต่างนี้แล้วกรอกเป้ามากกว่า 0 บาทในช่องด้านบน เพื่อดูความคืบหน้าและยอดที่ต้องทำเพิ่ม';
    caution = 'เป้าที่กรอกเอง เก็บเฉพาะเบราว์เซอร์นี้ แยกตามช่วงวันที่ ไม่ใช่เป้าที่ดึงจาก SML';
  }
  if (kind === 'bill') {
    metric('เลขที่เอกสาร', bill.docNo, bill.date);
    metric('ยอดเอกสาร', money(bill.total), 'มูลค่าตามหัวเอกสาร');
    metric('ยอดรายการ', bill.lineTotal == null ? 'ไม่มีรายการ' : money(bill.lineTotal), 'รวมรายการในเอกสาร');
    const mismatch = bill.difference > Math.max(100, Math.abs(bill.total) * .05);
    const highValue = bill.total > 100000 && current.averageSale != null && bill.total > current.averageSale * 3;
    const reasons = [];
    if (highValue || !mismatch) reasons.push(`บิลมูลค่า ${money(bill.total)} ถูกจัดเป็นบิลมูลค่าสูง ตามเกณฑ์มากกว่า ฿100,000 และมากกว่า 3 เท่าของค่าเฉลี่ยบิลขายในช่วงที่เลือก จึงควรให้ความสำคัญในการติดตาม ไม่ได้หมายความว่าบิลมีปัญหา`);
    if (mismatch) reasons.push(`ยอดเอกสารกับยอดรายการต่างกัน ${money(bill.difference)} เกินทั้ง ฿100 และ 5% ของมูลค่าเอกสาร จึงควรตรวจสอบที่มาของส่วนต่างก่อนสรุปว่าข้อมูลผิด`);
    explanation = reasons.join('\n\n');
    caution = 'ระบบตรวจเฉพาะยอดเงินตามเอกสาร ยังไม่ได้ตรวจการรับชำระเงินจริง การส่งมอบ หรือกำไรของบิล ส่วนต่างอาจเกิดจาก VAT หรือส่วนลด ห้ามสรุปว่าเป็นบิลผิดหรือค้างชำระจากการแจ้งเตือนนี้เพียงอย่างเดียว';
  }
  body.append(metrics);
  const insight = node('section', '', 'detail-insight');
  insight.append(node('h3', kind === 'bill' ? 'ทำไมเอกสารนี้จึงถูกแจ้งเตือน?' : 'อ่านตัวเลขเพื่อใช้งาน'), node('p', explanation));
  body.append(insight);
  if (kind === 'stock') {
    const section = node('section', '', 'bill-next-steps');
    section.append(node('h3', 'ควรให้ทีมตรวจอะไรต่อ?'));
    const list = node('ol', '');
    for (const [owner, instruction] of [
      ['คลังสินค้า', 'ตรวจนับสินค้าจริง แยกยอดจองและสินค้าพร้อมขาย รวมถึงสินค้าระหว่างรับเข้า'],
      ['จัดซื้อ', 'ตรวจใบสั่งซื้อค้างรับและระยะเวลาจัดส่ง ก่อนตัดสินใจเติมสินค้า'],
      ['ทีมขาย', 'ยืนยันสินค้าพร้อมส่งก่อนรับออเดอร์ และเตรียมสินค้าอื่นทดแทนหากจำเป็น']
    ]) {
      const item = node('li', '');
      item.append(node('strong', owner), node('p', instruction)); list.append(item);
    }
    section.append(list); body.append(section);
  }
  if (kind === 'bill') {
    const mismatch = bill.difference > Math.max(100, Math.abs(bill.total) * .05);
    const actions = mismatch ? [
      ['ฝ่ายบัญชี', 'เทียบยอดหัวเอกสารกับรายการ ตรวจ VAT ส่วนลด และรายการปรับปรุง เพื่ออธิบายส่วนต่าง'],
      ['ทีมขาย', 'ยืนยันราคา จำนวนสินค้า และเงื่อนไขส่วนลดกับเอกสารต้นทาง'],
      ['ผู้บริหาร', 'ให้ผู้รับผิดชอบสรุปสาเหตุและผลกระทบก่อนอนุมัติการแก้ไขข้อมูล']
    ] : [
      ['ทีมขาย', 'ยืนยันราคา จำนวนสินค้า และส่วนลดของออเดอร์ใหญ่ พร้อมติดตามความต้องการซื้อครั้งถัดไป'],
      ['คลัง / ทีมส่งมอบ', 'ตรวจสอบสินค้าพร้อมส่งและกำหนดส่งมอบ เพื่อดูแลออเดอร์สำคัญให้ครบถ้วน'],
      ['ฝ่ายบัญชี', 'ตรวจเงื่อนไขชำระเงินและสถานะรับชำระจากระบบต้นทาง ไม่ใช่จากสัญญาณเตือนนี้']
    ];
    const section = node('section', '', 'bill-next-steps');
    section.append(node('h3', 'มอบหมายให้ทีมตรวจอะไรต่อ?'));
    const list = node('ol', '');
    actions.forEach(([owner, instruction]) => {
      const item = node('li', '');
      item.append(node('strong', owner), node('p', instruction));
      list.append(item);
    });
    section.append(list); body.append(section);
  }
  if (kind === 'growth') {
    const periods = node('div', '', 'detail-comparisons');
    periods.append(node('p', `เดือนก่อน · ${current.previous.start} – ${current.previous.end}`), node('p', `ปีก่อน · ${current.year.start} – ${current.year.end}`));
    body.append(periods);
  }
  const note = node('section', '', 'help-caution');
  note.append(node('h3', 'ข้อควรทราบ'), node('p', caution)); body.append(note);
  if (['net', 'bill', 'target'].includes(kind)) {
    body.append(node('h3', bill ? 'รายการเอกสารที่ตรวจสอบ' : 'เอกสารล่าสุดในช่วงนี้', 'detail-table-title'));
    if (!bill) body.append(node('p', 'แสดงหน้าละ 5 รายการ จากเอกสารล่าสุดไม่เกิน 100 รายการ รวมขาย / เพิ่มหนี้ / รับคืน โดยยอดสรุปคำนวณจากเอกสารทั้งหมด', 'note'));
    const table = node('table', ''), head = node('tr', ''), thead = node('thead', ''), tbody = node('tbody', '');
    ['วันที่ / เอกสาร', 'ประเภท', 'ยอดเอกสาร', 'ยอดรายการ'].forEach(label => head.append(node('th', label)));
    thead.append(head); table.append(thead);
    const invoices = bill ? [bill] : current.bills;
    let invoicePage = 0;
    const pageSize = 5, totalPages = Math.max(1, Math.ceil(invoices.length / pageSize));
    const pagination = node('nav', '', 'detail-pagination');
    pagination.setAttribute('aria-label', 'หน้าเอกสารล่าสุด');
    const previous = node('button', '← ก่อนหน้า'), next = node('button', 'ถัดไป →'), info = node('span', '');
    previous.type = next.type = 'button';
    previous.setAttribute('aria-label', 'เอกสารหน้าก่อนหน้า');
    next.setAttribute('aria-label', 'เอกสารหน้าถัดไป');
    info.setAttribute('role', 'status');
    pagination.append(previous, info, next);
    function renderInvoices() {
      tbody.replaceChildren();
      const offset = invoicePage * pageSize;
      invoices.slice(offset, offset + pageSize).forEach(invoice => {
        const row = node('tr', '');
        [invoice.date + ' / ' + invoice.docNo, { 44: 'ขาย', 46: 'เพิ่มหนี้', 48: 'รับคืน/ลดหนี้' }[invoice.flag], money(invoice.total), invoice.lineTotal == null ? 'ไม่มีรายการ' : money(invoice.lineTotal)].forEach(value => row.append(node('td', value)));
        tbody.append(row);
      });
      if (!invoices.length) {
        const row = node('tr', ''), cell = node('td', 'ไม่พบเอกสารในช่วงวันที่เลือก');
        cell.colSpan = 4; row.append(cell); tbody.append(row);
      }
      previous.disabled = invoicePage === 0;
      next.disabled = invoicePage >= totalPages - 1;
      info.textContent = invoices.length ? `หน้า ${invoicePage + 1} / ${totalPages} · ${offset + 1}–${Math.min(offset + pageSize, invoices.length)} จาก ${invoices.length} รายการ` : '0 รายการ';
    }
    previous.addEventListener('click', () => { invoicePage = Math.max(0, invoicePage - 1); renderInvoices(); });
    next.addEventListener('click', () => { invoicePage = Math.min(totalPages - 1, invoicePage + 1); renderInvoices(); });
    renderInvoices();
    table.append(tbody);
    const scroll = node('div', '', 'detail-table-scroll');
    scroll.append(table); body.append(scroll);
    if (!bill) body.append(pagination);
  }
  if (!element('detail').open) element('detail').showModal();
}
async function refresh() {
  if (!element('filters').reportValidity()) return;
  const start = element('start').value, end = element('end').value;
  if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365) {
    element('status').textContent = 'กรุณาเลือกวันที่เริ่มก่อนวันสิ้นสุด และช่วงไม่เกิน 366 วัน';
    element('summary').hidden = true; current = null; return;
  }
  controller?.abort(); controller = new AbortController();
  const activeController = controller, request = ++requestId;
  const timeout = setTimeout(() => activeController.abort(), 30000);
  element('refresh').disabled = true; element('summary').hidden = true;
  element('detail').close(); current = null; element('status').textContent = 'กำลังโหลดข้อมูล SML…';
  try {
    const response = await fetch('/api/executive?' + new URLSearchParams({ start, end }), { signal: activeController.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
    if (request !== requestId) return;
    current = data; render(); element('summary').hidden = false;
    element('status').textContent = data.count ? 'พร้อมสรุป · คลิกตัวเลขเพื่อดูรายละเอียด' : 'ไม่พบเอกสารในช่วงที่เลือก ลองเปลี่ยนวันที่';
  } catch (error) {
    if (request !== requestId) return;
    element('status').textContent = error.name === 'AbortError' ? 'การเชื่อมต่อหมดเวลา กรุณากดอัปเดตข้อมูลเพื่อลองใหม่' : error.message;
  } finally {
    clearTimeout(timeout); if (request === requestId) element('refresh').disabled = false;
  }
}
element('filters').addEventListener('submit', event => { event.preventDefault(); refresh(); });
['start', 'end'].forEach(id => element(id).addEventListener('change', () => {
  controller?.abort(); requestId++; current = null;
  element('refresh').disabled = false; element('summary').hidden = true; element('detail').close();
  element('status').textContent = 'เปลี่ยนช่วงวันที่แล้ว กดอัปเดตข้อมูล'; restoreTarget();
}));
element('target').addEventListener('input', () => {
  formatTarget();
  try { if (targetValue()) localStorage.setItem(targetKey(), String(targetValue())); else localStorage.removeItem(targetKey()); } catch { element('status').textContent = 'บันทึกเป้าไม่ได้ เป้านี้ใช้ได้เฉพาะครั้งนี้'; }
  renderTarget();
});
['branches', 'staff'].forEach(team => element(team + '-tab').addEventListener('click', () => { activeTeam = team; if (current) renderTeam(); }));
document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.detail)));
element('close').addEventListener('click', () => element('detail').close());
setInterval(() => { if (!document.hidden && !element('refresh').disabled && !element('detail').open) refresh(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !element('detail').open) refresh(); });
restoreTarget(); refresh();
