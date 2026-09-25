import fs from 'node:fs/promises';
import pg from 'pg';
import {createAccessStore} from '../src/models/accessStore.js';
import {normalizeImageLink} from '../product-images.js';
const root='product-drive-transfer';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const products=await read(`${root}/lazada-recovered-gallery.json`);
const prior=await read(`${root}/lazada-product-map-matched.json`);
const targets=new Map(prior.map(x=>[x.productUrl,x.sku]));
targets.set('https://www.lazada.co.th/products/pdp-i16223937850.html','906STS09');
const reviewed=await read(`${root}/lazada-reviewed-model-matches.json`).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
for(const p of products){const code=reviewed[p.productUrl.match(/-i(\d+)/)?.[1]];if(code)targets.set(p.productUrl,code);}
const receipts=[...await read(`${root}/lazada-recovery-reused.json`),...await read(`${root}/lazada-recovery-receipts-1.json`),...await read(`${root}/lazada-recovery-receipts-2.json`)];
const byUrl=new Map(receipts.map(r=>[r.source_url,r]));
const pool=new pg.Pool({max:1,connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on'});
let registered;
try{
 const {rows}=await pool.query('SELECT code,name_1 FROM ic_inventory WHERE left(code,1) <> $1',['ฝ']);
 registered=new Map(rows.map(r=>[r.code,r.name_1]));
 const normalize=s=>String(s).replace(/\s*\(@[^)]*\)\s*$/,'').toLowerCase().replace(/[^a-z0-9ก-๙]/g,'');
 for(const p of products){
  if(targets.has(p.productUrl))continue;
  const exact=rows.filter(r=>normalize(r.name_1)===normalize(p.name));
  if(exact.length===1 && ![...targets.values()].includes(exact[0].code))targets.set(p.productUrl,exact[0].code);
 }
}finally{await pool.end();}
for(const code of targets.values())if(!registered.has(code))throw new Error('SML code missing: '+code);
const ready=products.map(p=>{
 if(!p.images.length||p.error)throw new Error('Missing gallery: '+p.productUrl);
 const links=[...new Set(p.images.map(url=>{const r=byUrl.get(url);if(!r)throw new Error('Missing receipt: '+url);const l=normalizeImageLink(r.drive_url);if(!l.ok||l.driveId!==r.drive_id)throw new Error('Invalid receipt');return l.value;}))];
 return {...p,code:targets.get(p.productUrl)||null,links,id:p.productUrl.match(/-i(\d+)/)[1]};
});
const store=createAccessStore('data/access.sqlite');
try{
 const changes=ready.filter(p=>p.code&&store.get('SELECT links_json FROM product_images WHERE code=?',p.code)?.links_json!==JSON.stringify(p.links));
 const summary={mode:process.argv.includes('--apply')?'applied':'dry-run',products:ready.length,matched:targets.size,pending:ready.filter(p=>!p.code).length,missingImages:0,changedCodes:changes.map(p=>p.code),uniqueImages:new Set(ready.flatMap(p=>p.images)).size};
 if(process.argv.includes('--apply')){
  const backup={at:new Date().toISOString(),mapping:await read(`${root}/lazada-mapping-prepared.json`),matched:prior,images:ready.filter(p=>p.code).map(p=>store.get('SELECT * FROM product_images WHERE code=?',p.code)),imports:store.all('SELECT * FROM product_image_imports'),pending:store.all('SELECT * FROM unmatched_product_images')};
  await fs.writeFile(`${root}/lazada-before-recovery-${Date.now()}.json`,JSON.stringify(backup,null,2));
  store.transaction(()=>{
   for(const p of ready){
    if(p.code){
     if(changes.includes(p))store.run('INSERT INTO product_images VALUES(?,?,NULL,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json,updated_at=excluded.updated_at',p.code,JSON.stringify(p.links),new Date().toISOString());
     store.run('INSERT INTO product_image_imports VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET product_name=excluded.product_name,source_name=excluded.source_name,updated_at=excluded.updated_at',p.code,p.name,'Lazada gallery verified',0,new Date().toISOString());
     store.run('DELETE FROM unmatched_product_images WHERE source_url=?',p.productUrl);
    }else store.run('INSERT INTO unmatched_product_images VALUES(?,?,?,?,?,?) ON CONFLICT(source_url) DO UPDATE SET product_name=excluded.product_name,links_json=excluded.links_json,image_sources_json=excluded.image_sources_json,updated_at=excluded.updated_at',p.productUrl,p.id,p.name,JSON.stringify(p.links),JSON.stringify(p.images),new Date().toISOString());
   }
   store.run("INSERT INTO activity_logs(user_id,action,module,details) VALUES(NULL,'product_images.recovery','products',?)",JSON.stringify(summary));
  });
  for(const p of ready){const row=p.code?store.get('SELECT links_json FROM product_images WHERE code=?',p.code):store.get('SELECT links_json FROM unmatched_product_images WHERE source_url=?',p.productUrl);if(row?.links_json!==JSON.stringify(p.links))throw new Error('Verification failed');}
  const manifestPath='product-image-drive-output/drive-upload-manifest.json';
  const manifest=await read(manifestPath);const present=new Set(manifest.filter(r=>r.drive_url).map(r=>r.source_url));
  for(const r of receipts)if(!present.has(r.source_url)){manifest.push(r);present.add(r.source_url);}
  await fs.writeFile(manifestPath,JSON.stringify(manifest));
  await fs.writeFile(`${root}/lazada-recovery-verified.json`,JSON.stringify({summary,products:ready},null,2));
  await fs.writeFile(`${root}/lazada-mapping-prepared.json`,JSON.stringify({products:ready.map(p=>({...p,sku:p.code,images:p.images.map(url=>({source_url:url,drive_url:byUrl.get(url).drive_url}))}))},null,2));
  await fs.writeFile(`${root}/lazada-product-map-matched.json`,JSON.stringify(ready.filter(p=>p.code).map(p=>({...p,sku:p.code,productName:p.name,images:p.images.map(url=>({sourceUrl:url,col:'Lazada gallery'}))})),null,2));
  await fs.writeFile(`${root}/lazada-drive-receipts-complete.json`,JSON.stringify(receipts,null,2));
 }
 console.log(JSON.stringify(summary));
}finally{store.close();}
