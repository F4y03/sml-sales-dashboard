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
  SELECT d.item_code, d.item_name, d.wh_code, d.unit_code, d.qty, d.sum_amount
  FROM ic_trans_detail d
  WHERE d.trans_flag = $3::integer AND d.last_status = 0
    AND d.doc_date >= $1::date AND d.doc_date < $2::date + INTERVAL '1 day'
    AND d.item_code <> ''
), warehouses AS (
  SELECT COALESCE(NULLIF(wh_code, ''), 'ไม่ระบุคลัง') AS name, SUM(sum_amount) AS sales
  FROM details GROUP BY 1
), products AS (
  SELECT item_code AS code, MAX(item_name) AS name, unit_code AS unit,
         SUM(qty) AS quantity, SUM(sum_amount) AS sales
  FROM details WHERE NULLIF(item_code, '') IS NOT NULL
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
  'products', COALESCE((SELECT json_agg(p ORDER BY sales DESC) FROM (SELECT * FROM products ORDER BY sales DESC, code, unit LIMIT 20) p), '[]'::json)
) AS dashboard;
