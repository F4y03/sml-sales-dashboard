import { regionFor } from './consignment-data.js';
import { renderRegionalChart } from './consignment-region-chart.js';
import './consignment-help.js';
import { exportConsignment } from './consignment-export.js';
const $=id=>document.getElementById(id), fmt=n=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(n);
const date=d=>d ? new Date(d+'T00:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}) : '—';
let products=[], visible=[], page=0, selected=null, historyPage=0, loaded=false, dataSignature='';
let exporting=false;
const size=25;
function cell(tr,text,className=''){const td=document.createElement('td');td.textContent=text;td.className=className;tr.append(td);return td;}
function options(id,values){const old=$(id).value;$(id).replaceChildren(new Option('ทั้งหมด',''),...[...new Set(values)].filter(Boolean).sort().map(v=>new Option(v,v)));if([...$(id).options].some(o=>o.value===old))$(id).value=old;}
function render(){
 const q=$('search').value.trim().toLocaleLowerCase(),region=$('region').value,customer=$('customer').value,unit=$('unit').value,stock=$('stock').value;
 visible=products.filter(p=>(!q||[p.product,p.code,p.customer].join(' ').toLocaleLowerCase().includes(q))&&(!region||p.region===region)&&(!customer||p.customer.slice(0,3)===customer)&&(!unit||p.unit===unit)&&(!stock||(stock==='positive'?p.balance>0:stock==='zero'?p.balance===0:p.balance<0)));
 visible.sort((a,b)=>($('sort').value==='balance'?b.balance-a.balance:$('sort').value==='out'?b.out-a.out:b.last.localeCompare(a.last))||a.code.localeCompare(b.code));
 $('export-excel').disabled=exporting||!loaded||!visible.length;
 renderRegionalChart(visible,unit,loaded);
 page=Math.min(page,Math.max(0,Math.ceil(visible.length/size)-1));
 $('product-count').textContent=loaded?fmt(visible.length):'—';$('stock-count').textContent=loaded?fmt(visible.filter(p=>p.balance>0).length):'—';$('last-date').textContent=date(visible.reduce((d,p)=>p.last>d?p.last:d,''));
 $('context').textContent=loaded?`${fmt(visible.length)} รหัสสินค้า · คลิกแถวสินค้าเพื่อดูว่าเบิกอะไร เมื่อไร`:'กำลังรอข้อมูลจาก SML';
 $('summary').replaceChildren();
 for(const p of visible.slice(page*size,(page+1)*size)){
  const tr=document.createElement('tr'),name=cell(tr,'','product-cell'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=p.product;small.textContent=p.code+' · '+p.customer+' · '+p.region;name.append(strong,small);
  cell(tr,date(p.last));cell(tr,fmt(p.in));cell(tr,fmt(p.out),'out-number');cell(tr,fmt(p.balance),'balance-number');cell(tr,p.unit);
  const openHistory=()=>{selected=p;historyPage=0;renderHistory();$('history').showModal();};
  tr.classList.add('clickable-product');tr.tabIndex=0;tr.setAttribute('aria-label','ดูรายการ '+p.code);tr.setAttribute('aria-haspopup','dialog');
  tr.onclick=()=>{tr.focus({preventScroll:true});openHistory();};
  tr.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openHistory();}};
  $('summary').append(tr);
 }
 if(!visible.length){const tr=document.createElement('tr');cell(tr,loaded?'ไม่พบสินค้าที่ตรงตัวกรอง':'ยังไม่มีข้อมูล').colSpan=6;$('summary').append(tr);}
 $('page-info').textContent=`หน้า ${page+1} / ${Math.max(1,Math.ceil(visible.length/size))}`;$('prev').disabled=page===0;$('next').disabled=(page+1)*size>=visible.length;
}
function renderHistory(){
 const p=selected,rows=[...p.rows].sort((a,b)=>b.index-a.index);$('history-title').textContent=p.product;$('history-subtitle').textContent=p.code+' · '+p.customer;
 $('history-totals').textContent=`รับเข้า/ยกมา ${fmt(p.in)} · เบิกออก ${fmt(p.out)} · คงเหลือล่าสุด ${fmt(p.balance)} ${p.unit}`;
 $('history-rows').replaceChildren();
 for(const r of rows.slice(historyPage*size,(historyPage+1)*size)){const tr=document.createElement('tr');cell(tr,date(r.date));const documentCell=cell(tr,'');if(r.docNo){const button=document.createElement('button');button.type='button';button.className='document-link';button.textContent=r.docNo;button.onclick=()=>openDocument(r);documentCell.append(button);}else documentCell.textContent='—';cell(tr,r.flag===54?'รับเข้า / ยกมา':r.flag===44?'เบิกออก (ขาย)':r.flag===58?'รับคืนจากเบิก':r.type);cell(tr,fmt(r.quantity)+' '+p.unit,r.type==='เบิกออก'?'out-number':'');cell(tr,fmt(r.balance)+' '+p.unit);$('history-rows').append(tr);}
 $('history-page').textContent=`${fmt(rows.length)} รายการ · หน้า ${historyPage+1} / ${Math.ceil(rows.length/size)}`;$('history-prev').disabled=historyPage===0;$('history-next').disabled=(historyPage+1)*size>=rows.length;
}
async function openDocument(row){
 const dialog=$('document-detail'),body=$('document-rows');$('document-title').textContent='เอกสาร '+row.docNo;$('document-subtitle').textContent=`${date(row.date)} · ${row.type}`;body.replaceChildren();$('document-status').textContent='กำลังโหลดรายละเอียดเอกสาร…';dialog.showModal();
 try{const params=new URLSearchParams({docNo:row.docNo,date:row.date,flag:String(row.flag)}),response=await fetch('/api/consignment/document?'+params,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'โหลดข้อมูลไม่สำเร็จ');$('document-status').textContent=data.rows.length?`พบ ${fmt(data.rows.length)} รายการในเอกสาร`:'ไม่พบรายการในเอกสาร';for(const item of data.rows){const tr=document.createElement('tr');cell(tr,item.code);cell(tr,item.product);cell(tr,fmt(item.quantity));cell(tr,item.unit);cell(tr,item.type);body.append(tr);}}
 catch(error){$('document-status').textContent=error.message;}
}
async function load(silent=false){
 let changed=false;if(!silent){$('source').textContent='กำลังโหลดข้อมูลสินค้าฝากจาก SML…';$('error').textContent='';}
 try{
    const response=await fetch('/api/consignment',{signal:AbortSignal.timeout(20000),cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'โหลดข้อมูลไม่สำเร็จ');if(!Array.isArray(data.rows))throw new Error('ข้อมูลตอบกลับไม่ถูกต้อง');const nextSignature=JSON.stringify(data.rows);changed=nextSignature!==dataSignature;
  const grouped=new Map();
  for(const raw of data.rows){const r={...raw,quantity:Number(raw.quantity),balance:Number(raw.balance),index:Number(raw.index)};if(!r.productCode||!Number.isFinite(r.quantity)||!Number.isFinite(r.balance)||!Number.isFinite(r.index))throw new Error('ข้อมูลจำนวนสินค้าไม่ถูกต้อง');let p=grouped.get(r.productCode);if(!p){p={code:r.productCode,product:r.product,customer:r.customer,region:regionFor(r.customer),unit:r.unit||'หน่วย',in:0,out:0,balance:0,last:'',index:-1,rows:[]};grouped.set(r.productCode,p);}p.rows.push(r);if(r.type==='เบิกออก')p.out+=r.quantity;else p.in+=r.quantity;if(r.index>p.index){p.index=r.index;p.balance=r.balance;p.last=r.date;}}
    products=[...grouped.values()];dataSignature=nextSignature;loaded=true;if(!silent)page=0;options('region',products.map(p=>p.region));options('customer',products.map(p=>p.customer.slice(0,3)));options('unit',products.map(p=>p.unit));
  $('source').textContent=`${data.source} · ${fmt(data.rows.length)} รายการ · อัปเดต ${new Date(data.updatedAt).toLocaleString('th-TH')}`;
 }catch(e){if(!silent||!loaded){$('source').textContent='โหลดข้อมูลไม่สำเร็จ';$('error').textContent=(e.name==='TimeoutError'?'โหลดเกินเวลาที่กำหนด กรุณาลองใหม่':e.message)+(loaded?' · กำลังแสดงข้อมูลจากครั้งก่อน':'');}}finally{if(!silent||changed)render();}
}
for(const id of ['search','region','customer','unit','stock','sort'])$(id).addEventListener(id==='search'?'input':'change',()=>{page=0;render();});
$('export-excel').onclick=async()=>{
 if(exporting||!visible.length)return;
 const snapshot=[...visible], filters=['search','region','customer','unit','stock','sort'].map(id=>[id,$(id).value]);
 exporting=true;render();$('export-status').textContent='กำลังสร้างไฟล์ Excel…';
 try{await exportConsignment(snapshot,filters,$('source').textContent);$('export-status').textContent=`ส่งออก ${fmt(snapshot.length)} รหัสสินค้า พร้อมประวัติรับ–เบิกแล้ว`;}
 catch{$('export-status').textContent='ส่งออกไม่สำเร็จ กรุณาลองใหม่';}
 finally{exporting=false;render();}
};
$('reset').onclick=()=>{for(const id of ['search','region','customer','unit','stock'])$(id).value='';$('sort').value='recent';page=0;render();};
 $('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};$('history-prev').onclick=()=>{historyPage--;renderHistory();};$('history-next').onclick=()=>{historyPage++;renderHistory();};$('close-history').onclick=()=>$('history').close();$('close-document').onclick=()=>$('document-detail').close();render();load();setInterval(()=>load(true),60000);
