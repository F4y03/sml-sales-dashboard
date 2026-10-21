// "ลูกค้า & สต็อก": customer bill history, whole-stock value and per-product movement.
// Read-only SML queries, all parameterised. Access (Super Admin / ผู้บริหาร, all-territory only)
// is enforced in src/middleware/access.js before these routes run.
import { stockAffectingSQL } from './consignment.js';

const PAGE = 50;
const DOC_FLAGS = '(44, 46, 48)'; // ขาย + เพิ่มหนี้ + รับคืน/ลดหนี้, same as Customer Insights
const numericText = "'^[+-]?[0-9]+([.][0-9]+)?$'";
const text = (value, max = 200) => typeof value === 'string' && value.length <= max ? value.trim() : null;
const pageOf = value => {
  const page = Number(value ?? 0);
  return Number.isInteger(page) && page >= 0 && page <= 100000 ? page : null;
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const customerSearchSql = `
SELECT c.code, COALESCE(NULLIF(MAX(c.name_1), ''), c.code) AS name
FROM ar_customer c
WHERE NULLIF(btrim(c.code), '') IS NOT NULL
  AND (strpos(lower(c.code), lower($1)) > 0 OR strpos(lower(COALESCE(c.name_1, '')), lower($1)) > 0)
GROUP BY c.code
ORDER BY (lower(c.code) = lower($1)) DESC, c.code
LIMIT 30`;

const customerBillsSql = `
WITH bills AS (
  SELECT h.doc_no, h.doc_date::date AS day, h.trans_flag AS flag, COALESCE(h.total_amount, 0) AS amount,
    btrim(COALESCE(h.sale_code, '')) AS sale_code, COALESCE(h.branch_code, '') AS branch
  FROM ic_trans h
  WHERE COALESCE(h.cust_code, '') = $1 AND h.trans_flag IN ${DOC_FLAGS} AND h.last_status = 0 AND h.is_doc_copy = 0
)
SELECT json_build_object(
  'customer', (SELECT json_build_object('code', c.code, 'name', COALESCE(NULLIF(MAX(c.name_1), ''), c.code))
    FROM ar_customer c WHERE c.code = $1 GROUP BY c.code),
  'summary', (SELECT json_build_object(
    'documents', COUNT(*),
    'invoices', COUNT(*) FILTER (WHERE flag = 44),
    'sales', COALESCE(SUM(amount) FILTER (WHERE flag = 44), 0),
    'added', COALESCE(SUM(amount) FILTER (WHERE flag = 46), 0),
    'returns', COALESCE(SUM(amount) FILTER (WHERE flag = 48), 0),
    'net', COALESCE(SUM(CASE WHEN flag = 48 THEN -amount ELSE amount END), 0),
    'first', to_char(MIN(day) FILTER (WHERE flag = 44), 'YYYY-MM-DD'),
    'last', to_char(MAX(day) FILTER (WHERE flag = 44), 'YYYY-MM-DD')) FROM bills),
  'bills', COALESCE((SELECT json_agg(b) FROM (
    SELECT doc_no AS "docNo", to_char(day, 'YYYY-MM-DD') AS date, flag, amount, sale_code AS "saleCode", branch
    FROM bills ORDER BY day DESC, doc_no DESC LIMIT ${PAGE} OFFSET $2) b), '[]'::json)
) AS history`;

// Lines of one document; the header EXISTS keeps cancelled/copy documents out and copes with
// SML headers whose branch is blank while the lines carry 000 (same rule as customer-products.sql).
const billLinesSql = `
SELECT d.item_code AS code, COALESCE(NULLIF(d.item_name, ''), d.item_code) AS name,
  d.qty AS quantity, COALESCE(NULLIF(d.unit_code, ''), '') AS unit, d.sum_amount AS amount
FROM ic_trans_detail d
WHERE d.doc_no = $1 AND d.doc_date::date = $2::date AND d.trans_flag = $3 AND COALESCE(d.cust_code, '') = $4
  AND d.last_status = 0 AND d.is_doc_copy = 0
  AND COALESCE(btrim(d.item_code), '') <> ''
  AND EXISTS (SELECT 1 FROM ic_trans h WHERE h.doc_no = d.doc_no AND h.doc_date::date = d.doc_date::date
    AND h.trans_flag = d.trans_flag AND COALESCE(h.cust_code, '') = COALESCE(d.cust_code, '')
    AND h.last_status = 0 AND h.is_doc_copy = 0
    AND (NULLIF(btrim(h.branch_code), '') IS NULL OR h.branch_code = d.branch_code))
ORDER BY d.line_number, d.roworder`;

// Stock value = register balance × register sale price (price_0 of the standard unit, as on เช็คราคา/สต๊อก).
// Consignment codes (ฝ…) are excluded. Only positive balances with a numeric price are valued;
// NULL stock is "no data" (never 0), negative stock and missing prices are counted separately.
const stockSql = `
WITH inventory AS (
  SELECT i.code, MAX(i.name_1) AS name, MAX(i.unit_standard) AS unit, MAX(i.balance_qty) AS quantity,
    MAX(i.group_main) AS group_code
  FROM ic_inventory i
  WHERE NULLIF(btrim(i.code), '') IS NOT NULL AND left(i.code, 1) <> 'ฝ'
  GROUP BY i.code
), priced AS (
  SELECT v.*, (SELECT NULLIF(TRIM(p.price_0), '') FROM ic_inventory_price_formula p
      WHERE p.ic_code = v.code AND p.unit_code = v.unit AND p.sale_type = 0
      ORDER BY p.roworder DESC LIMIT 1) AS price_text
  FROM inventory v
), valued AS (
  SELECT p.*, CASE WHEN p.price_text ~ ${numericText} THEN p.price_text::numeric END AS price,
    CASE WHEN p.quantity > 0 AND p.price_text ~ ${numericText} THEN p.quantity * p.price_text::numeric END AS value,
    (SELECT MAX(g.name_1) FROM ic_group g WHERE g.code = p.group_code) AS group_name
  FROM priced p
), matching AS (
  SELECT * FROM valued
  WHERE ($1::text = '' OR strpos(lower(code), lower($1)) > 0 OR strpos(lower(COALESCE(name, '')), lower($1)) > 0)
    AND ($2::text = 'all' OR ($2 = 'in' AND quantity > 0) OR ($2 = 'out' AND quantity <= 0) OR ($2 = 'nodata' AND quantity IS NULL))
)
SELECT json_build_object(
  'summary', (SELECT json_build_object(
    'products', COUNT(*),
    'inStock', COUNT(*) FILTER (WHERE quantity > 0),
    'value', COALESCE(SUM(value), 0),
    'inStockNoPrice', COUNT(*) FILTER (WHERE quantity > 0 AND price IS NULL),
    'negative', COUNT(*) FILTER (WHERE quantity < 0),
    'noStockData', COUNT(*) FILTER (WHERE quantity IS NULL)) FROM valued),
  'matching', (SELECT json_build_object('count', COUNT(*), 'value', COALESCE(SUM(value), 0)) FROM matching),
  'rows', COALESCE((SELECT json_agg(r) FROM (
    SELECT code, name, unit, quantity, price, value, COALESCE(group_name, group_code) AS "group"
    FROM matching
    ORDER BY CASE WHEN $3 = 'value' THEN value END DESC NULLS LAST,
      CASE WHEN $3 = 'quantity' THEN quantity END DESC NULLS LAST,
      CASE WHEN $3 = 'name' THEN name END ASC,
      code ASC
    LIMIT ${PAGE} OFFSET $4) r), '[]'::json)
) AS stock`;

const productSearchSql = `
SELECT i.code, COALESCE(NULLIF(MAX(i.name_1), ''), i.code) AS name, MAX(i.unit_standard) AS unit, MAX(i.balance_qty) AS quantity
FROM ic_inventory i
WHERE NULLIF(btrim(i.code), '') IS NOT NULL AND left(i.code, 1) <> 'ฝ'
  AND (strpos(lower(i.code), lower($1)) > 0 OR strpos(lower(COALESCE(i.name_1, '')), lower($1)) > 0)
GROUP BY i.code
ORDER BY (lower(i.code) = lower($1)) DESC, i.code
LIMIT 30`;

// Report 2060 movement of one product (same rule and unit conversion as the consignment page),
// with a running balance in the standard unit.
const movementSql = `
WITH moves AS (
  SELECT to_char(d.doc_date, 'YYYY-MM-DD') AS date, d.doc_no AS "docNo", d.trans_flag AS flag,
    COALESCE(d.cust_code, '') AS customer, d.calc_flag AS direction,
    d.qty * d.stand_value / NULLIF(d.divide_value, 0) AS quantity,
    d.qty * d.calc_flag * d.stand_value / NULLIF(d.divide_value, 0) AS change,
    ROW_NUMBER() OVER (ORDER BY d.doc_date, d.doc_time, d.doc_no, d.line_number, d.roworder) AS index
  FROM ic_trans_detail d
  WHERE d.item_code = $1 AND d.last_status = 0 AND d.doc_date <= CURRENT_DATE AND ${stockAffectingSQL}
)
SELECT m.date, m."docNo", m.flag, m.customer, COALESCE(NULLIF(c.name, ''), NULLIF(m.customer, '')) AS "customerName",
  m.direction, m.quantity, SUM(m.change) OVER (ORDER BY m.index ROWS UNBOUNDED PRECEDING) AS balance
FROM moves m
LEFT JOIN (SELECT code, MAX(name_1) AS name FROM ar_customer GROUP BY code) c ON c.code = m.customer
WHERE m.quantity <> 0 OR m.quantity IS NULL
ORDER BY m.index`;
const productInfoSql = `
SELECT i.code, COALESCE(NULLIF(MAX(i.name_1), ''), i.code) AS name, MAX(i.unit_standard) AS unit, MAX(i.balance_qty) AS quantity
FROM ic_inventory i WHERE i.code = $1 GROUP BY i.code`;

// Split the running balance into stock cycles: a cycle starts when the balance rises above 0
// (วันเข้า) and ends on the first movement that brings it back to 0 or below (วันหมด).
// Buyers are sales documents (flag 44) inside the cycle, grouped by customer.
export function stockCycles(moves) {
  const cycles = [];
  let current = null, previous = 0;
  for (const move of moves) {
    const balance = move.balance == null ? null : Number(move.balance);
    if (balance == null) continue;
    if (!current && previous <= 0 && balance > 0) {
      current = { start: move.date, startDoc: move.docNo, received: 0, receipts: 0, sold: 0, buyers: new Map(), end: null, endDoc: null };
    }
    if (current) {
      const quantity = Number(move.quantity) || 0;
      if (Number(move.direction) === 1) { current.received += quantity; current.receipts += 1; }
      if (Number(move.direction) === -1 && Number(move.flag) === 44) {
        current.sold += quantity;
        const key = move.customer;
        const buyer = current.buyers.get(key) ?? { code: move.customer, name: move.customerName || 'ไม่ระบุลูกค้า', quantity: 0, bills: 0, first: move.date, last: move.date };
        buyer.quantity += quantity; buyer.bills += 1; buyer.last = move.date;
        current.buyers.set(key, buyer);
      }
      if (balance <= 0) {
        current.end = move.date; current.endDoc = move.docNo;
        cycles.push(current); current = null;
      }
    }
    previous = balance;
  }
  if (current) cycles.push(current);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  return cycles.map(cycle => ({
    ...cycle,
    days: cycle.end ? days(cycle.start, cycle.end) : null,
    buyers: [...cycle.buyers.values()].sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code)),
  })).reverse();
}

function queryError(res, error, label) {
  console.error(`Customer & stock ${label} failed:`, error.code);
  res.status(503).json({ error: error.code === '57014'
    ? 'ดึงข้อมูลจาก SML เกินเวลาที่กำหนด กรุณาลองใหม่'
    : 'ดึงข้อมูลจาก SML ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่' });
}

export function installCustomerStock(app, pool) {
  app.use('/api/customer-stock', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/customer-stock/customers', async (req, res) => {
    const q = text(req.query.q, 100);
    if (!q) return res.status(400).json({ error: 'กรุณาพิมพ์รหัสหรือชื่อลูกค้า' });
    try { res.json({ customers: (await pool.query(customerSearchSql, [q])).rows }); }
    catch (error) { queryError(res, error, 'customer search'); }
  });

  app.get('/api/customer-stock/customer', async (req, res) => {
    const code = text(req.query.code), page = pageOf(req.query.page);
    if (!code || page == null) return res.status(400).json({ error: 'กรุณาเลือกลูกค้าให้ถูกต้อง' });
    try {
      const data = (await pool.query(customerBillsSql, [code, page * PAGE])).rows[0].history;
      if (!data.customer && !data.summary.documents) return res.status(404).json({ error: 'ไม่พบลูกค้ารหัสนี้' });
      res.json({ ...data, page, pageSize: PAGE, updatedAt: new Date().toISOString() });
    } catch (error) { queryError(res, error, 'customer history'); }
  });

  app.get('/api/customer-stock/bill', async (req, res) => {
    const docNo = text(req.query.docNo), customer = text(req.query.customer ?? ''), flag = Number(req.query.flag);
    if (!docNo || customer == null || !validDate(req.query.date) || ![44, 46, 48].includes(flag)) {
      return res.status(400).json({ error: 'ข้อมูลบิลไม่ถูกต้อง' });
    }
    try { res.json({ lines: (await pool.query(billLinesSql, [docNo, req.query.date, flag, customer])).rows }); }
    catch (error) { queryError(res, error, 'bill lines'); }
  });

  app.get('/api/customer-stock/stock', async (req, res) => {
    const q = text(req.query.q ?? '', 100), page = pageOf(req.query.page);
    const filter = req.query.filter ?? 'all', sort = req.query.sort ?? 'value';
    if (q == null || page == null || !['all', 'in', 'out', 'nodata'].includes(filter) || !['value', 'quantity', 'name', 'code'].includes(sort)) {
      return res.status(400).json({ error: 'ตัวกรองสต็อกไม่ถูกต้อง' });
    }
    try {
      const data = (await pool.query(stockSql, [q, filter, sort, page * PAGE])).rows[0].stock;
      res.json({ ...data, page, pageSize: PAGE, updatedAt: new Date().toISOString() });
    } catch (error) { queryError(res, error, 'stock'); }
  });

  app.get('/api/customer-stock/products', async (req, res) => {
    const q = text(req.query.q, 100);
    if (!q) return res.status(400).json({ error: 'กรุณาพิมพ์รหัสหรือชื่อสินค้า' });
    try { res.json({ products: (await pool.query(productSearchSql, [q])).rows }); }
    catch (error) { queryError(res, error, 'product search'); }
  });

  app.get('/api/customer-stock/movement', async (req, res) => {
    const code = text(req.query.code);
    if (!code) return res.status(400).json({ error: 'กรุณาเลือกสินค้า' });
    try {
      const product = (await pool.query(productInfoSql, [code])).rows[0];
      if (!product) return res.status(404).json({ error: 'ไม่พบสินค้ารหัสนี้ในทะเบียน' });
      const moves = (await pool.query(movementSql, [code])).rows;
      const last = moves.at(-1);
      res.json({
        product, moves: moves.slice().reverse(), cycles: stockCycles(moves),
        computedBalance: last ? last.balance : null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) { queryError(res, error, 'movement'); }
  });
}
