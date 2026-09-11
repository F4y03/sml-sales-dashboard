const $ = id=>document.getElementById(id);
const iso = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = iso(new Date());
const number = new Intl.NumberFormat('th-TH',{maximumFractionDigits:4});
let catalog=[], selected=null, snapshot=null, result=null, selectionVersion=0, requestVersion=0, controller;
const reportCategories = [['all','รายงานทั้งหมด'],['1','สินค้า'],['2','ซื้อ'],['3','ขาย'],['4','เจ้าหนี้'],['5','ลูกหนี้'],['6','เงินสด / ธนาคาร'],['7','สินทรัพย์'],['8','บัญชี'],['0','อื่น ๆ / ไม่ระบุหมวด']];
let reportCategory = 'all';
const categoryOf = report => reportCategories.some(([key]) => key === String(report.reportType)) ? String(report.reportType) : '0';
const categoryNav = document.createElement('nav');
categoryNav.className = 'report-categories card';
categoryNav.setAttribute('aria-label', 'หมวดรายงาน SML');
document.querySelector('.report-picker').before(categoryNav);
function categoryItems() {
  const term = $('report-search').value.trim().toLowerCase();
  return catalog.filter(r => (reportCategory === 'all' || categoryOf(r) === reportCategory) && `${r.id} ${r.name}`.toLowerCase().includes(term));
}
function renderCategories() {
  categoryNav.replaceChildren();
  for (const [key, label] of reportCategories) {
    const count = key === 'all' ? catalog.length : catalog.filter(r => categoryOf(r) === key).length;
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.category = key;
    button.setAttribute('aria-pressed', String(reportCategory === key));
    button.textContent = `${label} (${count})`;
    button.disabled = count === 0;
    button.onclick = () => { reportCategory=key; $('report-search').value=''; renderCategories(); list(); const first=categoryItems()[0]; if(first)openReport(first.key); };
    categoryNav.append(button);
  }
}
function renderReportOptions(items) {
  $('report-select').replaceChildren(new Option(`เลือกรายงาน (${items.length} รายการ)`, ''));
  for (const [key, label] of reportCategories.slice(1)) {
    const reports = items.filter(r => categoryOf(r) === key);
    if (!reports.length) continue;
    const group = document.createElement('optgroup'); group.label = label;
    for (const r of reports) group.append(new Option(`${r.id} · ${r.name}`, String(r.key)));
    $('report-select').append(group);
  }
  $('report-select').value = items.some(r => r.key === selected?.key) ? String(selected.key) : '';
}
function status(text,error=false){$('report-status').textContent=text;$('report-status').classList.toggle('error',error);}
async function json(url,options={}){const response=await fetch(url,{cache:'no-store',...options});const data=await response.json();if(!response.ok)throw new Error(data.error||'โหลดข้อมูลไม่สำเร็จ');return data;}
function list(){const items=categoryItems();renderReportOptions(items);$('catalog-count').textContent=items.length+' / '+catalog.length;}
function clearResult(){result=null;$('result-card').hidden=true;}
async function openReport(key) {
  const version = selectionVersion + 1;
  await select(key);
  if (selectionVersion !== version || selected?.key !== key) return;
  if (!selected.supported || !selected.datasets.length) {
    status('รายงานนี้ยังไม่รองรับการแสดงผลบนเว็บ กรุณาเลือกรายงานอื่น', true);
    return;
  }
  if (!$('report-form').checkValidity()) {
    $('report-settings').open = true;
    status('กรุณาระบุเงื่อนไขให้ครบ แล้วกดแสดงรายงาน', true);
    return;
  }
  snapshot = {filters:Object.fromEntries([...document.querySelectorAll('[data-condition]')].map(input=>[input.name,input.value])),dataset:Number($('dataset').value)};
  await run(0);
}
async function select(key){const version=++selectionVersion;++requestVersion;controller?.abort();clearResult();selected=null;snapshot=null;$('report-form').hidden=true;$('report-settings').hidden=true;$('report-settings').open=false;status('กำลังอ่านเงื่อนไขรายงาน…');try{const r=await json('/api/reports/'+key);if(version!==selectionVersion)return;selected=r;const entry=catalog.find(item=>item.key===r.key);if(entry&&reportCategory!=='all'&&categoryOf(entry)!==reportCategory){reportCategory=categoryOf(entry);renderCategories();}if(entry&&!categoryItems().some(item=>item.key===entry.key))$('report-search').value='';$('report-select').value=String(r.key);document.querySelectorAll('[data-report-key]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.reportKey)===r.key?'true':'false'));list();history.replaceState(null,'','#'+key);$('condition-fields').replaceChildren();const seen=new Set();for(const c of r.conditions){if(seen.has(c.name))continue;seen.add(c.name);const label=document.createElement('label');label.textContent=c.label;const input=document.createElement(c.options?'select':'input');input.name=c.name;input.dataset.condition=c.name;if(c.options){for(const o of c.options){const option=document.createElement('option');option.value=o.value;option.textContent=o.label;input.append(option);}}else{input.type=c.type==='Date'?'date':c.type==='Number'?'number':/time/i.test(c.name)?'time':'text';input.maxLength=1000;if(c.type==='Number')input.step='any';input.value=c.type==='Date'?today:c.type==='Number'?(c.default||'0'):/^year$/i.test(c.name)?String(new Date().getFullYear()):c.default||'';if(c.type==='Date'||c.type==='Number')input.required=true;}label.append(input);$('condition-fields').append(label);}$('dataset').replaceChildren();for(const d of r.datasets){const option=document.createElement('option');option.value=d.index;option.textContent=`ชุด ${d.index+1} · ${d.fields.filter(f=>!f.hidden).slice(0,3).map(f=>f.label).join(', ')}`;$('dataset').append(option);}$('report-form').hidden=!r.supported;$('report-settings').hidden=!r.supported;$('run-report').disabled=!r.supported;status(r.supported?'เลือกเงื่อนไข แล้วกดแสดงรายงาน · รายงานแต่ละแบบอาจต้องใช้ตัวประมวลผลเฉพาะของ SML':'รายงานนี้ไม่มีคำสั่งดึงข้อมูลที่เว็บรองรับ',!r.supported);}catch(e){if(version===selectionVersion)status(e.message,true);}}
$('report-form').addEventListener('input',()=>{++requestVersion;controller?.abort();clearResult();$('run-report').disabled=false;status('เงื่อนไขเปลี่ยนแล้ว กรุณากดแสดงรายงาน');});
async function run(page=0){if(!selected||!snapshot)return;const version=++requestVersion;const key=selected.key;controller?.abort();controller=new AbortController();const activeController=controller;const timer=setTimeout(()=>activeController.abort(),35000);$('run-report').disabled=true;$('previous-page').disabled=true;$('next-page').disabled=true;clearResult();status('กำลังดึงรายงานจาก SML…');try{const data=await json(`/api/reports/${key}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...snapshot,page,pageSize:100}),signal:controller.signal});if(version!==requestVersion)return;result=data;render(data);status('โหลดข้อมูลจริงจาก SML สำเร็จ · ไม่มีการแก้ไขข้อมูลต้นฉบับ');}catch(e){if(version===requestVersion)status(e.name==='AbortError'?'การโหลดถูกยกเลิกหรือใช้เวลานานเกินไป กรุณาจำกัดช่วงวันที่/รหัสสินค้า':e.message,true);}finally{clearTimeout(timer);if(version===requestVersion)$('run-report').disabled=false;}}
function render(data){$('result-card').hidden=false;$('result-title').textContent=`${data.id} · ${data.name}`;$('result-context').textContent=selected.conditions.filter(c=>data.filters[c.name]).map(c=>`${c.label}: ${data.filters[c.name]}`).join(' · ')||'ไม่มีเงื่อนไขเพิ่มเติม';$('result-info').textContent=`ชุด ${data.dataset+1} · ${data.rows.length} แถวในหน้านี้ · ดึงเมื่อ ${new Date(data.updatedAt).toLocaleString('th-TH')} · ผลลัพธ์เป็นตารางข้อมูล ไม่ใช่แบบพิมพ์ SML`;$('result-head').replaceChildren();$('result-body').replaceChildren();const head=document.createElement('tr');for(const f of data.fields){const th=document.createElement('th');th.textContent=f.label;head.append(th);}$('result-head').append(head);for(const row of data.rows){const tr=document.createElement('tr');row.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v==null?'':data.fields[i].type==='Number'&&Number.isFinite(Number(v))?number.format(Number(v)):typeof v==='object'?JSON.stringify(v):String(v);if(data.fields[i].type==='Number')td.className='numeric';tr.append(td);});$('result-body').append(tr);}if(!data.rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=Math.max(1,data.fields.length);td.textContent='ไม่พบข้อมูลตามเงื่อนไขที่เลือก';tr.append(td);$('result-body').append(tr);}$('page-label').textContent=`หน้า ${data.page+1} · หน้าละ 100 แถว`;$('previous-page').disabled=data.page===0;$('next-page').disabled=!data.hasMore;}
$('report-form').onsubmit=e=>{e.preventDefault();snapshot={filters:Object.fromEntries([...document.querySelectorAll('[data-condition]')].map(e=>[e.name,e.value])),dataset:Number($('dataset').value)};run(0);};
$('previous-page').onclick=()=>{if(result)run(result.page-1);};$('next-page').onclick=()=>{if(result)run(result.page+1);};$('print-report').onclick=()=>window.print();
$('csv-report').onclick=()=>{if(!result)return;const safe=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,m=>"'"+m).replaceAll('"','""')+'"';const rows=[['รายงาน',result.id,result.name],['ชุดข้อมูล',result.dataset+1,'หน้า',result.page+1],...Object.entries(result.filters),[],result.fields.map(f=>f.label),...result.rows];const csv='\ufeff'+rows.map(row=>row.map(safe).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`sml-${result.id}-page-${result.page+1}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('report-search').oninput=list;
let catalogVersion=0;
async function loadCatalog(){
  const version=++catalogVersion;
  $('reload-reports').disabled=true;$('catalog-count').textContent='กำลังโหลดรายการ…';
  try{
    const data=await json('/api/reports');if(version!==catalogVersion)return;
    catalog=data.reports;renderCategories();list();
    $('report-select').disabled=false;
    const key=selected?.key || Number(location.hash.slice(1));
    if(key&&catalog.some(r=>r.key===key)){if(!selected)openReport(key);else $('report-select').value=String(key);}
    else status('เลือกหมวดหรือรายงานด้านบน เพื่อแสดงรายงานทันที');
  }catch(e){
    if(version!==catalogVersion)return;
    $('catalog-count').textContent='โหลดรายการไม่สำเร็จ — กดโหลดรายการใหม่';
    status('เชื่อมต่อรายการรายงานไม่ได้ กรุณาเปิดผ่านเซิร์ฟเวอร์ Dashboard แล้วกดโหลดรายการใหม่',true);
  }finally{if(version===catalogVersion)$('reload-reports').disabled=false;}
}
$('report-select').onchange=()=>{if($('report-select').value)openReport(Number($('report-select').value));};
$('reload-reports').onclick=loadCatalog;
loadCatalog();
