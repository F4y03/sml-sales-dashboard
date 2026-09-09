const $=id=>document.getElementById(id);
let current=null,applied={q:'',group:''},version=0,exporting=false;
const count=n=>Number(n).toLocaleString('th-TH');
function exportLabel(){ $('download-products').textContent=exporting?'กำลังสร้างไฟล์…':`↓ ดาวน์โหลด ${current?count($('export-scope').value==='all'?current.total:current.matching):''} สินค้า`; }
async function load(page=0,filters=applied){
  const id=++version;$('search-products').disabled=true;$('products-prev').disabled=true;$('products-next').disabled=true;$('download-products').disabled=true;$('product-status').classList.remove('error');$('product-status').textContent='กำลังโหลดสินค้าจาก SML…';
  try{
    const r=await fetch('/api/products?'+new URLSearchParams({...filters,page}),{cache:'no-store',signal:AbortSignal.timeout(20000)});const data=await r.json();if(!r.ok)throw new Error(data.error);if(id!==version)return;
    current=data;applied={...filters};$('product-table').replaceChildren();$('product-count').textContent=`พบ ${count(data.matching)} จาก ${count(data.total)} สินค้า`;$('product-updated').textContent='ดึงข้อมูล '+new Date(data.updatedAt).toLocaleString('th-TH');
    const selectedGroup=$('product-group').value;$('product-group').replaceChildren(new Option('ทุกกลุ่มสินค้า',''));for(const g of data.groups)$('product-group').add(new Option(`${g.code} · ${g.name} (${count(g.count)})`,g.code));$('product-group').value=selectedGroup;
    for(const p of data.rows){const tr=document.createElement('tr');for(const v of [p.code,p.name_1,p.group_main_name||p.group_main,p.unit_standard,p.item_brand]){const td=document.createElement('td');td.textContent=v||'—';tr.append(td);}const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.className='button secondary';b.textContent='ดูรายละเอียด';b.onclick=()=>detail(p);td.append(b);tr.append(td);$('product-table').append(tr);}
    if(!data.rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='ไม่พบสินค้าตามตัวกรอง';tr.append(td);$('product-table').append(tr);}
    $('products-page').textContent=`หน้า ${data.page+1} / ${Math.max(1,Math.ceil(data.matching/data.pageSize))} · หน้าละ ${data.pageSize} สินค้า`;$('products-prev').disabled=data.page===0;$('products-next').disabled=(data.page+1)*data.pageSize>=data.matching;
    $('product-status').textContent=`แสดงคอลัมน์หลักในตาราง · ดาวน์โหลดได้ครบ ${data.fields.length} คอลัมน์`;$('download-products').disabled=exporting;exportLabel();
  }catch(e){if(id!==version)return;current=null;$('product-table').replaceChildren();$('product-count').textContent='โหลดข้อมูลไม่สำเร็จ';$('products-page').textContent='';$('product-status').textContent=e.name==='TimeoutError'?'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่':e.message;$('product-status').classList.add('error');}finally{if(id===version)$('search-products').disabled=false;}
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
$('product-filters').onsubmit=e=>{e.preventDefault();load(0,{q:$('product-search').value.trim(),group:$('product-group').value});};
$('clear-products').onclick=()=>{$('product-search').value='';$('product-group').value='';load(0,{q:'',group:''});};
$('products-prev').onclick=()=>{if(current)load(current.page-1);};$('products-next').onclick=()=>{if(current)load(current.page+1);};$('export-scope').onchange=exportLabel;
$('download-products').onclick=async()=>{
  if(!current||exporting)return;exporting=true;exportLabel();$('download-products').disabled=true;$('download-status').classList.remove('error');$('download-status').textContent='กำลังสร้างไฟล์สินค้าทุกแถวตามขอบเขตที่เลือก…';
  const format=$('export-format').value,scope=$('export-scope').value;
  try{
    const r=await fetch('/api/products/export?'+new URLSearchParams({...applied,format,scope}),{cache:'no-store',signal:AbortSignal.timeout(120000)});
    if(!r.ok){const e=await r.json();throw new Error(e.error);}
    const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||`sml-products.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('download-status').textContent=`ดาวน์โหลด ${count(r.headers.get('X-Product-Count'))} สินค้าเป็น ${format.toUpperCase()} สำเร็จ`;
  }catch(e){$('download-status').textContent=e.name==='TimeoutError'?'สร้างไฟล์นานเกินไป กรุณาลองใหม่':e.message;$('download-status').classList.add('error');}finally{exporting=false;$('download-products').disabled=!current;exportLabel();}
};
load();
