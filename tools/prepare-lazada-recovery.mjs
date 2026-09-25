import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root='product-drive-transfer';
const products=JSON.parse(await fs.readFile(`${root}/lazada-recovered-gallery.json`,'utf8'));
const old=JSON.parse(await fs.readFile(`${root}/lazada-drive-receipts-complete.json`,'utf8'));
const manifest=JSON.parse(await fs.readFile('product-image-drive-output/drive-upload-manifest.json','utf8'));
const canonical=s=>s.replace(/(\.(?:jpg|jpeg|png|webp))_.*/i,'$1');
const have=new Map();
for(const r of [...manifest,...old])if(r.source_url?.startsWith('https://img.lazcdn.com/g/p/')&&r.drive_url&&!have.has(canonical(r.source_url)))have.set(canonical(r.source_url),r);
await fs.mkdir(`${root}/lazada-recovery`,{recursive:true});
const jobs=[],receipts=[];
for(const p of products){
 for(const url of p.images){
  if(receipts.some(r=>r.source_url===url)||jobs.some(r=>r.source_url===url))continue;
  if(have.has(url)){receipts.push({...have.get(url),source_url:url});continue;}
  const name='lazada-recovered-'+createHash('sha256').update(url).digest('hex').slice(0,20)+'.jpg';
  const file=path.resolve(root,'lazada-recovery',name);
  try{await fs.access(file);}catch{
   const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Image HTTP '+r.status);
   if(!r.headers.get('content-type')?.startsWith('image/'))throw new Error('Not an image');
   await fs.writeFile(file,Buffer.from(await r.arrayBuffer()));
  }
  const folder=/รถยนต์/.test(p.name)?'1gCxjfoi8liiRZPsVnUPI8dt17GoLa7gJ':/LCD|ขา|คอ|ฟองน้ำ|กันกลิ้ง/i.test(p.name)?'1LCwE0KOUnfzz8wm3yWYzMTUzKeClbMah':'1-HuNlHESwAc1yUIxKKo8hAoFdGqnLh-2';
  jobs.push({source_url:url,file,name,folder});
 }
}
await fs.writeFile(`${root}/lazada-recovery-jobs.json`,JSON.stringify(jobs,null,2));
await fs.writeFile(`${root}/lazada-recovery-reused.json`,JSON.stringify(receipts,null,2));
console.log(JSON.stringify({products:products.length,reused:receipts.length,newImages:jobs.length}));
