WITH periods AS (
  SELECT 'current' AS period, $1::date AS start_date, $2::date AS end_date
  UNION ALL SELECT 'previous', $3::date, $4::date
  UNION ALL SELECT 'year', $5::date, $6::date
), headers AS (
  SELECT p.period, h.doc_no, h.doc_date::date AS day, h.trans_flag,
    h.total_amount, CASE WHEN h.trans_flag = 48 THEN -1 ELSE 1 END AS direction
  FROM periods p JOIN ic_trans h ON h.doc_date >= p.start_date AND h.doc_date < p.end_date + INTERVAL '1 day'
  WHERE h.trans_flag IN (44,46,48) AND h.last_status = 0 AND h.is_doc_copy = 0
), lines AS (
  SELECT p.period, d.doc_no, d.doc_date::date AS day, d.trans_flag, d.item_code, d.item_name,
    d.branch_code, d.sale_code, d.sum_amount, d.sum_amount_exclude_vat AS revenue,
    CASE WHEN d.sum_of_cost IS NULL OR (d.sum_of_cost = 0 AND d.qty <> 0) THEN NULL ELSE abs(d.sum_of_cost) END AS cost,
    CASE WHEN d.trans_flag = 48 THEN -1 ELSE 1 END AS direction
  FROM periods p JOIN ic_trans_detail d ON d.doc_date >= p.start_date AND d.doc_date < p.end_date + INTERVAL '1 day'
  WHERE d.last_status = 0 AND EXISTS (
    SELECT 1 FROM headers h WHERE h.period = p.period AND h.doc_no = d.doc_no AND h.day = d.doc_date::date AND h.trans_flag = d.trans_flag
  )
), product_lines AS (
  SELECT * FROM lines WHERE btrim(item_code) <> 'หมายเหตุ' AND EXISTS (SELECT 1 FROM ic_inventory i WHERE i.code = lines.item_code)
), products AS (
  SELECT item_code AS code, MAX(item_name) AS name, SUM(direction * sum_amount) AS sales,
    CASE WHEN COUNT(*) FILTER (WHERE cost IS NULL OR revenue IS NULL) = 0 THEN SUM(direction * (revenue - cost)) END AS profit,
    SUM(direction * revenue) AS revenue
  FROM product_lines WHERE period = 'current' GROUP BY item_code ORDER BY sales DESC, code LIMIT 5
), branches AS (
  SELECT branch_code AS code, COALESCE(SUM(direction * sum_amount) FILTER (WHERE period = 'current'),0) AS sales,
    COALESCE(SUM(direction * sum_amount) FILTER (WHERE period = 'previous'),0) AS previous
  FROM lines WHERE period IN ('current','previous') GROUP BY branch_code
), staff AS (
  SELECT sale_code AS code, SUM(direction * sum_amount) AS sales FROM lines WHERE period = 'current' GROUP BY sale_code
), bills AS (
  SELECT h.doc_no AS "docNo", h.day AS date, h.trans_flag AS flag, h.total_amount AS total,
    (SELECT SUM(l.sum_amount) FROM lines l WHERE l.period = 'current' AND l.doc_no = h.doc_no AND l.day = h.day AND l.trans_flag = h.trans_flag) AS "lineTotal"
  FROM headers h WHERE h.period = 'current'
), unusual AS (
  SELECT *, abs(total - COALESCE("lineTotal",0)) AS difference FROM bills
  WHERE (total > 100000 AND total > (SELECT AVG(total) * 3 FROM bills WHERE flag = 44))
    OR abs(total - COALESCE("lineTotal",0)) > GREATEST(100, abs(total) * 0.05)
)
SELECT json_build_object(
  'net', (SELECT COALESCE(SUM(direction * total_amount),0) FROM headers WHERE period = 'current'),
  'sales', (SELECT COALESCE(SUM(total_amount),0) FROM headers WHERE period = 'current' AND trans_flag IN (44,46)),
  'returns', (SELECT COALESCE(SUM(total_amount),0) FROM headers WHERE period = 'current' AND trans_flag = 48),
  'previousNet', (SELECT COALESCE(SUM(direction * total_amount),0) FROM headers WHERE period = 'previous'),
  'yearNet', (SELECT COALESCE(SUM(direction * total_amount),0) FROM headers WHERE period = 'year'),
  'count', (SELECT COUNT(*) FROM bills),
  'salesInvoiceCount', (SELECT COUNT(*) FROM bills WHERE flag = 44),
  'averageSale', (SELECT AVG(total) FROM bills WHERE flag = 44),
  'profit', (SELECT CASE WHEN COUNT(*) > 0 AND COUNT(*) FILTER (WHERE cost IS NULL OR revenue IS NULL) = 0 THEN SUM(direction * (revenue - cost)) END FROM product_lines WHERE period = 'current'),
  'revenue', (SELECT SUM(direction * revenue) FROM product_lines WHERE period = 'current'),
  'products', COALESCE((SELECT json_agg(product) FROM (SELECT p.*, i.balance_qty AS stock, i.unit_standard AS unit FROM products p LEFT JOIN (SELECT code, MAX(balance_qty) balance_qty, MAX(unit_standard) unit_standard FROM ic_inventory GROUP BY code) i ON i.code = p.code ORDER BY p.sales DESC, p.code) product), '[]'::json),
  'branches', COALESCE((SELECT json_agg(branch) FROM (SELECT b.*, COALESCE((SELECT MAX(name_1) FROM erp_branch_list WHERE code = b.code),NULLIF(b.code,''),'ไม่ระบุสาขา') AS name FROM branches b ORDER BY sales DESC, code LIMIT 5) branch), '[]'::json),
  'declines', COALESCE((SELECT json_agg(branch) FROM (SELECT b.*, COALESCE((SELECT MAX(name_1) FROM erp_branch_list WHERE code = b.code),NULLIF(b.code,''),'ไม่ระบุสาขา') AS name FROM branches b WHERE previous > 0 AND sales < previous * 0.8 ORDER BY sales / previous LIMIT 20) branch), '[]'::json),
  'staff', COALESCE((SELECT json_agg(person) FROM (SELECT s.*, COALESCE((SELECT MAX(name_1) FROM erp_user WHERE code = s.code),NULLIF(s.code,''),'ไม่ระบุพนักงาน') AS name FROM staff s ORDER BY sales DESC, code LIMIT 5) person), '[]'::json),
  'bills', COALESCE((SELECT json_agg(bill) FROM (SELECT * FROM bills ORDER BY date DESC, "docNo" DESC LIMIT 100) bill), '[]'::json),
  'unusual', COALESCE((SELECT json_agg(bill) FROM (SELECT * FROM unusual ORDER BY total DESC LIMIT 20) bill), '[]'::json)
) AS summary;
