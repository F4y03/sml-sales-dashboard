-- Aggregate headers independently of products so invoice counts and net totals are not multiplied.
-- Same net document definition as Executive Summary: sales + debit notes - returns/credit notes.
WITH customers AS (
  SELECT COALESCE(h.cust_code, '') AS code,
    COALESCE(NULLIF(MAX(c.name_1), ''), NULLIF(h.cust_code, ''), 'ไม่ระบุลูกค้า') AS name,
    COUNT(*) FILTER (WHERE h.trans_flag = 44) AS "invoiceCount",
    COALESCE(SUM(CASE WHEN h.trans_flag = 48 THEN -h.total_amount ELSE h.total_amount END), 0) AS net
  FROM ic_trans h
  LEFT JOIN (SELECT code, MAX(name_1) AS name_1 FROM ar_customer GROUP BY code) c ON c.code = h.cust_code
  WHERE h.doc_date >= $1::date AND h.doc_date < $2::date + INTERVAL '1 day'
    AND h.trans_flag IN (44, 46, 48) AND h.last_status = 0 AND h.is_doc_copy = 0
  GROUP BY COALESCE(h.cust_code, ''), h.cust_code
), consolidated AS (
  -- NULL and empty customer codes are one explicit, selectable unassigned group.
  SELECT code, MAX(name) AS name, SUM("invoiceCount") AS "invoiceCount", SUM(net) AS net
  FROM customers GROUP BY code
)
SELECT json_build_object(
  'customers', COALESCE((SELECT json_agg(c ORDER BY net DESC, code) FROM consolidated c), '[]'::json)
) AS insights;
