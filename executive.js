import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('./sql/executive.sql', import.meta.url), 'utf8');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function shiftMonth(value, months) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

export function growth(current, previous) {
  return previous > 0 ? (current - previous) / previous * 100 : null;
}

export function installExecutive(app, pool) {
  app.get('/api/executive', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { start, end } = req.query;
    if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365) {
      return res.status(400).json({ error: 'กรุณาเลือกวันที่ให้ถูกต้อง ช่วงไม่เกิน 366 วัน' });
    }
    try {
      const previous = { start: shiftMonth(start, -1), end: shiftMonth(end, -1) };
      const year = { start: shiftMonth(start, -12), end: shiftMonth(end, -12) };
      const { rows } = await pool.query(sql, [start, end, previous.start, previous.end, year.start, year.end]);
      const data = rows[0].summary;
      res.json({ ...data, start, end, previous, year, mom: growth(data.net, data.previousNet), yoy: growth(data.net, data.yearNet), updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Executive query failed:', error.code);
      res.status(503).json({ error: 'ดึงข้อมูล SML ไม่สำเร็จ กรุณาลองใหม่หรือตรวจสอบการเชื่อมต่อฐานข้อมูล' });
    }
  });
}
