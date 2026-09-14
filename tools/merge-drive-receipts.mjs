import {readFile,writeFile} from 'node:fs/promises';
const path='product-image-drive-output/drive-upload-manifest.json';
const manifest=JSON.parse(await readFile(path,'utf8'));
const receipts=JSON.parse(await readFile(process.argv[2],'utf8'));
for(const receipt of receipts){const entry=manifest.find(x=>x.source_url===receipt.source_url);if(!entry)throw Error('Unknown source');Object.assign(entry,{drive_id:receipt.id,drive_url:receipt.url,drive_folder_id:receipt.parent_id});}
await writeFile(path,JSON.stringify(manifest));
console.log(JSON.stringify({uploaded:manifest.filter(x=>x.drive_id).length,pending:manifest.filter(x=>x.status==='downloaded'&&!x.drive_id).length}));
