const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
async function main() {
 const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'rows.json'),'utf8'));
 const uploads=JSON.parse(fs.readFileSync(path.join(__dirname,'uploads.json'),'utf8'));
 const links=new Map(uploads.map(x=>[x.url,x.drive_url]));
 const wb=new ExcelJS.Workbook();
 const ws=wb.addWorksheet('Products');
 const idx=rows[0].indexOf('ไฟล์รูปภาพ');
 ws.addRow([...rows[0],'ลิงก์รูปภาพ Google Drive','สถานะอัปโหลดรูป']);
 for(const row of rows.slice(1)) {
   const urls=row[idx].split(/,\s*/).filter(Boolean);
   const found=urls.map(u=>links.get(u)||'');
   ws.addRow([...row,found.join('\n'),urls.length===0?'ไม่มีรูป':found.every(Boolean)?'ครบ':'ยังไม่ครบ']);
 }
 ws.views=[{state:'frozen',ySplit:1}];
 ws.autoFilter={from:{row:1,column:1},to:{row:rows.length,column:50}};
 ws.getRow(1).font={bold:true};
 ws.getColumn(49).width=70;
 ws.getColumn(49).alignment={wrapText:true};
 ws.getColumn(50).width=18;
 const map=wb.addWorksheet('Image links');
 map.addRow(['Original URL','Google Drive URL','Drive file ID']);
 uploads.forEach(x=>map.addRow([x.url,x.drive_url,x.id]));
 map.getRow(1).font={bold:true};
 const output=path.join(__dirname,'products-with-drive-links.xlsx');
 await wb.xlsx.writeFile(output);
 const check=new ExcelJS.Workbook();await check.xlsx.readFile(output);
 const actual=check.getWorksheet('Products');
 for(let r=0;r<rows.length;r++) for(let c=0;c<48;c++) {
   if((actual.getCell(r+1,c+1).value??'')!==rows[r][c]) throw Error(`Data mismatch ${r+1}:${c+1}`);
 }
 console.log(JSON.stringify({output,rows:rows.length-1,originalColumns:48,uploaded:uploads.length,verified:true}));
}
main().catch(e=>{console.error(e);process.exit(1)});
