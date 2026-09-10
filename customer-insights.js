import { readFile } from 'node:fs/promises';

const customersSql = await readFile(new URL('./sql/customer-insights.sql', import.meta.url), 'utf8');
const productsSql = await readFile(new URL('./sql/customer-products.sql', import.meta.url), 'utf8');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPeriod = (start, end) => validDate(start) && validDate(end) && start <= end
  && (Date.parse(end) - Date.parse(start)) / 86400000 <= 365;

function customerQueryError(error) {
  const codes = [error.code, ...(error.errors ?? []).map(item => item.code)];
  if (codes.some(code => ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', '08001', '08006', '57P01', '57P03'].includes(code))
    || /connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(error.message ?? '')) {
    return 'เชื่อมต่อฐานข้อมูล SML ไม่สำเร็จหรือการเชื่อมต่อถูกตัด กรุณาตรวจสอบเครือข่าย/VPN และบริการ PostgreSQL แล้วกดอัปเดตข้อมูลอีกครั้ง';
  }
  if (codes.some(code => ['28P01', '28000', '42501', '3D000'].includes(code))) {
    return 'การตั้งค่าหรือสิทธิ์เข้าถึงฐานข้อมูล SML ไม่ถูกต้อง กรุณาให้ผู้ดูแลตรวจสอบค่าเชื่อมต่อใน .env และสิทธิ์ฐานข้อมูล แล้วรีสตาร์ตเซิร์ฟเวอร์';
  }
  if (codes.includes('57014')) {
    return 'ดึงข้อมูลลูกค้าเกินเวลาที่กำหนด กรุณาลดช่วงวันที่แล้วกดอัปเดตข้อมูลอีกครั้ง';
  }
  return 'ดึงข้อมูลลูกค้าจาก SML ไม่สำเร็จ กรุณาลองใหม่';
}

export function installCustomerInsights(app, pool) {
  for (const detail of [false, true]) {
    app.get(`/api/customer-insights${detail ? '/products' : ''}`, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { start, end, code } = req.query;
      if (!validPeriod(start, end)) {
        return res.status(400).json({ error: 'กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน' });
      }
      // An empty code represents documents without an assigned customer.
      if (detail && (typeof code !== 'string' || code.length > 200)) {
        return res.status(400).json({ error: 'กรุณาระบุรหัสลูกค้าให้ถูกต้อง' });
      }
      try {
        const { rows } = await pool.query(detail ? productsSql : customersSql, detail ? [start, end, code] : [start, end]);
        const data = rows[0].insights;
        if (detail && !data.customer) {
          return res.status(404).json({ error: 'ไม่พบรายการของลูกค้านี้ในช่วงวันที่เลือก' });
        }
        res.json({ ...data, start, end, updatedAt: new Date().toISOString() });
      } catch (error) {
        console.error('Customer insights query failed:', error.code);
        res.status(503).json({ error: customerQueryError(error) });
      }
    });
  }
}
