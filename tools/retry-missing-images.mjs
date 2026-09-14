import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{dirname,resolve,sep}from'node:path';
const manifestPath='product-image-drive-output/drive-upload-manifest.json';
const entries=JSON.parse(readFileSync(manifestPath,'utf8')).filter(x=>x.status!=='downloaded');
const completed=[];
for(const x of entries){
 const destination=resolve(x.local_path);
 const root=resolve('product-image-drive-output/downloads')+sep;
 if(!destination.startsWith(root))throw Error('Unexpected destination');
 const r=await fetch(x.source_url,{signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Download '+r.status);
 if(!r.headers.get('content-type')?.startsWith('image/'))throw Error('Not an image');
 const bytes=Buffer.from(await r.arrayBuffer());
 mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,bytes);
 completed.push(x.source_url);
}
const latest=JSON.parse(readFileSync(manifestPath,'utf8'));
for(const x of latest)if(completed.includes(x.source_url)){x.status='downloaded';x.error='';}
writeFileSync(manifestPath,JSON.stringify(latest));
console.log(JSON.stringify({recovered:completed.length}));
