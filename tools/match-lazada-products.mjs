import fs from 'node:fs/promises'; import pg from 'pg';
const mapping=JSON.parse(await fs.readFile('product-drive-transfer/lazada-mapping-prepared.json','utf8'));
const pool=new pg.Pool({max:1,options:'-c default_transaction_read_only=on'});
const {rows}=await pool.query('SELECT code,name_1,name_eng_1,short_name,item_model FROM ic_inventory'); await pool.end();
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9ก-๙]+/gi,' ');
const result=mapping.products.map(p=>{const words=new Set(norm(p.name).split(/\s+/).filter(x=>x.length>=3));const ranked=rows.map(r=>{const text=norm([r.name_1,r.name_eng_1,r.short_name,r.item_model].join(' '));let score=0;for(const w of words)if(text.includes(w))score++;return {code:r.code,name:r.name_1,score};}).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score).slice(0,5);return {name:p.name,candidates:ranked};});
await fs.writeFile('product-drive-transfer/lazada-unmatched-candidates.json',JSON.stringify(result,null,2));console.log(JSON.stringify({products:result.length,withCandidates:result.filter(x=>x.candidates.length).length}));
