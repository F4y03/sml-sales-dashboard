import fs from 'node:fs/promises';
import pg from 'pg';
import {createAccessStore} from '../src/models/accessStore.js';
import {normalizeImageLink} from '../product-images.js';
const root='product-drive-transfer';
const products=JSON.parse(await fs.readFile(`${root}/lazada-recovered-gallery.json`,'utf8'));
const receipts=JSON.parse(await fs.readFile(`${root}/lazada-drive-receipts-complete.json`,'utf8'));
const byUrl=new Map(receipts.map(r=>[r.source_url,r]));
// Reviewed against the product images and SML names; BW-446 is split by pictured colour.
const decisions=[
 {id:'16225459952',code:'906NM08',term:'ฟองน้ำสวมหัวไมค์'},
 {id:'16227828394',code:'906NM07',term:'แผ่นสวมกันไมค์กลิ้ง (ไมค์สาย)'},
 {id:'16227754912',code:'907LCD81',term:'LCD-81',note:'Photo 40-75 inches; SML name 30-75 inches. Same BEST model; SML unchanged.'},
 {id:'16227754973',code:'907LCD33',term:'LCD-33',note:'Photo 17-40 inches; SML name 17-37 inches. Same BEST model; SML unchanged.'},
 {id:'16227015832',code:'907LCD99',term:'LCD-99',note:'Photo 32-65 inches; SML name 32-55 inches. Same BEST model; SML unchanged.'},
 {id:'16227638583',code:'901BW446BL',term:'BW-446BL',image:'b05e3319913cb7555146b0510cfd851e',note:'Blue-only photo selected. Artwork 150W; SML/listing 120W; SML unchanged.'},
 {id:'16227638583',code:'901BW446R',term:'BW-446R',image:'b26b0842358a2b3589ad1add21a93e97',note:'Red-only photo selected. Artwork 150W; SML/listing 120W; SML unchanged.'}
];
const pool=new pg.Pool({max:1,connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on'});
let names;try{const {rows}=await pool.query('SELECT code,name_1 FROM ic_inventory WHERE code=ANY($1::text[])',[decisions.map(d=>d.code)]);names=new Map(rows.map(r=>[r.code,r.name_1]));}finally{await pool.end();}
const ready=decisions.map(d=>{
 if(!names.get(d.code)?.includes(d.term))throw new Error('SML identity changed: '+d.code);
 const p=products.find(p=>p.productUrl.includes('-i'+d.id+'.'));if(!p)throw new Error('Missing source');
 const images=p.images.filter(url=>!d.image||url.includes(d.image));
 if(!images.length)throw new Error('Missing selected image');
 const links=[...new Set(images.map(url=>{const r=byUrl.get(url);const n=normalizeImageLink(r?.drive_url);if(!n.ok||n.driveId!==r.drive_id)throw new Error('Invalid receipt');return n.value;}))];
 return {...d,name:names.get(d.code),source:p.productUrl,images,links};
});
const store=createAccessStore('data/access.sqlite');
try{
 const changed=ready.filter(p=>store.get('SELECT links_json FROM product_images WHERE code=?',p.code)?.links_json!==JSON.stringify(p.links));
 const report={mode:process.argv.includes('--apply')?'applied':'dry-run',listings:new Set(ready.map(p=>p.id)).size,codes:ready.length,changed:changed.length,links:ready.reduce((n,p)=>n+p.links.length,0)};
 if(process.argv.includes('--apply')){
  const backup={products:ready.map(p=>store.get('SELECT * FROM product_images WHERE code=?',p.code)),pending:store.all('SELECT * FROM unmatched_product_images'),decisions:ready};
  await fs.writeFile(`${root}/lazada-final-backup-${Date.now()}.json`,JSON.stringify(backup,null,2));
  store.transaction(()=>{
   for(const p of ready){
    if(changed.includes(p))store.run('INSERT INTO product_images VALUES(?,?,NULL,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json,updated_at=excluded.updated_at',p.code,JSON.stringify(p.links),new Date().toISOString());
    store.run('INSERT INTO product_image_imports VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET product_name=excluded.product_name,source_name=excluded.source_name,updated_at=excluded.updated_at',p.code,p.name,'Lazada visually reviewed',0,new Date().toISOString());
   }
   for(const source of new Set(ready.map(p=>p.source)))store.run('DELETE FROM unmatched_product_images WHERE source_url=?',source);
   store.run("INSERT INTO activity_logs(user_id,action,module,details) VALUES(NULL,'product_images.resolve','products',?)",JSON.stringify({report,decisions:ready}));
  });
  for(const p of ready)if(store.get('SELECT links_json FROM product_images WHERE code=?',p.code)?.links_json!==JSON.stringify(p.links))throw new Error('Verification failed');
  report.remaining=store.get('SELECT count(*) AS n FROM unmatched_product_images').n;
  await fs.writeFile(`${root}/lazada-final-resolution.json`,JSON.stringify({report,decisions:ready},null,2));
 }
 console.log(JSON.stringify(report));
}finally{store.close();}
