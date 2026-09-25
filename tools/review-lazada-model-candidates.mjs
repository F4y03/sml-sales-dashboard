import fs from 'node:fs/promises';
import pg from 'pg';
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync('data/access.sqlite',{readOnly:true});
const pending=db.prepare('SELECT source_url,source_id,product_name,links_json FROM unmatched_product_images').all();db.close();
const pool=new pg.Pool({max:1,options:'-c default_transaction_read_only=on'});
let rows;try{({rows}=await pool.query('SELECT code,name_1 FROM ic_inventory WHERE left(code,1) <> $1',['ฝ']));}finally{await pool.end();}
const models=s=>[...s.toUpperCase().matchAll(/\b[A-Z]{1,5}-\d+[A-Z]*\b/g)].map(m=>m[0]);
const result=pending.map(p=>{const tokens=models(p.product_name);const candidates=rows.filter(r=>models(r.name_1).some(t=>tokens.includes(t)));return {...p,models:tokens,candidates};});
await fs.writeFile('product-drive-transfer/lazada-model-review.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result.map(p=>({id:p.source_id,name:p.product_name,models:p.models,candidates:p.candidates})),null,2));
