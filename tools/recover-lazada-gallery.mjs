import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const path='product-drive-transfer/lazada-recovered-gallery.json';
const input=JSON.parse(await fs.readFile('product-drive-transfer/lazada-mapping-prepared.json','utf8')).products;
let rows=[];try{rows=JSON.parse(await fs.readFile(path,'utf8'));}catch{}
const browser=await chromium.launch({headless:true,channel:'chromium'});
try {
 for(const item of input){
  if(rows.some(r=>r.productUrl===item.productUrl && r.images.length))continue;
  const page=await browser.newPage({locale:'th-TH'});
  let row={productUrl:item.productUrl,name:item.name,images:[]};
  try{
   await page.goto(item.productUrl,{waitUntil:'domcontentloaded',timeout:45000});
   await page.locator('.seo-gallery-hidden img, .item-gallery-v2__thumbnail-image').first().waitFor({state:'attached',timeout:15000});
   const data=await page.evaluate(()=>({name:document.querySelector('h1')?.textContent?.trim() || document.title.replace(/ \| Lazada.*$/,''),images:[...document.querySelectorAll('.seo-gallery-hidden img, .item-gallery-v2__thumbnail-image')].map(x=>x.src)}));
   row.name=data.name;
   row.images=[...new Set(data.images.filter(x=>x.startsWith('https://img.lazcdn.com/g/p/')).map(x=>x.replace(/(\.(?:jpg|jpeg|png|webp))_.*/i,'$1')))];
   if(!row.images.length)row.error='No product gallery';
  }catch(e){row.error=e.name;}
  finally{await page.close();}
  rows=rows.filter(r=>r.productUrl!==row.productUrl);rows.push(row);
  await fs.writeFile(path,JSON.stringify(rows,null,2));
  console.log(JSON.stringify({processed:rows.length,withGallery:rows.filter(r=>r.images.length).length,failed:rows.filter(r=>!r.images.length).length}));
 }
}finally{await browser.close();}
