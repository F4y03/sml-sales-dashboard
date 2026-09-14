import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { descriptionText } from './description-text.mjs';
const root = new URL('../', import.meta.url);
const original = new ExcelJS.Workbook();
const source = await original.csv.readFile('C:/Users/User/Downloads/wc-product-export-14-9-2026-1789352138863.csv', { map: value => value });
const result = new ExcelJS.Workbook();
await result.xlsx.readFile(new URL('product-image-drive-output/products-with-individual-drive-links.xlsx', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const sheet = result.worksheets[0];
if (sheet.rowCount !== source.rowCount) throw Error('Row count differs');
if (sheet.columnCount !== 48) throw Error('Column count differs');
const manifest = JSON.parse(await readFile(new URL('product-image-drive-output/drive-upload-manifest.json',root),'utf8'));
const mapping = new Map(manifest.filter(x=>x.drive_url).map(x=>[x.source_url,x.drive_url]));
let links=0,missing=0;
for (let r=1;r<=source.rowCount;r++) for(let c=1;c<=48;c++) {
  let expected = String(source.getCell(r,c).value ?? '');
  if(r>1&&[9,10].includes(c))expected=descriptionText(expected);
  if(r>1&&c===31) expected=expected.replace(/https?:\/\/[^,\s]+/g,url=>{if(mapping.has(url)){links++;return mapping.get(url)}missing++;return url});
  if (sheet.getCell(r,c).text !== expected) throw Error(`Original data differs at ${r},${c}`);
}
console.log(JSON.stringify({rows:sheet.rowCount-1,columns:sheet.columnCount,links,sourceLinksRetained:missing,otherCellsUnchanged:true}));
