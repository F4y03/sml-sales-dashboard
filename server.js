import express from 'express';
import { installAuth } from './auth.js';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installReports } from './reports.js';
import { installProducts } from './products.js';
import { installAnalytics } from './analytics.js';
import { installExecutive } from './executive.js';
import { installCustomerInsights } from './customer-insights.js';
import { installProductPerformance } from './product-performance.js';

const app = express();
const pool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 15000, max: 5, options: '-c default_transaction_read_only=on' });
pool.on('error', error => console.error('Idle database connection:', error.code));
const sql = await readFile(new URL('./sql/dashboard.sql', import.meta.url), 'utf8');
// SML report 4007 explicitly selects sales flag 44. Do not silently change its meaning.
const flag = 44;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPeriod = (start, end) => validDate(start) && validDate(end) && start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 <= 365;
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
installAuth(app);
installReports(app, pool);
installProducts(app, pool);
installAnalytics(app, pool);
installExecutive(app, pool);
installCustomerInsights(app, pool);
installProductPerformance(app, pool);
app.get('/api/dashboard', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { start, end } = req.query;
  if (!validPeriod(start, end)) {
    return res.status(400).json({ error: 'กรุณาระบุวันที่ให้ถูกต้อง ช่วงเวลาไม่เกิน 366 วัน' });
  }
  try {
    const { rows } = await pool.query(sql, [start, end, flag]);
    res.json({ ...rows[0].dashboard, source: 'SML PostgreSQL', reportId: '4007', itemReportId: '4014', updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Dashboard query failed:', error.code);
    res.status(503).json({ error: 'เชื่อมต่อ SML ไม่สำเร็จ กรุณาตรวจสอบฐานข้อมูลและโครงสร้างตารางตาม README' });
  }
});
app.get('/api/invoices', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { start, end } = req.query;
  if (!validPeriod(start, end)) {
    return res.status(400).json({ error: 'กรุณาระบุวันที่ให้ถูกต้อง ช่วงเวลาไม่เกิน 366 วัน' });
  }
  const page = Math.max(0, Number.parseInt(req.query.page || '0', 10) || 0);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(req.query.pageSize || '25', 10) || 25));
  const search = String(req.query.q || '').trim();
  try {
    const params = [start, end, flag, pageSize, page * pageSize, search];
    const { rows } = await pool.query(`
      WITH headers AS (
        SELECT h.doc_no, h.doc_date::date AS doc_date, h.cust_code,
               COALESCE(NULLIF(c.name_1, ''), NULLIF(h.cust_code, ''), 'ไม่ระบุลูกค้า') AS customer,
               h.total_amount
        FROM ic_trans h
        LEFT JOIN (SELECT code, MAX(name_1) AS name_1 FROM ar_customer GROUP BY code) c ON c.code = h.cust_code
        WHERE h.doc_date >= $1::date AND h.doc_date < $2::date + INTERVAL '1 day'
          AND h.trans_flag = $3::integer AND h.last_status = 0
          AND to_timestamp(h.doc_date::date || ' ' || h.doc_time, 'YYYY/MM/DD HH24:MI')::timestamp
              BETWEEN $1::date::timestamp AND $2::date + TIME '23:59'
          AND ($6 = '' OR h.doc_no ILIKE '%' || $6 || '%' OR h.cust_code ILIKE '%' || $6 || '%' OR c.name_1 ILIKE '%' || $6 || '%')
      ), counted AS (
        SELECT COUNT(*) OVER () AS total_count, *
        FROM headers
        ORDER BY doc_date DESC, doc_no DESC
        LIMIT $4 OFFSET $5
      )
      SELECT COALESCE(MAX(total_count), 0)::integer AS total,
             COALESCE(json_agg(json_build_object(
               'docNo', doc_no,
               'date', to_char(doc_date, 'YYYY-MM-DD'),
               'customerCode', cust_code,
               'customer', customer,
               'total', total_amount
             ) ORDER BY doc_date DESC, doc_no DESC) FILTER (WHERE doc_no IS NOT NULL), '[]'::json) AS invoices
      FROM counted
    `, params);
    res.json({ start, end, page, pageSize, search, total: rows[0].total, invoices: rows[0].invoices, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Invoices query failed:', error.code);
    res.status(503).json({ error: 'ดึงรายการบิลไม่สำเร็จ กรุณาลองใหม่' });
  }
});
// API requests must never fall through to Express's HTML 404 page.
app.use('/api', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).json({ error: 'ไม่พบ API ที่ร้องขอ กรุณาตรวจสอบ URL หรือรีสตาร์ตเซิร์ฟเวอร์ Dashboard' });
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => console.log(`Dashboard: http://localhost:${port} (Intranet: http://<server-ip>:${port})`));
process.on('SIGINT', () => server.close(async () => { await pool.end(); process.exit(0); }));
