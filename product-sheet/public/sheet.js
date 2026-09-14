const get = id => document.getElementById(id);
const size=100;let data,page=0;
function letter(index){let result='';for(index++;index>0;index=Math.floor((index-1)/26))result=String.fromCharCode(65+(index-1)%26)+result;return result}
function cell(tag,text){const node=document.createElement(tag);if(tag==='td'&&/^https?:\/\//.test(text)){let end=0;for(const match of text.matchAll(/https?:\/\/[^,\s]+/g)){node.append(document.createTextNode(text.slice(end,match.index)));const link=document.createElement('a');link.href=match[0];link.textContent=match[0];link.target='_blank';link.rel='noopener noreferrer';node.append(link);end=match.index+match[0].length}node.append(document.createTextNode(text.slice(end)))}else{node.textContent=text}return node}
function render(){
  const body=get('rows');body.replaceChildren();
  data.rows.slice(page*size,(page+1)*size).forEach((row,i)=>{
    const tr=document.createElement('tr'),number=page*size+i+2,th=cell('th',number);th.className='row-number';th.scope='row';tr.append(th);
    row.forEach((value,j)=>{const td=cell('td',value);td.tabIndex=0;td.addEventListener('focus',()=>{get('cell-name').textContent=letter(j)+number;get('cell-value').value=value});tr.append(td)});body.append(tr);
  });
  get('page-info').textContent=`รายการ ${page*size+1}–${Math.min((page+1)*size,data.rows.length)} จาก ${data.rows.length.toLocaleString('th-TH')}`;
  get('prev').disabled=page===0;get('next').disabled=(page+1)*size>=data.rows.length;
  document.querySelector('.sheet-scroll').scrollTop=0;
}
get('prev').onclick=()=>{page--;render()};get('next').onclick=()=>{page++;render()};
fetch('/api/sheet').then(r=>{if(!r.ok)throw Error();return r.json()}).then(result=>{
  data=result;get('count').textContent=`${data.rows.length.toLocaleString('th-TH')} รายการ · ${data.headers.length} คอลัมน์`;
  const letters=document.createElement('tr');letters.className='letters';const headings=document.createElement('tr');
  for(const tr of [letters,headings]){const th=cell('th',tr===letters?'':'1');th.className='row-number';tr.append(th)}
  const widths=[54,...data.headers.map((_,i)=>i===4?336:[8,9,30].includes(i)?420:168)];widths.forEach(width=>{const col=document.createElement('col');col.style.width=width+'px';get('columns').append(col)});
  data.headers.forEach((name,i)=>{letters.append(cell('th',letter(i)));const th=cell('th',name);th.scope='col';headings.append(th)});get('head').append(letters,headings);render();
}).catch(()=>{get('status').textContent='โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้า';get('count').textContent='โหลดไม่สำเร็จ'});
