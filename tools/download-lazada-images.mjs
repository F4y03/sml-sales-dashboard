import fs from 'node:fs/promises';
import path from 'node:path';
const mapPath='product-image-drive-output/lazada-best-by-ski-mapping.json';
const manifestPath='product-image-drive-output/drive-upload-manifest.json';
const mapping=JSON.parse(await fs.readFile(mapPath,'utf8'));
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const existing=new Map(manifest.filter(x=>x.drive_url).map(x=>[x.source_url,x]));
const dir='product-drive-transfer/lazada-downloads'; await fs.mkdir(dir,{recursive:true});
const rows=[]; let skipped=0, downloaded=0;
let sequence=0;
for(const product of mapping.products){
  const images=[];
  for(const url of product.sourceUrls){
    if(existing.has(url)){images.push({source_url:url,drive_url:existing.get(url).drive_url});skipped++;continue;}
    const name=`lazada-${String(++sequence).padStart(4,'0')}-${Buffer.from(url).toString('base64url').slice(-24)}.jpg`;
    const file=path.join(dir,name);
    try{const response=await fetch(url);if(!response.ok)throw new Error(String(response.status));await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));images.push({source_url:url,file});downloaded++;}catch(error){images.push({source_url:url,error:String(error)});}
  }
  rows.push({...product,images,sku:null,unmatched:true});
}
await fs.writeFile('product-drive-transfer/lazada-mapping-prepared.json',JSON.stringify({store_url:mapping.storeUrl,fetched_at:mapping.fetchedAt,products:rows},null,2));
console.log(JSON.stringify({products:rows.length,urls:rows.flatMap(x=>x.images).length,downloaded,skipped,failed:rows.flatMap(x=>x.images).filter(x=>x.error).length}));
