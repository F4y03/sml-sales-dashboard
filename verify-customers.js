import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const customerSql = await readFile(new URL('./sql/customer-insights.sql', import.meta.url), 'utf8');
const productSql = await readFile(new URL('./sql/customer-products.sql', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 30000, options: '-c default_transaction_read_only=on' });
const closeEnough = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - Number(expected)) < .005, label);

// CTEs shadow real tables for edge cases. This executes the production SQL without creating or changing database objects.
const fixtures = `WITH
ic_trans(doc_no,doc_date,trans_flag,cust_code,branch_code,total_amount,last_status,is_doc_copy) AS (VALUES
  ('H1','2026-09-01'::date,44,'C1','',100,0,0),
  ('H2','2026-09-02'::date,44,'C1','B1',200,0,0),
  ('H3','2026-09-03'::date,46,'C1',NULL,50,0,0),
  ('H4','2026-09-04'::date,48,'C1','B1',25,0,0),
  ('H5','2026-09-05'::date,44,'C1','B1',999,1,0),
  ('H6','2026-09-05'::date,44,'C1','B1',999,0,1),
  ('H7','2026-08-31'::date,44,'C1','B1',888,0,0),
  ('H1','2026-09-01'::date,44,'C2','B1',100000,0,0),
  ('H9','2026-09-09'::date,48,'C1','B1',10,0,0),
  ('U1','2026-09-01'::date,44,NULL,'B1',10,0,0),
  ('U2','2026-09-02'::date,44,'','B1',20,0,0)
), ar_customer(code,name_1) AS (VALUES ('C1','Customer one'),('C1','Customer one'),('C2','Customer two')),
ic_inventory(code,name_1,group_main) AS (VALUES ('P1','Product one','G1'),('P1','Product one','G1'),('P2','Product two','G2')),
ic_group(code,name_1) AS (VALUES ('G1','Same category name'),('G1','Same category name'),('G2','Same category name')),
ic_trans_detail(doc_no,doc_date,trans_flag,cust_code,branch_code,item_code,item_name,unit_code,qty,sum_amount,last_status,is_doc_copy) AS (VALUES
  ('H1','2026-09-01'::date,44,'C1','B1','P1','Product one','piece',2,40,0,0),
  ('H1','2026-09-01'::date,44,'C1','B1','P2','Product two','piece',3,60,0,0),
  ('H2','2026-09-02'::date,44,'C1','B1','P1','Product one','box',1,200,0,0),
  ('H3','2026-09-03'::date,46,'C1','B1','P1','Product one','piece',1,50,0,0),
  ('H4','2026-09-04'::date,48,'C1','B1','P2','Product two','piece',1,25,0,0),
  ('H5','2026-09-05'::date,44,'C1','B1','P1','Cancelled','piece',999,999,0,0),
  ('H6','2026-09-05'::date,44,'C1','B1','P1','Copied header','piece',999,999,0,0),
  ('H7','2026-08-31'::date,44,'C1','B1','P1','Outside period','piece',888,888,0,0),
  ('H1','2026-09-01'::date,44,'C2','B1','P1','Other customer','piece',1000,100000,0,0),
  ('H9','2026-09-09'::date,48,'C1','B1','P3','Unregistered return','piece',1,10,0,0),
  ('H1','2026-09-01'::date,44,'C1','B1','P1','Copied line','piece',999,999,0,1),
  ('H1','2026-09-01'::date,44,'C1','B1','P1','Cancelled line','piece',999,999,1,0),
  ('H2','2026-09-02'::date,44,'C1','B2','P1','Wrong branch','piece',999,999,0,0),
  ('H1','2026-09-01'::date,44,'C1','B1','หมายเหตุ','Note','piece',999,999,0,0),
  ('H1','2026-09-01'::date,44,'C1','B1','','Blank','piece',999,999,0,0),
  ('ORPHAN','2026-09-01'::date,44,'C1','B1','P1','Orphan line','piece',999,999,0,0),
  ('U1','2026-09-01'::date,44,NULL,'B1','P1','Product one','piece',1,10,0,0),
  ('U2','2026-09-02'::date,44,'','B1','P1','Product one','piece',2,20,0,0)
), `;
const withFixtures = sql => sql.replace(/\bWITH\s/, fixtures);

let client;
try {
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const params = ['2026-09-01', '2026-09-09'];
  const fixtureCustomers = (await client.query(withFixtures(customerSql), params)).rows[0].insights.customers;
  assert.equal(fixtureCustomers.length, 3);
  assert.deepEqual(fixtureCustomers.find(customer => customer.code === 'C1'), { code: 'C1', name: 'Customer one', invoiceCount: 2, net: 315 });
  assert.deepEqual(fixtureCustomers.find(customer => customer.code === ''), { code: '', name: 'ไม่ระบุลูกค้า', invoiceCount: 2, net: 30 });
  const fixtureDetail = (await client.query(withFixtures(productSql), [...params, 'C1'])).rows[0].insights;
  assert.equal(fixtureDetail.itemNet, 315);
  assert.equal(fixtureDetail.products.length, 4);
  assert.equal(fixtureDetail.categories.length, 3, 'category identity must use codes, even when names match');
  assert.deepEqual(fixtureDetail.products.find(product => product.code === 'P1' && product.unit === 'piece'), {
    code: 'P1', name: 'Product one', categoryCode: 'G1', category: 'Same category name', unit: 'piece', quantity: 3, total: 90, lastPurchased: '2026-09-01'
  });
  const returned = fixtureDetail.products.find(product => product.code === 'P3');
  assert.equal(returned.quantity, -1);
  assert.equal(returned.total, -10);
  assert.equal(returned.lastPurchased, null);
  const unassigned = (await client.query(withFixtures(productSql), [...params, ''])).rows[0].insights;
  assert.equal(unassigned.customer.net, 30);
  assert.equal(unassigned.itemNet, 30);
  assert.equal((await client.query(withFixtures(productSql), [...params, "' OR 1=1 --"])).rows[0].insights.customer, null);
  console.log('Production SQL edge cases passed: blank/null header branches, explicit branch mismatch, returns, units, duplicate masters, dates, exclusions, customer isolation, unassigned customer and literal codes.');

  for (const [start, end] of [['2026-09-01', '2026-09-09'], ['2026-08-01', '2026-08-31'], ['1900-01-01', '1900-01-02']]) {
    const data = (await client.query(customerSql, [start, end])).rows[0].insights;
    const original = (await client.query(`SELECT COALESCE(SUM(CASE WHEN trans_flag=48 THEN -total_amount ELSE total_amount END),0) AS net,
      COUNT(*) FILTER(WHERE trans_flag=44) AS bills FROM ic_trans
      WHERE doc_date >= $1::date AND doc_date < $2::date + INTERVAL '1 day'
      AND trans_flag IN (44,46,48) AND last_status=0 AND is_doc_copy=0`, [start, end])).rows[0];
    closeEnough(data.customers.reduce((sum, customer) => sum + customer.net, 0), original.net, 'customer totals must equal net document total');
    assert.equal(data.customers.reduce((sum, customer) => sum + customer.invoiceCount, 0), Number(original.bills));
    assert.equal(new Set(data.customers.map(customer => customer.code)).size, data.customers.length);
    let verifiedProducts = 0;
    for (const customer of data.customers.slice(0, 10)) {
      const detail = (await client.query(productSql, [start, end, customer.code])).rows[0].insights;
      closeEnough(detail.customer.net, customer.net, 'selected customer net');
      assert.equal(detail.customer.invoiceCount, customer.invoiceCount);
      closeEnough(detail.products.reduce((sum, product) => sum + product.total, 0), detail.itemNet, 'product totals');
      closeEnough(detail.categories.reduce((sum, category) => sum + category.total, 0), detail.itemNet, 'category totals');
      assert.ok(detail.products.every(product => product.lastPurchased === null || (product.lastPurchased >= start && product.lastPurchased <= end)));
      // Compare against actual document lines, not only the dashboard's own totals.
      // This catches a query that incorrectly returns zero products and zero category totals.
      const expected = (await client.query(`SELECT d.item_code AS code,
        COALESCE(NULLIF(d.unit_code,''),'ไม่ระบุหน่วย') AS unit,
        COALESCE(SUM(CASE WHEN d.trans_flag=48 THEN -d.qty ELSE d.qty END),0) AS quantity,
        COALESCE(SUM(CASE WHEN d.trans_flag=48 THEN -d.sum_amount ELSE d.sum_amount END),0) AS total,
        to_char(MAX(d.doc_date) FILTER(WHERE d.trans_flag=44),'YYYY-MM-DD') AS "lastPurchased"
        FROM ic_trans_detail d WHERE d.doc_date >= $1::date AND d.doc_date < $2::date + INTERVAL '1 day'
          AND d.trans_flag IN (44,46,48) AND d.last_status=0 AND d.is_doc_copy=0
          AND COALESCE(d.cust_code,'')=$3 AND COALESCE(btrim(d.item_code),'') NOT IN ('','หมายเหตุ')
          AND EXISTS (SELECT 1 FROM ic_trans h WHERE h.doc_no=d.doc_no AND h.doc_date=d.doc_date
            AND h.trans_flag=d.trans_flag AND COALESCE(h.cust_code,'')=$3 AND h.last_status=0 AND h.is_doc_copy=0)
        GROUP BY d.item_code,COALESCE(NULLIF(d.unit_code,''),'ไม่ระบุหน่วย')`, [start, end, customer.code])).rows;
      assert.equal(detail.products.length, expected.length, 'product count must match actual document lines');
      for (const expectedProduct of expected) {
        const product = detail.products.find(item => item.code === expectedProduct.code && item.unit === expectedProduct.unit);
        assert.ok(product, 'actual purchased product must appear in drill-down');
        closeEnough(product.total, expectedProduct.total, 'actual product total');
        closeEnough(product.quantity, expectedProduct.quantity, 'actual product quantity');
        assert.equal(product.lastPurchased, expectedProduct.lastPurchased);
      }
      verifiedProducts += expected.length;
    }
    console.log(`${start} to ${end}: ${data.customers.length} customers, ${verifiedProducts} Top 10 product/unit rows; header totals, invoice counts, actual purchases and category totals passed.`);
  }
  await client.query('ROLLBACK');
} catch (error) {
  console.error('Customer verification failed:', error.code || error.message);
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  await pool.end();
}
