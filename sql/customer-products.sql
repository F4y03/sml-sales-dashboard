WITH headers AS (
  SELECT h.doc_no, h.doc_date::date AS day, h.trans_flag, h.branch_code, h.total_amount
  FROM ic_trans h
  WHERE h.doc_date >= $1::date AND h.doc_date < $2::date + INTERVAL '1 day'
    AND h.trans_flag IN (44, 46, 48) AND h.last_status = 0 AND h.is_doc_copy = 0
    AND COALESCE(h.cust_code, '') = $3::text
), inventory AS (
  SELECT code, MAX(name_1) AS name, MAX(group_main) AS category_code
  FROM ic_inventory GROUP BY code
), product_lines AS (
  SELECT d.item_code AS code, COALESCE(NULLIF(d.item_name, ''), NULLIF(i.name, ''), d.item_code) AS name,
    COALESCE(i.category_code, '') AS category_code,
    COALESCE(NULLIF(g.name_1, ''), NULLIF(i.category_code, ''), 'ไม่ระบุหมวดหมู่') AS category,
    COALESCE(NULLIF(d.unit_code, ''), 'ไม่ระบุหน่วย') AS unit,
    d.qty, d.sum_amount, d.doc_date::date AS day, d.trans_flag,
    CASE WHEN d.trans_flag = 48 THEN -1 ELSE 1 END AS direction
  FROM ic_trans_detail d
  LEFT JOIN inventory i ON i.code = d.item_code
  LEFT JOIN (SELECT code, MAX(name_1) AS name_1 FROM ic_group GROUP BY code) g ON g.code = i.category_code
  WHERE d.doc_date >= $1::date AND d.doc_date < $2::date + INTERVAL '1 day'
    AND d.trans_flag IN (44, 46, 48) AND d.last_status = 0 AND d.is_doc_copy = 0
    AND COALESCE(d.cust_code, '') = $3::text
    AND COALESCE(btrim(d.item_code), '') NOT IN ('', 'หมายเหตุ')
    -- EXISTS prevents duplicate headers from multiplying product lines.
    AND EXISTS (SELECT 1 FROM headers h WHERE h.doc_no = d.doc_no AND h.day = d.doc_date::date
      AND h.trans_flag = d.trans_flag
      -- SML may leave the header branch blank while its lines carry branch 000.
      -- An unspecified header branch must not exclude the document's products.
      AND (NULLIF(btrim(h.branch_code), '') IS NULL OR h.branch_code = d.branch_code))
), products AS (
  -- Keep document units separate; a box must not be added to a single piece.
  SELECT code, MAX(name) AS name, category_code AS "categoryCode", MAX(category) AS category, unit,
    COALESCE(SUM(direction * qty), 0) AS quantity, COALESCE(SUM(direction * sum_amount), 0) AS total,
    to_char(MAX(day) FILTER (WHERE trans_flag = 44), 'YYYY-MM-DD') AS "lastPurchased"
  FROM product_lines GROUP BY code, category_code, unit
), categories AS (
  SELECT "categoryCode" AS code, MAX(category) AS name, SUM(total) AS total
  FROM products GROUP BY "categoryCode"
)
SELECT json_build_object(
  'customer', (SELECT json_build_object('code', $3::text,
    'name', COALESCE(NULLIF((SELECT MAX(name_1) FROM ar_customer WHERE code = $3::text), ''), NULLIF($3::text, ''), 'ไม่ระบุลูกค้า'),
    'invoiceCount', COUNT(*) FILTER (WHERE trans_flag = 44),
    'net', COALESCE(SUM(CASE WHEN trans_flag = 48 THEN -total_amount ELSE total_amount END), 0))
    FROM headers HAVING COUNT(*) > 0),
  'products', COALESCE((SELECT json_agg(p ORDER BY total DESC, code, unit) FROM products p), '[]'::json),
  'categories', COALESCE((SELECT json_agg(c ORDER BY total DESC, code) FROM categories c), '[]'::json),
  'itemNet', (SELECT COALESCE(SUM(total), 0) FROM products)
) AS insights;
