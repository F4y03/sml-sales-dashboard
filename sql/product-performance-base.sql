-- $1/$2 current inclusive dates, $3/$4 previous inclusive dates, $5 optional exact SKU.
WITH periods AS (
  SELECT 'current' AS period, $1::date AS start_date, $2::date AS end_date
  UNION ALL SELECT 'previous', $3::date, $4::date
), headers AS (
  SELECT p.period, h.doc_no, h.doc_date::date AS day, h.trans_flag, COALESCE(h.cust_code, '') AS customer_code, h.branch_code
  FROM periods p JOIN ic_trans h ON h.doc_date >= p.start_date AND h.doc_date < p.end_date + INTERVAL '1 day'
  WHERE h.trans_flag IN (44,46,48) AND h.last_status = 0 AND h.is_doc_copy = 0
), lines AS (
  SELECT p.period, d.doc_no, d.doc_date::date AS day, d.trans_flag, d.item_code AS code, d.item_name AS name,
    COALESCE(d.cust_code, '') AS customer_code, COALESCE(NULLIF(d.unit_code, ''), 'ไม่ระบุหน่วย') AS unit,
    COALESCE(d.qty, 0) AS quantity, COALESCE(d.sum_amount, 0) AS amount,
    CASE WHEN d.trans_flag = 48 THEN -1 ELSE 1 END AS direction
  FROM periods p JOIN ic_trans_detail d ON d.doc_date >= p.start_date AND d.doc_date < p.end_date + INTERVAL '1 day'
  WHERE d.trans_flag IN (44,46,48) AND d.last_status = 0 AND d.is_doc_copy = 0
    AND COALESCE(btrim(d.item_code), '') NOT IN ('', 'หมายเหตุ')
    AND ($5::text IS NULL OR d.item_code = $5)
    AND EXISTS (SELECT 1 FROM headers h WHERE h.period = p.period AND h.doc_no = d.doc_no AND h.day = d.doc_date::date
      AND h.trans_flag = d.trans_flag AND h.customer_code = COALESCE(d.cust_code, '')
      AND (NULLIF(btrim(h.branch_code), '') IS NULL OR h.branch_code = d.branch_code))
), inventory AS (
  SELECT code, MAX(name_1) AS name, MAX(group_main) AS category_code, MAX(balance_qty) AS stock, MAX(unit_standard) AS stock_unit
  FROM ic_inventory WHERE COALESCE(btrim(code), '') NOT IN ('', 'หมายเหตุ') AND ($5::text IS NULL OR code = $5)
  GROUP BY code
), codes AS (
  SELECT code FROM inventory UNION SELECT code FROM lines
), totals AS (
  SELECT code, MAX(name) AS name,
    COALESCE(SUM(direction * amount) FILTER (WHERE period = 'current'), 0) AS net,
    COALESCE(SUM(direction * amount) FILTER (WHERE period = 'previous'), 0) AS previous_net,
    COALESCE(SUM(amount) FILTER (WHERE period = 'current' AND trans_flag = 44), 0) AS sales,
    COALESCE(SUM(amount) FILTER (WHERE period = 'current' AND trans_flag = 46), 0) AS added,
    COALESCE(SUM(amount) FILTER (WHERE period = 'current' AND trans_flag = 48), 0) AS returns,
    COUNT(DISTINCT (doc_no, day, customer_code)) FILTER (WHERE period = 'current' AND trans_flag = 44) AS invoice_count,
    COUNT(DISTINCT customer_code) FILTER (WHERE period = 'current' AND trans_flag = 44) AS buyer_count,
    MAX(day) FILTER (WHERE period = 'current' AND trans_flag = 44) AS last_sold
  FROM lines GROUP BY code
), unit_totals AS (
  SELECT code, unit, SUM(direction * quantity) AS net,
    COALESCE(SUM(quantity) FILTER (WHERE trans_flag = 44), 0) AS sold,
    COALESCE(SUM(quantity) FILTER (WHERE trans_flag = 46), 0) AS added,
    COALESCE(SUM(quantity) FILTER (WHERE trans_flag = 48), 0) AS returned
  FROM lines WHERE period = 'current' GROUP BY code, unit
), unit_json AS (
  SELECT code, json_agg(json_build_object('unit', unit, 'net', net, 'sold', sold, 'added', added, 'returned', returned) ORDER BY unit) AS quantities
  FROM unit_totals GROUP BY code
), catalog AS (
  SELECT c.code, COALESCE(NULLIF(i.name, ''), NULLIF(t.name, ''), c.code) AS name,
    COALESCE(i.category_code, '') AS "categoryCode",
    COALESCE(NULLIF(g.name_1, ''), NULLIF(i.category_code, ''), 'ไม่ระบุหมวดหมู่') AS category,
    i.code IS NOT NULL AS registered, i.stock, COALESCE(NULLIF(i.stock_unit, ''), 'ไม่ระบุหน่วย') AS "stockUnit",
    COALESCE(t.net, 0) AS net, COALESCE(t.previous_net, 0) AS "previousNet",
    COALESCE(t.sales, 0) AS sales, COALESCE(t.added, 0) AS added, COALESCE(t.returns, 0) AS returns,
    COALESCE(t.invoice_count, 0) AS "invoiceCount", COALESCE(t.buyer_count, 0) AS "buyerCount",
    to_char(t.last_sold, 'YYYY-MM-DD') AS "lastSold", COALESCE(u.quantities, '[]'::json) AS quantities
  FROM codes c LEFT JOIN inventory i ON i.code = c.code LEFT JOIN totals t ON t.code = c.code
  LEFT JOIN unit_json u ON u.code = c.code
  LEFT JOIN (SELECT code, MAX(name_1) AS name_1 FROM ic_group GROUP BY code) g ON g.code = i.category_code
)
