export function installSalesTrend(app, pool) {
  app.get('/api/sales-trend', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (typeof req.query.year !== 'string' || !/^\d{4}$/.test(req.query.year) || Number(req.query.year) < 1900 || Number(req.query.year) > 2100) {
      return res.status(400).json({ error: 'กรุณาเลือกปีให้ถูกต้อง' });
    }
    const year = Number(req.query.year);
    try {
      const { rows } = await pool.query(`
        WITH monthly AS (
          SELECT EXTRACT(MONTH FROM doc_date)::int AS month, SUM(total_amount) AS sales
          FROM ic_trans
          WHERE doc_date >= $1::date AND doc_date < $2::date
            AND trans_flag = 44 AND last_status = 0
            AND to_timestamp(doc_date::date || ' ' || doc_time, 'YYYY/MM/DD HH24:MI')::timestamp
                BETWEEN $1::date::timestamp AND ($2::date - 1) + TIME '23:59'
          GROUP BY 1
        ) SELECT m AS month, COALESCE(sales, 0)::float8 AS sales
          FROM generate_series(1,12) m LEFT JOIN monthly ON month = m ORDER BY m
      `, [`${year}-01-01`, `${year + 1}-01-01`]);
      res.json({ year, months: rows, updatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Monthly sales query failed:', error.code);
      res.status(503).json({ error: 'โหลดยอดขายรายเดือนไม่สำเร็จ กรุณาลองใหม่' });
    }
  });
}
