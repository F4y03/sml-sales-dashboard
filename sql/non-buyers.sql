WITH period_sales AS (
  SELECT DISTINCT COALESCE(cust_code, '') AS code
  FROM ic_trans
  WHERE doc_date >= $1::date AND doc_date < $2::date + INTERVAL '1 day'
    AND trans_flag = 44 AND last_status = 0 AND is_doc_copy = 0
), last_sales AS (
  SELECT COALESCE(cust_code, '') AS code, MAX(doc_date) AS last_purchased
  FROM ic_trans
  WHERE doc_date <= $2::date AND trans_flag = 44 AND last_status = 0 AND is_doc_copy = 0
  GROUP BY COALESCE(cust_code, '')
)
SELECT json_build_object('nonBuyers', COALESCE((
  SELECT json_agg(customer ORDER BY customer.code) FROM (
    SELECT r.code, COALESCE(NULLIF(MAX(r.name_1), ''), r.code) AS name,
      TO_CHAR(MAX(s.last_purchased), 'YYYY-MM-DD') AS "lastPurchased",
      CASE WHEN MAX(s.last_purchased) IS NULL THEN NULL ELSE ($2::date - MAX(s.last_purchased))::integer END AS "daysSincePurchase"
    FROM ar_customer r
    LEFT JOIN last_sales s ON s.code = r.code
    WHERE NULLIF(BTRIM(r.code), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM period_sales p WHERE p.code = r.code)
    GROUP BY r.code
  ) customer
), '[]'::json)) AS insights;
