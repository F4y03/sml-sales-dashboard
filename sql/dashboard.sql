-- Verified against stored SML reports 4007 (document totals) and 4014 (item sales).
-- Parameters: $1 start date, $2 end date (inclusive), $3 sales transaction flag.
-- Header totals are deliberately aggregated separately from detail lines to avoid multiplying invoices.
WITH headers AS (
  SELECT doc_no, doc_date::date AS day, trans_flag, total_amount
  FROM ic_trans
  WHERE doc_date >= $1::date AND doc_date < $2::date + INTERVAL '1 day'
    AND trans_flag = $3::integer AND last_status = 0
    AND to_timestamp(doc_date::date || ' ' || doc_time, 'YYYY/MM/DD HH24:MI')::timestamp
        BETWEEN $1::date::timestamp AND $2::date + TIME '23:59'
), details AS (
  SELECT d.doc_no, d.doc_date, d.trans_flag, d.item_code, d.item_name, d.wh_code, d.unit_code, d.qty, d.sum_amount
  FROM ic_trans_detail d
  WHERE d.trans_flag = $3::integer AND d.last_status = 0
    AND d.doc_date >= $1::date AND d.doc_date < $2::date + INTERVAL '1 day'
    AND d.item_code <> ''
), warehouses AS (
  SELECT COALESCE(NULLIF(wh_code, ''), 'ไม่ระบุคลัง') AS name, SUM(sum_amount) AS sales
  FROM details GROUP BY 1
), product_lines AS (
  SELECT d.*
  FROM details d
  WHERE EXISTS (SELECT 1 FROM headers h WHERE h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag AND h.day = d.doc_date::date)
    AND EXISTS (SELECT 1 FROM ic_inventory i WHERE i.code = d.item_code)
    AND btrim(d.item_code) <> 'หมายเหตุ'
), product_documents AS (
  SELECT item_code, unit_code, doc_no, doc_date::date AS day,
         SUM(qty) AS quantity, SUM(sum_amount) AS sales
  FROM product_lines WHERE sum_amount > 0
  GROUP BY item_code, unit_code, doc_no, doc_date::date
), products AS (
  SELECT item_code AS code, MAX(item_name) AS name, unit_code AS unit,
         SUM(qty) AS quantity, SUM(sum_amount) AS sales
  FROM product_lines WHERE sum_amount > 0
  GROUP BY item_code, unit_code
), ranked_products AS (
  SELECT p.*, (SELECT json_agg(json_build_object('docNo', d.doc_no, 'date', to_char(d.day, 'YYYY-MM-DD'), 'quantity', d.quantity, 'sales', d.sales) ORDER BY d.day, d.doc_no)
    FROM product_documents d WHERE d.item_code = p.code AND d.unit_code IS NOT DISTINCT FROM p.unit) AS invoices
  FROM products p ORDER BY sales DESC, code, unit
), other_products AS (
  SELECT item_code AS code, MAX(item_name) AS name, unit_code AS unit,
         SUM(qty) AS quantity, SUM(sum_amount) AS sales
  FROM product_lines WHERE sum_amount <= 0 OR sum_amount IS NULL
  GROUP BY item_code, unit_code
), daily AS (
  SELECT s.day::date AS day, COALESCE(SUM(h.total_amount), 0) AS sales
  FROM generate_series($1::date, $2::date, INTERVAL '1 day') s(day)
  LEFT JOIN headers h ON h.day = s.day::date GROUP BY s.day
)
SELECT json_build_object(
  'totalSales', (SELECT COALESCE(SUM(total_amount), 0) FROM headers),
  'totalInvoices', (SELECT COUNT(*) FROM headers),
  'itemSales', (SELECT COALESCE(SUM(sum_amount), 0) FROM details),
  'database', current_database(),
  'period', json_build_object('start', $1::text, 'end', $2::text),
  'warehouses', COALESCE((SELECT json_agg(w ORDER BY sales DESC) FROM warehouses w), '[]'::json),
  'daily', COALESCE((SELECT json_agg(json_build_object('day', to_char(day, 'YYYY-MM-DD'), 'sales', sales) ORDER BY day) FROM daily), '[]'::json),
  'products', COALESCE((SELECT json_agg(p ORDER BY sales DESC, code, unit) FROM ranked_products p), '[]'::json),
  'otherProducts', COALESCE((SELECT json_agg(p ORDER BY code, unit) FROM other_products p), '[]'::json),
  'unregisteredItems', COALESCE((SELECT json_agg(p ORDER BY code, unit) FROM (
    SELECT item_code AS code, MAX(item_name) AS name, unit_code AS unit, SUM(qty) AS quantity, SUM(sum_amount) AS sales
    FROM details d WHERE btrim(d.item_code) = 'หมายเหตุ' OR NOT EXISTS (SELECT 1 FROM ic_inventory i WHERE i.code = d.item_code)
    GROUP BY item_code, unit_code
  ) p), '[]'::json)
) AS dashboard;
