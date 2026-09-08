import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const pool = new pg.Pool({ statement_timeout: 30000, connectionTimeoutMillis: 5000 });
const sql = await readFile(new URL('./sql/dashboard.sql', import.meta.url), 'utf8');
const xml = await readFile(new URL('./sml-report-4007.xml', import.meta.url), 'utf8');
// Extract only the reviewed SELECT from the saved native report (not its field-discovery query).
const native = xml.match(/<_query>\s*(select doc_date,[\s\S]*?)<\/_query>/i)[1]
  .replaceAll("'@from_date@'", '$1::text').replaceAll("'@to_date@'", '$2::text')
  .replaceAll("'@from_time@'", "''").replaceAll("'@to_time@'", "''");
const results = [];
const client = await pool.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for (const [start, end] of [['2026-09-01', '2026-09-07'], ['2026-08-01', '2026-08-31'], ['1900-01-01', '1900-01-02']]) {
    const data = (await client.query(sql, [start, end, 44])).rows[0].dashboard;
    const original = (await client.query(native, [start, end])).rows;
    const daily = new Map(original.map(row => {
      const d = row.doc_date;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return [key, Number(row.total_amount)];
    }));
    for (const d of data.daily) assert.ok(Math.abs(Number(d.sales) - (daily.get(d.day) || 0)) < .005, `Daily mismatch ${d.day}`);
    const nativeTotal = original.reduce((n,r) => n + Number(r.total_amount), 0);
    assert.ok(Math.abs(data.totalSales - nativeTotal) < .005, 'Native SML 4007 mismatch');
    const detail = (await client.query(`SELECT wh_code, SUM(sum_amount) AS amount FROM ic_trans_detail
      WHERE trans_flag=44 AND last_status=0 AND doc_date BETWEEN $1::date AND $2::date AND item_code<>'' GROUP BY wh_code`, [start,end])).rows;
    const detailTotal = detail.reduce((n,r) => n + Number(r.amount), 0);
    assert.ok(Math.abs(data.itemSales - detailTotal) < .005);
    assert.ok(Math.abs(data.warehouses.reduce((n,r)=>n+Number(r.sales),0) - detailTotal) < .005);
    for (const w of detail) {
      const actual = data.warehouses.find(r => r.name === (w.wh_code || 'ไม่ระบุคลัง'));
      assert.ok(actual && Math.abs(Number(actual.sales)-Number(w.amount)) < .005);
    }
    const products = (await client.query(`SELECT item_code AS code, unit_code AS unit, SUM(qty) AS quantity, SUM(sum_amount) AS sales
      FROM ic_trans_detail WHERE trans_flag=44 AND last_status=0 AND doc_date BETWEEN $1::date AND $2::date AND item_code<>''
      GROUP BY item_code,unit_code ORDER BY sales DESC,code,unit LIMIT 5`, [start,end])).rows;
    assert.deepEqual(data.products.map(p=>[p.code,p.unit,Number(p.quantity),Number(p.sales)]),products.map(p=>[p.code,p.unit,Number(p.quantity),Number(p.sales)]));
    results.push({ start,end,totalSales:data.totalSales,totalInvoices:data.totalInvoices,itemSales:data.itemSales,passed:true });
  }
  await client.query('ROLLBACK');
  await writeFile('verification-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), nativeReport:'4007', itemBasis:'4014', results }, null, 2));
  console.log(JSON.stringify(results));
} finally { client.release(); await pool.end(); }
