// Read-only checks against SML. No users, tables or fixtures are written to SML.
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { scopeQuery,accessContext,createScopedPool } from './src/services/territoryService.js';
import { movementsSQL } from './consignment.js';
import { analyticsQuery } from './analytics.js';
import { installProducts } from './products.js';
import { installProductPerformance } from './product-performance.js';
const pool=new pg.Pool({connectionTimeoutMillis:5000,statement_timeout:30000,max:1,options:'-c default_transaction_read_only=on'});
const territory={id:1,mapping:{teams:['หย'],customerCodes:[],consignmentPrefixes:['ฝหย']}};
const execute=(sql,values=[],module='customer_analysis')=>{const q=scopeQuery(sql,values,{territory,module});return pool.query(q.text,q.values);};
try {
  for(const [file,params] of [
    ['dashboard.sql',['2026-09-01','2026-09-16',44]],
    ['customer-insights.sql',['2026-09-01','2026-09-16']],
    ['non-buyers.sql',['2026-09-01','2026-09-16']],
    ['executive.sql',['2026-09-01','2026-09-16','2026-08-01','2026-08-16','2025-09-01','2025-09-16']],
  ]){const sql=await readFile(new URL('./sql/'+file,import.meta.url),'utf8');const r=await execute(sql,params);assert.ok(r.rows.length);console.log(file+': scoped query OK');}
  await execute(analyticsQuery('net'),['2026-09-01','2026-09-16']);
  const stock=await execute('SELECT code FROM ic_inventory');assert.ok(stock.rows.every(r=>!r.code.startsWith('ฝ')||r.code.startsWith('ฝหย')));
  const deposits=await execute(movementsSQL,['ฝ%','^ฝ[^0-9]{2}[0-9]{3}'],'consignment');assert.ok(deposits.rows.every(r=>r.productCode.startsWith('ฝหย')));
  const headers=await execute('SELECT COUNT(*) AS n FROM ic_trans');
  const independent=await pool.query("SELECT COUNT(*) AS n FROM ic_trans WHERE regexp_replace(regexp_replace(btrim(COALESCE(sale_code,'')), '^ฝ', ''), '^กท-', 'ก')=ANY($1::text[])",[['หย']]);assert.equal(headers.rows[0].n,independent.rows[0].n);
  const empty=scopeQuery('SELECT COUNT(*) AS n FROM ic_trans',[],{territory:{mapping:{teams:[],customerCodes:[],consignmentPrefixes:[]}}});assert.equal((await pool.query(empty.text,empty.values)).rows[0].n,'0');
  console.log('Territory header counts match independent SQL; stock/deposits exclude other territories; empty mapping returns no transactions.');
  const routes=new Map(),app={get:(path,fn)=>routes.set(path,fn)},scopedPool=createScopedPool(pool);
  installProducts(app,scopedPool);installProductPerformance(app,scopedPool);
  for(const [path,query] of [
    ['/api/products',{}],['/api/products/export',{format:'json',scope:'all'}],
    ['/api/customer-insights/catalog',{start:'2026-09-01',end:'2026-09-16'}],
  ]){
    let status=200,result;const response={set(){return this;},status(n){status=n;return this;},json(value){result=value;return this;},send(value){result=typeof value==='string'?JSON.parse(value):value;return this;}};
    await accessContext.run({territory,module:path.startsWith('/api/products')?'price_stock':'product_analysis'},()=>routes.get(path)({query},response));
    assert.equal(status,200,path);const items=result.rows||result.products||[];assert.ok(items.every(p=>!String(p.code).startsWith('ฝ')||p.code.startsWith('ฝหย')),path);
    console.log(path+': scoped API/query OK');
  }
}finally{await pool.end();}
