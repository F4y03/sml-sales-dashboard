import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const xlsx = process.argv[2];
const outDir = process.argv[3];
if (!xlsx || !outDir) throw new Error('usage: node tools/prepare-attached-images.mjs <xlsx> <outDir>');
const zip = path.join(outDir, 'xlsx');
await fs.mkdir(zip, {recursive:true});
const {execFile} = await import('node:child_process');
await new Promise((resolve,reject)=>execFile('tar',['-xf',xlsx,'-C',zip],e=>e?reject(e):resolve()));
const ss = await fs.readFile(path.join(zip,'xl','sharedStrings.xml'),'utf8');
const urls = [...ss.matchAll(/https?:\/\/[^<]+/g)].map(m=>m[0]).filter(u=>!u.includes('schemas.openxmlformats'));
const unique=[...new Set(urls)];
const downloadDir=path.join(outDir,'downloads'); await fs.mkdir(downloadDir,{recursive:true});
const rows=[];
for(let i=0;i<unique.length;i++){
 const url=unique[i]; const ext=(new URL(url).pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0]||'.jpg').toLowerCase();
 const file=path.join(downloadDir,`${String(i+1).padStart(4,'0')}-${crypto.createHash('sha1').update(url).digest('hex').slice(0,12)}${ext}`);
 let status='failed', error='';
 try {
   if ((await fs.stat(file).catch(() => null))?.size > 0) status='downloaded';
   else { const r=await fetch(url,{signal:AbortSignal.timeout(30000)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); await fs.writeFile(file,Buffer.from(await r.arrayBuffer())); status='downloaded'; }
 } catch(e){error=e.message;}
 rows.push({url,file,status,error});
}
await fs.writeFile(path.join(outDir,'mapping.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify({unique:unique.length,downloaded:rows.filter(x=>x.status==='downloaded').length,failed:rows.filter(x=>x.status==='failed').length,outDir}));
