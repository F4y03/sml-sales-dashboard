import fs from 'node:fs/promises';
import path from 'node:path';

const preparedDir = process.argv[2];
const sharedXml = await fs.readFile(path.join(preparedDir, 'xlsx/xl/sharedStrings.xml'), 'utf8');
const sheetXml = await fs.readFile(path.join(preparedDir, 'xlsx/xl/worksheets/sheet1.xml'), 'utf8');
const decode = text => text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const strings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) => decode([...si.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map(([, t]) => t).join('')));
const rows = [];
for (const [, rowNum, body] of sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  if (Number(rowNum) < 7) continue;
  const cells = new Map();
  for (const [, attrs, content] of body.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const col = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];
    const value = content.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (col && value !== undefined) cells.set(col, type === 's' ? strings[Number(value)] : decode(value));
  }
  const sku = (cells.get('B') || '').trim();
  const category = cells.get('D') || '';
  const imageCols = ['E','F','G','H','I','J','K','L','M','O','R','T','V','X','Z','AB','AD','AF','AH','AJ','AL'];
  const images = imageCols.map(col => ({col, sourceUrl: cells.get(col)})).filter(x => /^https?:\/\//.test(x.sourceUrl || ''));
  if (!sku || !images.length) continue;
  const folder = /Car Audio System|Vehicles/.test(category) ? 'car' : /Cables|Converters|Batteries|Chargers|Camera|Sockets|Tools|Water Pumps|Adaptors/.test(category) ? 'accessories' : 'outdoor';
  rows.push({row: Number(rowNum), sku, productName: cells.get('C') || '', category, folder, images});
}
const source = JSON.parse(await fs.readFile(path.join(preparedDir,'mapping.json'),'utf8'));
const urls = new Set(source.map(x => x.url));
const unknown = rows.flatMap(x => x.images.map(y => y.sourceUrl)).filter(url => !urls.has(url));
if (unknown.length) throw new Error(`${unknown.length} image links missing from downloaded mapping`);
await fs.writeFile(path.join(preparedDir,'product-map.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify({rows:rows.length,images:rows.reduce((n,x)=>n+x.images.length,0),unique:new Set(rows.flatMap(x=>x.images.map(y=>y.sourceUrl))).size,folders:Object.fromEntries(['car','outdoor','accessories'].map(f=>[f,rows.filter(x=>x.folder===f).length]))}));
