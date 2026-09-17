export const regionMap = { ฝกจ: 'ภาคกลาง', ฝกณ: 'ภาคกลาง', ฝกต: 'ภาคกลาง', ฝกร: 'ภาคกลาง', ฝกภ: 'ภาคกลาง', ฝบอ: 'ภาคกลาง', ฝหย: 'ภาคเหนือ', ฝตช: 'ภาคใต้', ฝลภ: 'ภาคตะวันออก', ฝอย: 'ภาคตะวันออกเฉียงเหนือ' };
export const headers = ['วันที่ทำรายการ', 'รหัสลูกค้า', 'ภูมิภาค', 'ชื่อสินค้า', 'ประเภทรายการ', 'จำนวน', 'ยอดคงเหลือ'];
export function regionFor(code) {
  const prefix = code.trim().split(/[-_]/, 1)[0];
  return regionMap[code.slice(0, 3)] || regionMap[`ฝ${prefix}`] || 'ไม่ระบุภูมิภาค';
}
export function parseCSV(text) {
  const matrix = []; let row = [], cell = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (c !== ',') { if (row.some(Boolean)) matrix.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('รูปแบบ CSV ไม่ถูกต้อง: เครื่องหมายคำพูด'); cell += c; }
  }
  if (quoted) throw new Error('รูปแบบ CSV ไม่ถูกต้อง: ปิดเครื่องหมายคำพูดไม่ครบ');
  row.push(cell.trim()); if (row.some(Boolean)) matrix.push(row);
  const cols = matrix.shift() || [];
  const required = headers.filter(h => h !== 'ภูมิภาค');
  if (new Set(cols).size !== cols.length || required.some(h => !cols.includes(h))) throw new Error('หัวคอลัมน์ไม่ครบหรือซ้ำ กรุณาใช้ไฟล์แม่แบบ');
  if (!matrix.length) throw new Error('ไฟล์ไม่มีรายการข้อมูล');
  return matrix.map((values, index) => {
    const get = name => values[cols.indexOf(name)];
    const date = get(headers[0]), customer = get(headers[1]), product = get(headers[3]), type = get(headers[4]);
    const number = name => /^-?\d+(\.\d+)?$/.test(get(name) || '') ? Number(get(name)) : NaN;
    const quantity = number(headers[5]), balance = number(headers[6]);
    if (values.length !== cols.length || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || !customer || !product || !['รับเข้า', 'เบิกออก'].includes(type) || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(balance)) throw new Error(`แถวข้อมูล ${index + 2} ไม่ถูกต้อง ตรวจวันที่ รหัสลูกค้า สินค้า ประเภทรายการ และจำนวน`);
    return { date, customer, product, type, quantity, balance, region: regionFor(customer), index };
  });
}
export function summarize(rows, customers = new Set(), regions = new Set()) {
  const filtered = rows.filter(r => (!customers.size || customers.has(r.customer)) && (!regions.size || regions.has(r.region)));
  const latest = new Map(), byCustomer = new Map(), byRegion = new Map(), byMonth = new Map();
  const dates = rows.map(r => r.date).sort();
  if (dates.length) {
    let month = dates[0].slice(0, 7), end = dates.at(-1).slice(0, 7);
    // Limit pathological input ranges before allocating chart points.
    if (Number(end.slice(0, 4)) - Number(month.slice(0, 4)) > 100) throw new Error('ช่วงข้อมูลต้องไม่เกิน 100 ปี');
    while (month <= end) { byMonth.set(month, 0); const [y, m] = month.split('-').map(Number); month = m === 12 ? `${String(y + 1).padStart(4, '0')}-01` : `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`; }
  }
  for (const r of filtered) {
    if (!byCustomer.has(r.customer)) byCustomer.set(r.customer, { customer: r.customer, region: r.region, withdrawal: 0, balance: 0 });
    if (!byRegion.has(r.region)) byRegion.set(r.region, 0);
    if (r.type === 'เบิกออก') {
      byCustomer.get(r.customer).withdrawal += r.quantity;
      byRegion.set(r.region, byRegion.get(r.region) + r.quantity);
      const month = r.date.slice(0, 7); byMonth.set(month, byMonth.get(month) + r.quantity);
    }
    const key = JSON.stringify([r.customer, r.productCode || r.product, r.unit || '']), previous = latest.get(key);
    if (!previous || r.date > previous.date || (r.date === previous.date && r.index > previous.index)) latest.set(key, r);
  }
  for (const r of latest.values()) byCustomer.get(r.customer).balance += r.balance;
  const summary = [...byCustomer.values()].sort((a, b) => b.balance - a.balance);
  return { summary, byRegion, byMonth, count: filtered.length, withdrawal: summary.reduce((s, r) => s + r.withdrawal, 0), balance: summary.reduce((s, r) => s + r.balance, 0), date: filtered.map(r => r.date).sort().at(-1) };
}
