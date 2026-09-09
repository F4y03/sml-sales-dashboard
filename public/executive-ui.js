const element = id => document.getElementById(id);
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const money = value => value == null ? 'ข้อมูลไม่ครบ' : '฿' + number.format(value);
const percent = value => value == null ? 'ไม่มีฐานเทียบ' : `${value > 0 ? '↑ +' : value < 0 ? '↓ ' : ''}${number.format(value)}%`;
const margin = (profit, revenue) => profit != null && revenue > 0 ? profit / revenue * 100 : null;
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
let current = null, activeTeam = 'branches', controller, requestId = 0;
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
  current.products.filter(product => product.stock != null && product.stock <= 5 && product.sales > 0).forEach(product => alerts.push({ category: 'สต๊อกใกล้หมด', icon: '▦', title: product.name || product.code, description: 'สินค้าขายดี · ตรวจสอบสต๊อกจริงก่อนเติมสินค้า', value: `${number.format(product.stock)} ${product.unit || 'หน่วยมาตรฐาน'}`, caption: 'คงเหลือในทะเบียน', yellow: true, href: 'products.html' }));
  current.unusual.forEach(bill => {
    const mismatch = bill.difference > Math.max(100, Math.abs(bill.total) * .05);
    alerts.push({ category: mismatch ? 'ยอดเอกสารไม่ตรง' : 'บิลมูลค่าสูง', icon: mismatch ? '≠' : '↗', title: `เอกสาร ${bill.docNo}`, description: `${bill.date} · ${mismatch ? `ยอดเอกสาร ${money(bill.total)} · ` : ''}ตรวจ VAT/ส่วนลดและเอกสารต้นทาง`, value: money(mismatch ? bill.difference : bill.total), caption: mismatch ? 'ส่วนต่างที่ควรตรวจสอบ' : 'มูลค่าเอกสาร', bill });
  });
  element('alerts').replaceChildren();
  alerts.forEach(alert => {
    const row = node('article', '', `alert${alert.yellow ? ' yellow' : ''}`), action = node(alert.href ? 'a' : 'button', 'ตรวจสอบ →', 'alert-action');
    const icon = node('span', alert.icon, 'alert-icon');
    icon.setAttribute('aria-hidden', 'true');
    const content = node('div', '', 'alert-content');
    content.append(node('span', alert.category, 'alert-category'), node('h3', alert.title), node('p', alert.description));
    const metric = node('div', '', 'alert-metric');
    metric.append(node('strong', alert.value), node('small', alert.caption));
    action.setAttribute('aria-label', `ตรวจสอบ ${alert.title}`);
    row.append(icon, content, metric);
    if (alert.href) action.href = alert.href;
    else action.addEventListener('click', () => openDetail(alert.bill ? 'bill' : alert.detail, alert.bill));
    row.append(action); element('alerts').append(row);
  });
  if (!alerts.length) element('alerts').append(node('p', 'ไม่พบการเตือนตามเกณฑ์ที่ตรวจได้ (ไม่รวมสต๊อก/ต้นทุนที่ไม่มีข้อมูล)', 'note'));
  element('alert-count').textContent = `${alerts.length} เรื่อง`;
  element('updated').textContent = `ช่วง ${current.start} – ${current.end} · ${number.format(current.count)} เอกสาร · อัปเดต ${new Date(current.updatedAt).toLocaleString('th-TH')}`;
}
function openDetail(kind, bill) {
  if (!current) return;
  element('detail-title').textContent = { net: 'เอกสารขายและรับคืน', activity: 'จำนวนบิลขายและยอดเฉลี่ยต่อบิล', growth: 'เปรียบเทียบช่วงเวลา', target: 'ความคืบหน้าเป้ายอดขาย', bill: 'ตรวจสอบเอกสาร' }[kind];
  const body = element('detail-body'); body.replaceChildren();
  body.append(node('p', `ช่วงวันที่ ${current.start} – ${current.end}`));
  if (kind === 'activity') body.append(node('p', `จำนวนบิลขาย ${number.format(current.salesInvoiceCount)} บิล\nยอดเฉลี่ยต่อบิล ${current.averageSale == null ? 'ยังไม่มีบิลขาย' : money(current.averageSale)}\nนับเฉพาะเอกสารขาย (44) ที่ไม่ยกเลิกและไม่ใช่สำเนา ไม่รวมเพิ่มหนี้/รับคืน\nยอดเฉลี่ย = ยอดรวมเอกสารขาย ÷ จำนวนบิลขายทั้งหมดในช่วงที่เลือก ก่อนหักรับคืน ไม่ใช่ยอดขายสุทธิ\nใช้ดูปริมาณการขายและขนาดบิล เพื่อวางแผนเพิ่มจำนวนบิลหรือเพิ่มยอดต่อการขาย`));
  if (kind === 'growth') body.append(node('p', `ปัจจุบัน ${money(current.net)}\nMoM: ${current.previous.start} – ${current.previous.end} = ${money(current.previousNet)} (${percent(current.mom)})\nYoY: ${current.year.start} – ${current.year.end} = ${money(current.yearNet)} (${percent(current.yoy)})\nเลื่อนวันเริ่ม/สิ้นสุดย้อนหลัง 1 เดือน หรือ 1 ปี จำกัดวันตามสิ้นเดือน จำนวนวันอาจต่างกัน\nไม่คำนวณ % เมื่อฐานเป็นศูนย์หรือติดลบ`));
  if (kind === 'target') body.append(node('p', targetValue() ? `เป้าช่วงนี้ ${money(targetValue())}\nทำได้ ${money(current.net)}\n${element('remaining').textContent}\nเป้ากรอกเอง เก็บเฉพาะเบราว์เซอร์นี้ ไม่ใช่เป้าจาก SML` : 'ยังไม่กำหนดเป้า กรอกเป้าสำหรับช่วงวันที่ด้านบน'));
  if (['net', 'bill', 'target'].includes(kind)) {
    body.append(node('p', 'สุทธิ = ขาย (44) + เพิ่มหนี้ (46) − รับคืน/ลดหนี้ (48) · ตัดยกเลิกและสำเนา\nแสดงเอกสารล่าสุดไม่เกิน 100 รายการ (ยอดสรุปคำนวณจากทั้งหมด)'));
    const table = node('table', ''), head = node('tr', ''), thead = node('thead', ''), tbody = node('tbody', '');
    ['วันที่ / เอกสาร', 'ประเภท', 'ยอดเอกสาร', 'ยอดรายการ'].forEach(label => head.append(node('th', label)));
    thead.append(head); table.append(thead);
    (bill ? [bill] : current.bills).forEach(invoice => {
      const row = node('tr', '');
      [invoice.date + ' / ' + invoice.docNo, { 44: 'ขาย', 46: 'เพิ่มหนี้', 48: 'รับคืน/ลดหนี้' }[invoice.flag], money(invoice.total), invoice.lineTotal == null ? 'ไม่มีรายการ' : money(invoice.lineTotal)].forEach(value => row.append(node('td', value)));
      tbody.append(row);
    });
    table.append(tbody); body.append(table);
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
