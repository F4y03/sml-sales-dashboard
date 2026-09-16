const $=id=>document.getElementById(id);
const exportDialog = $('product-export-dialog');
$('open-export').onclick = () => exportDialog.showModal();
$('close-export').onclick = () => exportDialog.close();
let exportBackdrop = false;
const outsideExport = event => {
  const bounds = exportDialog.getBoundingClientRect();
  return event.target === exportDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
};
exportDialog.addEventListener('pointerdown', event => { exportBackdrop = event.button === 0 && outsideExport(event); });
exportDialog.addEventListener('click', event => { if (exportBackdrop && outsideExport(event)) exportDialog.close(); exportBackdrop = false; });
exportDialog.addEventListener('close', () => { exportBackdrop = false; });
const exportStockLabel=document.createElement('label');
exportStockLabel.innerHTML='<span>สถานะสินค้า</span><select id="export-stock"><option value="all">ทั้งหมด</option><option value="in">มีสินค้า</option><option value="out">ไม่มีสินค้า</option></select>';
exportDialog.querySelector('.export-controls')?.prepend(exportStockLabel);
exportStockLabel.querySelector('select').addEventListener('change', () => {
  $('product-stock').value = exportStockLabel.querySelector('select').value;
  applyProductFilters();
});
let current=null,applied={q:'',group:'',activity:'all',stock:'all'},version=0,exporting=false;
const priceLabel=value=>value==null||String(value).trim()===''?'—':Number.isFinite(Number(value))?Number(value).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}):String(value);
const stockLabel=value=>value==null||String(value).trim()===''?'ไม่ทราบ':Number(value).toLocaleString('th-TH',{maximumFractionDigits:2});
const stockStatus=value=>value==null||String(value).trim()===''?'ไม่ทราบยอด':Number(value)>0?'มีสินค้า':'ไม่มีสินค้า';
const count=n=>Number(n).toLocaleString('th-TH');
function exportLabel(){ $('download-products').textContent=exporting?'กำลังสร้างไฟล์…':`↓ ดาวน์โหลด ${current?count(current.matching):''} สินค้า`; }
async function load(page=0,filters=applied,silent=false){
  const id=++version;$('search-products').disabled=true;$('products-prev').disabled=true;$('products-next').disabled=true;$('download-products').disabled=true;$('product-status').classList.remove('error');if (!silent) $('product-status').textContent='กำลังโหลดสินค้าจาก SML…';
  try{
    const r=await fetch('/api/products?'+new URLSearchParams({...filters,page}),{cache:'no-store',signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw new Error(data.error);if(id!==version)return;
    current=data;applied={...filters};$('product-table').replaceChildren();$('product-count').textContent=`พบ ${count(data.matching)} จาก ${count(data.total)} สินค้า`;$('product-updated').textContent='ดึงข้อมูล '+new Date(data.updatedAt).toLocaleString('th-TH');
    const selectedGroup=$('product-group').value;$('product-group').replaceChildren(new Option('ทุกกลุ่มสินค้า',''));for(const g of data.groups)$('product-group').add(new Option(`${g.code} · ${g.name} (${count(g.count)})`,g.code));$('product-group').value=selectedGroup;
    for(const p of data.rows){const tr=document.createElement('tr');for(const v of [p.code,p.name_1,p.group_main_name||p.group_main,p.unit_standard,p.item_brand,priceLabel(p.catalog_sale_price),p.activity_2568_2569]){const td=document.createElement('td');td.textContent=v||'—';tr.append(td);}const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.className='button secondary';b.textContent='ดูรายละเอียด';b.onclick=()=>detail(p);td.append(b);tr.append(td);$('product-table').append(tr);}
    if(!data.rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=10;td.textContent='ไม่พบสินค้าตามตัวกรอง';tr.append(td);$('product-table').append(tr);}
    $('products-page').textContent=`หน้า ${data.page+1} / ${Math.max(1,Math.ceil(data.matching/data.pageSize))} · หน้าละ ${data.pageSize} สินค้า`;$('products-prev').disabled=data.page===0;$('products-next').disabled=(data.page+1)*data.pageSize>=data.matching;
    $('product-status').textContent=`แสดงคอลัมน์หลักในตาราง · ดาวน์โหลดได้ครบ ${data.fields.length} คอลัมน์`;$('download-products').disabled=exporting;exportLabel();
  }catch(e){if(id!==version)return;if(silent){$('product-status').textContent='อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลเดิม · '+e.message;return;}current=null;$('product-table').replaceChildren();$('product-updated').textContent='';$('product-count').textContent='โหลดข้อมูลไม่สำเร็จ';$('products-page').textContent='';$('product-status').textContent=e.name==='TimeoutError'?'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่':e.message;$('product-status').classList.add('error');}finally{if(id===version){$('search-products').disabled=false;$('download-products').disabled=!current||exporting;$('products-prev').disabled=!current||current.page===0;$('products-next').disabled=!current||(current.page+1)*current.pageSize>=current.matching;exportLabel();}}
}
function detail(product){$('detail-title').textContent=`${product.code} · ${product.name_1}`;$('detail-fields').replaceChildren();for(const f of current.fields){const label=document.createElement('div'),value=document.createElement('div');label.textContent=f.label===f.key?f.key:`${f.label} (${f.key})`;value.textContent=product[f.key]??'—';$('detail-fields').append(label,value);}$('product-detail').showModal();}
$('close-detail').onclick=()=>$('product-detail').close();
const productDialog = $('product-detail');
let backdropPress = false;
function outsideProductDialog(event) {
  const bounds = productDialog.getBoundingClientRect();
  return event.target === productDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
}
productDialog.addEventListener('pointerdown', event => {
  backdropPress = event.button === 0 && outsideProductDialog(event);
});
productDialog.addEventListener('click', event => {
  if (backdropPress && outsideProductDialog(event)) productDialog.close();
  backdropPress = false;
});
productDialog.addEventListener('pointercancel', () => { backdropPress = false; });
productDialog.addEventListener('close', () => { backdropPress = false; });
function applyProductFilters(){
  const filters={q:$('product-search').value.trim(),group:$('product-group').value,activity:$('product-activity').value,stock:$('product-stock').value};
  const exportStock=$('export-stock'); if(exportStock) exportStock.value=filters.stock;
  $('export-scope').value=filters.q||filters.group?'filtered':filters.activity;
  load(0,filters);
}
$('product-filters').onsubmit=e=>{e.preventDefault();applyProductFilters();};
$('clear-products').onclick=()=>{$('product-search').value='';$('product-group').value='';$('product-activity').value='all';$('product-stock').value='all';applyProductFilters();};
$('products-prev').onclick=()=>{if(current)load(current.page-1);};$('products-next').onclick=()=>{if(current)load(current.page+1);};$('export-scope').onchange=()=>{
  const scope=$('export-scope').value;
  if(scope==='filtered'){applyProductFilters();return;}
  $('product-search').value='';$('product-group').value='';$('product-activity').value=scope;
  applyProductFilters();
};
$('download-products').onclick=async()=>{
  if(!current||exporting||$('search-products').disabled)return;exporting=true;exportLabel();$('download-products').disabled=true;$('download-status').classList.remove('error');$('download-status').textContent='กำลังสร้างไฟล์สินค้าทุกแถวตามขอบเขตที่เลือก…';
  const format=$('export-format').value,scope='filtered';
  try{
    const r=await fetch('/api/products/export?'+new URLSearchParams({...applied,format,scope}),{cache:'no-store',signal:AbortSignal.timeout(120000)});
    if(!r.ok){const e=await r.json();throw new Error(e.error);}
    const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||`sml-products.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('download-status').textContent=`ดาวน์โหลด ${count(r.headers.get('X-Product-Count'))} สินค้าเป็น ${format.toUpperCase()} สำเร็จ`;
  }catch(e){$('download-status').textContent=e.name==='TimeoutError'?'สร้างไฟล์นานเกินไป กรุณาลองใหม่':e.message;$('download-status').classList.add('error');}finally{exporting=false;$('download-products').disabled=!current||$('search-products').disabled;exportLabel();}
};
load();
setInterval(() => {
  if (!document.hidden && !$('search-products').disabled && !exporting && !$('product-detail').open) load(current?.page || 0,applied,true);
}, 60000);

$('product-activity').onchange=applyProductFilters;
$('product-group').onchange=applyProductFilters;
const stockFilter=document.createElement('label'); stockFilter.innerHTML='<span>สถานะสินค้า</span><select id="product-stock"><option value="all">ทั้งหมด</option><option value="in">มีสินค้า</option><option value="out">ไม่มีสินค้า</option></select>'; $('product-activity').closest('label').after(stockFilter);
stockFilter.querySelector('select').onchange=applyProductFilters;
const stockTableObserver=new MutationObserver(() => {
  const table=$('product-table')?.closest('table'), header=table?.querySelector('thead tr');
  if(!table||!header||!current)return;
  if(!header.querySelector('[data-stock-column]')) { const actionHead=header.lastElementChild; for(const [label,key] of [['คงเหลือ','quantity'],['สถานะสินค้า','status']]) { const th=document.createElement('th'); th.dataset.stockColumn=key; th.textContent=label; header.insertBefore(th,actionHead); } }
  [...$('product-table').rows].forEach((row,index)=>{ const item=current.rows[index]; if(!item||row.querySelector('.stock-status'))return; const quantity=document.createElement('td'); quantity.className='stock-quantity'; quantity.textContent=stockLabel(item.balance_qty); const status=document.createElement('td'); status.className=`stock-status ${Number(item.balance_qty)>0?'in-stock':item.balance_qty==null?'unknown-stock':'out-of-stock'}`; status.textContent=stockStatus(item.balance_qty); row.insertBefore(quantity,row.lastElementChild); row.insertBefore(status,row.lastElementChild); });
});
stockTableObserver.observe($('product-table'),{childList:true});
