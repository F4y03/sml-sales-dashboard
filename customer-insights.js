import { readFile } from 'node:fs/promises';

const customersSql = await readFile(new URL('./sql/customer-insights.sql', import.meta.url), 'utf8');
const productsSql = await readFile(new URL('./sql/customer-products.sql', import.meta.url), 'utf8');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPeriod = (start, end) => validDate(start) && validDate(end) && start <= end
  && (Date.parse(end) - Date.parse(start)) / 86400000 <= 365;

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
        res.status(503).json({ error: 'ดึงข้อมูลลูกค้าจาก SML ไม่สำเร็จ กรุณาลองใหม่' });
      }
    });
  }
}
