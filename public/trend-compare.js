(() => {
  const root=document.createElement('details');root.className='trend-comparison';
  root.innerHTML='<summary>เปรียบเทียบยอดขายรายปี</summary><form><div class="compare-fields"><label>ปีหลัก<select name="yearA" required></select></label><label>เทียบกับปี<select name="yearB" required></select></label></div><button class="button primary" type="submit" disabled>เปรียบเทียบ</button></form><p class="compare-status" role="status"></p><div class="compare-canvas" hidden><canvas aria-label="กราฟเปรียบเทียบยอดขายรายปีแยกตามเดือน" role="img"></canvas></div>';
  document.getElementById('trend-note').closest('.chart-note').after(root);
  const form=root.querySelector('form'),field=n=>form.elements.namedItem(n),status=root.querySelector('.compare-status');
  let chart,controller,version=0,applied,years;
  const money=n=>Number(n).toLocaleString('th-TH',{style:'currency',currency:'THB'});
  form.onchange=()=>{++version;controller?.abort();applied=null;root.querySelector('.compare-canvas').hidden=true;status.textContent='กดเปรียบเทียบเพื่อแสดงปีที่เลือก';};
  let loadingYears=false;
  root.addEventListener('toggle',async()=>{
    if(!root.open||years||loadingYears)return;loadingYears=true;status.textContent='กำลังโหลดปีที่มีข้อมูล…';
    try{const r=await fetch('/api/sales-trend/years',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();years=(await r.json()).years;for(const n of ['yearA','yearB'])field(n).replaceChildren(...years.map(y=>new Option(String(y+543),y)));if(years.length>1)field('yearB').selectedIndex=1;form.querySelector('button').disabled=years.length<2;status.textContent=years.length<2?'ต้องมีข้อมูลอย่างน้อย 2 ปีจึงจะเปรียบเทียบได้':'เลือกสองปี แล้วกดเปรียบเทียบ';}catch{status.textContent='โหลดปีไม่สำเร็จ ปิดแล้วเปิดส่วนนี้เพื่อลองใหม่';}finally{loadingYears=false;}
  });
  async function load(params){
    const id=++version;controller?.abort();controller=new AbortController();status.textContent='กำลังโหลดข้อมูลเปรียบเทียบ…';
    try{
      const monthly=true;
      const series=await Promise.all(['A','B'].map(async key=>{
        const year=params['year'+key];
        if(!year)throw Error('กรุณาเลือกปี');
        const url='/api/sales-trend?year='+year;
        const r=await fetch(url,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});if(!r.ok)throw Error('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่');const data=await r.json();
        const dates=data.months.map(x=>year+'-'+String(x.month).padStart(2,'0'));
        return {label:'ปี '+(Number(year)+543),dates,values:data.months.map(x=>Number(x.sales))};
      }));
      if(id!==version)return;applied=params;const theme=window.dashboardTheme?.palette()||{ink:'#222',muted:'#666',line:'#ddd'};
      chart?.destroy();root.querySelector('.compare-canvas').hidden=false;
      chart=new Chart(root.querySelector('canvas'),{type:monthly?'bar':'line',data:{labels:Array.from({length:Math.max(...series.map(s=>s.values.length))},(_,i)=>monthly?new Date(2026,i,1).toLocaleDateString('th-TH',{month:'short'}):`วันที่ ${i+1}`),datasets:series.map((s,i)=>({label:`${i?'ช่วงเปรียบเทียบ':'ช่วงหลัก'} · ${s.label}`,data:s.values,borderColor:i?'#259ba6':'#ff3b30',backgroundColor:i?'#259ba6':'#ff3b30',borderWidth:2,pointRadius:0}))},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:theme.ink}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label} · ${series[ctx.datasetIndex].dates[ctx.dataIndex]}: ${money(ctx.parsed.y)}`}}},scales:{x:{ticks:{color:theme.muted,maxTicksLimit:12},grid:{display:false}},y:{beginAtZero:true,ticks:{color:theme.muted},grid:{color:theme.line}}}}});
      status.textContent=series.map((s,i)=>`${i?'ช่วงเปรียบเทียบ':'ช่วงหลัก'} · ${s.label} รวม ${money(s.values.reduce((a,b)=>a+b,0))}`).join('\n')+'\nยอดขายตามเอกสาร ก่อนหักรับคืน · '+(monthly?'เปรียบเทียบเดือนเดียวกันของแต่ละปี เดือนที่ยังไม่จบเป็นยอดบางเดือน':'จัดแนวตามลำดับวันของแต่ละช่วง ช่วงสั้นกว่าจะสิ้นสุดก่อน');
    }catch(e){if(id===version)status.textContent=e.message||'โหลดไม่สำเร็จ';}
  }
  form.onsubmit=e=>{e.preventDefault();if(field('yearA').value===field('yearB').value){status.textContent='กรุณาเลือกคนละปีเพื่อเปรียบเทียบ';return;}load(Object.fromEntries(new FormData(form)));};
  setInterval(()=>{if(root.open&&!document.hidden&&applied)load(applied);},60000);
})();
