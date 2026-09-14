import ExcelJS from 'exceljs';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
const [csvPath, manifestPath, outputPath] = process.argv.slice(2);
const workbook = new ExcelJS.Workbook();
const sheet = await workbook.csv.readFile(csvPath, { map: value => value });
const mapping = new Map(JSON.parse(await readFile(manifestPath, 'utf8')).filter(x => x.drive_url).map(x => [x.source_url, x.drive_url]));
let replacements = 0;
for (let r = 2; r <= sheet.rowCount; r++) {
  const cell = sheet.getCell(r, 31);
  const updated = cell.text.replace(/https?:\/\/[^,\s]+/g, url => {
    if (!mapping.has(url)) return url;
    replacements++;
    return mapping.get(url);
  });
  cell.value = /^https:\/\/drive\.google\.com\/file\/d\/[^,\s]+$/.test(updated) ? { text: updated, hyperlink: updated } : updated;
}
sheet.views = [{state:'frozen', ySplit:1}];
sheet.autoFilter = {from:'A1', to:{row:sheet.rowCount,column:sheet.columnCount}};
sheet.columns.forEach((column,i) => {column.width = i === 30 ? 90 : i === 4 ? 48 : 24;});
sheet.eachRow((row,r) => row.eachCell(cell => {
  cell.numFmt = '@';
  cell.alignment = {vertical:'top',wrapText:true};
  if(r===1){cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF217346'}};}
}));
const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
for (const name of Object.keys(archive.files).filter(name=>name.endsWith('.xml'))) {
  archive.file(name,(await archive.file(name).async('string')).replace(/\r/g,'&#13;'));
}
await writeFile(outputPath,await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log(JSON.stringify({rows:sheet.rowCount-1,columns:sheet.columnCount,replacements,outputPath}));
