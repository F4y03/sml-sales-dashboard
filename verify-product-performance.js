import pg from 'pg';
import assert from 'node:assert/strict';
import { catalogSql, buyersSql, previousPeriod } from './product-performance.js';

const pool = new pg.Pool({ connectionTimeoutMillis: 5000, statement_timeout: 30000, options: '-c default_transaction_read_only=on' });
const near = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - Number(expected)) < .005, label);
const fixture = `WITH ic_trans(doc_no,doc_date,trans_flag,cust_code,branch_code,last_status,is_doc_copy) AS (VALUES
  ('H1','2026-09-01'::date,44,'C1','',0,0),('H2','2026-09-02'::date,44,'C2','B1',0,0),
  ('H3','2026-09-03'::date,44,'C1','B1',0,0),('R1','2026-09-04'::date,48,'C1',NULL,0,0),
  ('R2','2026-09-05'::date,48,'C1','B1',0,0),('V1','2026-08-30'::date,44,'C1','B1',0,0),
  ('COPY','2026-09-01'::date,44,'C1','B1',0,1),('CANCEL','2026-09-01'::date,44,'C1','B1',1,0),
  ('OUTSIDE','2026-09-10'::date,44,'C1','B1',0,0)
), ic_inventory(code,name_1,group_main,balance_qty,unit_standard) AS (VALUES
  ('P1','Product one','G1',5,'piece'),('P1','Product one','G1',5,'piece'),('P2','Product two','G2',10,'piece'),
  ('P3','Returns only','G1',20,'piece'),('P4','Zero value sale','G1',30,'piece'),('P5','No sales','G1',100,'piece'),('P6','Previously sold','G1',40,'piece')
), ic_group(code,name_1) AS (VALUES ('G1','Category one'),('G1','Category one'),('G2','Category two')),
ar_customer(code,name_1) AS (VALUES ('C1','Customer one'),('C1','Customer one'),('C2','Customer two')),
ic_trans_detail(doc_no,doc_date,trans_flag,cust_code,branch_code,item_code,item_name,unit_code,qty,sum_amount,last_status,is_doc_copy) AS (VALUES
  ('H1','2026-09-01'::date,44,'C1','000','P1','Product one','piece',2,100,0,0),
  ('H1','2026-09-01'::date,44,'C1','000','P1','Product one','piece',1,25,0,0),
  ('H1','2026-09-01'::date,44,'C1','000','P1','Product one','box',1,200,0,0),
  ('H2','2026-09-02'::date,44,'C2','B1','P1','Product one','piece',1,75,0,0),
  ('R1','2026-09-04'::date,48,'C1','000','P1','Product one','piece',1,50,0,0),
  ('H3','2026-09-03'::date,44,'C1','B1','P2','Product two','piece',1,10,0,0),
  ('H3','2026-09-03'::date,44,'C1','B1','P4','Zero value sale','piece',5,0,0,0),
  ('R2','2026-09-05'::date,48,'C1','B1','P3','Returns only','piece',1,20,0,0),
  ('V1','2026-08-30'::date,44,'C1','B1','P1','Product one','piece',8,800,0,0),
  ('V1','2026-08-30'::date,44,'C1','B1','P3','Returns only','piece',2,40,0,0),
  ('V1','2026-08-30'::date,44,'C1','B1','P6','Previously sold','piece',5,100,0,0),
  ('H1','2026-09-01'::date,44,'C1','000','NEW','Unregistered','piece',1,50,0,0),
  ('H2','2026-09-02'::date,44,'C2','B2','P1','Wrong branch','piece',999,99999,0,0),
  ('H1','2026-09-01'::date,44,'C3','000','P1','Wrong customer','piece',999,99999,0,0),
  ('COPY','2026-09-01'::date,44,'C1','B1','P1','Copied header','piece',999,99999,0,0),
  ('CANCEL','2026-09-01'::date,44,'C1','B1','P1','Cancelled header','piece',999,99999,0,0),
  ('H2','2026-09-02'::date,44,'C2','B1','P1','Copied line','piece',999,99999,0,1),
  ('H2','2026-09-02'::date,44,'C2','B1','P1','Cancelled line','piece',999,99999,1,0),
  ('OUTSIDE','2026-09-10'::date,44,'C1','B1','P1','Outside period','piece',999,99999,0,0),
  ('ORPHAN','2026-09-01'::date,44,'C1','B1','P1','Missing header','piece',999,99999,0,0),
  ('H1','2026-09-01'::date,44,'C1','000','หมายเหตุ','Note','piece',999,99999,0,0)
), `;
const withFixture = sql => sql.replace(/\bWITH\s/, fixture);
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const params = ['2026-09-01','2026-09-09','2026-08-23','2026-08-31',null];
  const products = (await client.query(withFixture(catalogSql), params)).rows[0].insights.products;
  assert.equal(products.length, 7);
  const one = products.find(product => product.code === 'P1');
  assert.equal(one.net, 350); assert.equal(one.previousNet, 800); assert.equal(one.sales, 400); assert.equal(one.returns, 50);
  assert.equal(one.invoiceCount, 2); assert.equal(one.buyerCount, 2); assert.equal(one.lastSold, '2026-09-02');
  assert.deepEqual(one.quantities, [{unit:'box',net:1,sold:1,added:0,returned:0},{unit:'piece',net:3,sold:4,added:0,returned:1}]);
  assert.equal(products.find(p => p.code === 'P5').net, 0);
  assert.equal(products.find(p => p.code === 'P5').invoiceCount, 0);
  assert.equal(products.find(p => p.code === 'P6').previousNet, 100);
  assert.equal(products.find(p => p.code === 'P3').net, -20);
  assert.equal(products.find(p => p.code === 'P4').invoiceCount, 1);
  assert.equal(products.find(p => p.code === 'NEW').registered, false);
  const buyers = (await client.query(withFixture(buyersSql), [...params.slice(0,4),'P1'])).rows[0].insights;
  assert.equal(buyers.buyers.length, 2); assert.equal(buyers.buyers[0].net, 275); assert.equal(buyers.buyers[0].invoiceCount, 1);
  const none = (await client.query(withFixture(buyersSql), [...params.slice(0,4),'P5'])).rows[0].insights;
  assert.equal(none.product.stock, 100); assert.deepEqual(none.buyers, []);
  assert.equal((await client.query(withFixture(buyersSql), [...params.slice(0,4),"' OR 1=1 --"])).rows[0].insights.product, null);
  console.log('SQL fixtures passed: no-sale catalog, previous period, distinct bills/buyers, mixed units, returns, zero sales, duplicate masters, exclusions and blank header branches.');

  for (const [start,end] of [['2026-09-01','2026-09-09'],['2026-08-01','2026-08-31'],['1900-01-01','1900-01-02']]) {
    const previous = previousPeriod(start,end), values = [start,end,previous.start,previous.end,null];
    const all = (await client.query(catalogSql, values)).rows[0].insights.products;
    const expected = (await client.query(`SELECT d.item_code AS code, COALESCE(NULLIF(d.unit_code,''),'ไม่ระบุหน่วย') AS unit,
      SUM(CASE WHEN d.trans_flag=48 THEN -d.sum_amount ELSE d.sum_amount END) AS net,
      SUM(CASE WHEN d.trans_flag=48 THEN -d.qty ELSE d.qty END) AS quantity
      FROM ic_trans_detail d WHERE d.doc_date >= $1::date AND d.doc_date < $2::date + INTERVAL '1 day'
      AND d.trans_flag IN (44,46,48) AND d.last_status=0 AND d.is_doc_copy=0
      AND COALESCE(btrim(d.item_code),'') NOT IN ('','หมายเหตุ')
      AND EXISTS (SELECT 1 FROM ic_trans h WHERE h.doc_no=d.doc_no AND h.doc_date=d.doc_date AND h.trans_flag=d.trans_flag
        AND COALESCE(h.cust_code,'')=COALESCE(d.cust_code,'') AND h.last_status=0 AND h.is_doc_copy=0
        AND (NULLIF(btrim(h.branch_code),'') IS NULL OR h.branch_code=d.branch_code))
      GROUP BY d.item_code, COALESCE(NULLIF(d.unit_code,''),'ไม่ระบุหน่วย')`, [start,end])).rows;
    const byCode = new Map(all.map(product => [product.code,product]));
    assert.equal(byCode.size, all.length);
    near(all.reduce((sum,p)=>sum+p.net,0), expected.reduce((sum,p)=>sum+Number(p.net),0), 'all catalog sales equal actual lines');
    const nets = new Map();
    for (const row of expected) {
      const product=byCode.get(row.code); assert.ok(product,'actual product appears in catalog');
      near(product.quantities.find(q=>q.unit===row.unit)?.net,row.quantity,'quantity matches source unit');
      nets.set(row.code,(nets.get(row.code)||0)+Number(row.net));
    }
    for (const [code,net] of nets) near(byCode.get(code).net,net,'each product amount matches source');
    for (const product of all.slice(0,10)) {
      const detail=(await client.query(buyersSql,[...values.slice(0,4),product.code])).rows[0].insights;
      near(detail.product.net,product.net,'catalog/detail net');
      near(detail.buyers.reduce((sum,buyer)=>sum+buyer.net,0),product.net,'sum of buyer amounts');
      assert.equal(detail.buyers.filter(b=>b.invoiceCount>0).length,product.buyerCount);
      assert.equal(detail.buyers.reduce((sum,b)=>sum+b.invoiceCount,0),product.invoiceCount);
    }
    assert.ok(all.some(p=>p.registered&&p.invoiceCount===0),'registered products without sales must appear');
    console.log(`${start} to ${end}: ${all.length} products; ${expected.length} actual product/unit rows reconciled; Top 10 buyer amounts and invoice counts passed.`);
  }
  await client.query('ROLLBACK');
} catch (error) {
  console.error('Product performance verification failed:',error.code || error.message); process.exitCode=1;
} finally {
  if(client){await client.query('ROLLBACK').catch(()=>{});client.release();} await pool.end();
}
