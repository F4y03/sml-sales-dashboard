import { readFile } from 'node:fs/promises';

export const performanceBaseSql = await readFile(new URL('./sql/product-performance-base.sql', import.meta.url), 'utf8');
export const catalogSql = `${performanceBaseSql}
SELECT json_build_object('products', COALESCE((SELECT json_agg(c ORDER BY net DESC, code) FROM catalog c), '[]'::json)) AS insights`;
export const buyersSql = `${performanceBaseSql}, buyers AS (
  SELECT customer_code AS code, SUM(direction * amount) AS net,
    COUNT(DISTINCT (doc_no, day)) FILTER (WHERE trans_flag = 44) AS "invoiceCount",
    to_char(MAX(day) FILTER (WHERE trans_flag = 44), 'YYYY-MM-DD') AS "lastSold"
  FROM lines WHERE period = 'current' GROUP BY customer_code
), buyer_units AS (
  SELECT customer_code AS code, unit, SUM(direction * quantity) AS net
  FROM lines WHERE period = 'current' GROUP BY customer_code, unit
), buyer_quantities AS (
  SELECT code, json_agg(json_build_object('unit', unit, 'net', net) ORDER BY unit) AS quantities FROM buyer_units GROUP BY code
)
SELECT json_build_object(
  'product', (SELECT row_to_json(c) FROM catalog c WHERE code = $5),
  'buyers', COALESCE((SELECT json_agg(b ORDER BY net DESC, code) FROM (
    SELECT b.*, COALESCE(NULLIF(c.name_1, ''), NULLIF(b.code, ''), 'ไม่ระบุลูกค้า') AS name, q.quantities
    FROM buyers b LEFT JOIN buyer_quantities q ON q.code = b.code
    LEFT JOIN (SELECT code, MAX(name_1) AS name_1 FROM ar_customer GROUP BY code) c ON c.code = b.code
  ) b), '[]'::json)
) AS insights`;

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function previousPeriod(start, end) {
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  return { start: new Date(Date.parse(start) - days * 86400000).toISOString().slice(0, 10),
    end: new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10), days };
}

export function installProductPerformance(app, pool) {
  for (const detail of [false, true]) {
    app.get(`/api/customer-insights/${detail ? 'product-buyers' : 'catalog'}`, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const { start, end, code } = req.query;
      if (!validDate(start) || !validDate(end) || start < '0002-01-01' || start > end || Date.parse(end) - Date.parse(start) > 365 * 86400000) {
        return res.status(400).json({ error: 'กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน' });
      }
      if (detail && (typeof code !== 'string' || !code.trim() || code.length > 200)) {
        return res.status(400).json({ error: 'กรุณาระบุรหัสสินค้าให้ถูกต้อง' });
      }
      const previous = previousPeriod(start, end);
      try {
        const { rows } = await pool.query(detail ? buyersSql : catalogSql, [start, end, previous.start, previous.end, detail ? code : null]);
        const data = rows[0].insights;
        if (detail && !data.product) return res.status(404).json({ error: 'ไม่พบสินค้าที่เลือก' });
        res.json({ ...data, start, end, previous, updatedAt: new Date().toISOString() });
      } catch (error) {
        console.error('Product performance query failed:', error.code);
        res.status(503).json({ error: 'ดึงข้อมูลยอดขายสินค้าจาก SML ไม่สำเร็จ กรุณาลองใหม่' });
      }
    });
  }
}
