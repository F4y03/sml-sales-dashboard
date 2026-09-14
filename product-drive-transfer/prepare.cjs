const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const dir = __dirname;
const source = 'C:/Users/User/Downloads/wc-product-export-14-9-2026-1789352138863.csv';
async function main() {
  const wb = new ExcelJS.Workbook();
  const sheet = await wb.csv.readFile(source, {map: value => value});
  const rows = [];
  sheet.eachRow({includeEmpty:true}, row => rows.push(Array.from({length:48}, (_,i) => row.getCell(i+1).value ?? '')));
  const imageCol = rows[0].indexOf('ไฟล์รูปภาพ');
  if(imageCol < 0) throw Error('Missing image column');
  fs.mkdirSync(path.join(dir, 'images'), {recursive:true});
  fs.writeFileSync(path.join(dir,'rows.json'), JSON.stringify(rows));
  const urls = [...new Set(rows.slice(1).flatMap(r => r[imageCol].split(/,\s*/).filter(Boolean)))];
  const manifest = urls.map(url => {
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const name = crypto.createHash('sha256').update(url).digest('hex').slice(0,20)+ext;
    return {url,name,path:path.join(dir,'images',name)};
  });
  let next=0, done=0;
  async function worker() {
    while(next < manifest.length) {
      const item=manifest[next++];
      try {
        if (!fs.existsSync(item.path)) {
          const res=await fetch(item.url,{signal:AbortSignal.timeout(60000)});
          if(!res.ok) throw Error('HTTP '+res.status);
          item.mime=res.headers.get('content-type');
          if(!item.mime?.startsWith('image/')) throw Error('Not an image: '+item.mime);
          fs.writeFileSync(item.path,Buffer.from(await res.arrayBuffer()));
        }
        item.downloaded=true;
      } catch(e) {item.error=e.message;}
      done++;
      fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
      if(done%100===0 || done===manifest.length) console.log(JSON.stringify({done,total:manifest.length,failed:manifest.filter(x=>x.error).length}));
    }
  }
  await Promise.all(Array.from({length:8},worker));
}
main().catch(e=>{console.error(e);process.exit(1)});
