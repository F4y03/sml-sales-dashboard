(() => {
  const el=id=>document.getElementById(id),format=new Intl.NumberFormat('th-TH',{maximumFractionDigits:2});
  let chart=null,period=null,data=null,version=0,controller;
  const label=r=>`${r.name}${r.code&&r.code!==r.name?' · '+r.code:''}${r.unit?' ('+r.unit+')':''}`;
  function clear(){chart?.destroy();chart=null;data=null;el('analysis-rows').replaceChildren();el('analysis-export').disabled=true;el('analysis-summary').textContent='';el('analysis-note').textContent='';}
  function draw(d){
    chart?.destroy();const timeline=d.mode==='net',shown=timeline?d.rows:d.rows.slice(0,10),isQty=d.unit==='quantity';
    el('analysis-title').textContent=d.title;el('analysis-note').textContent=d.note;
    el('analysis-status').textContent=`${d.start} ถึง ${d.end} · อัปเดต ${new Date(d.updatedAt).toLocaleTimeString('th-TH')}`;
    el('analysis-summary').textContent=d.rows.length?timeline?`ทั้งหมด ${d.rows.length} ช่วงเวลา`:`แสดง ${shown.length} อันดับแรก จาก ${d.rows.length} รายการ`:'ไม่พบข้อมูลในช่วงที่เลือก';
    el('analysis-plot').style.height=timeline?'280px':Math.max(250,shown.length*38)+'px';
    const labels=shown.map(r=>timeline?r.name:label(r));
    const barPalette=['#1b8f60','#23a373','#2eb886','#45c496','#66d0a8','#87dcba','#a3e5ca','#bfeed9','#d5f4e5','#e8f9f0'];
    chart=new Chart(el('analysis-chart'),{type:timeline?'line':'bar',data:{labels,datasets:[{data:shown.map(r=>r.value),borderColor:'#22956a',backgroundColor:timeline?'rgba(37,163,111,0.08)':shown.map((_,i)=>barPalette[i%barPalette.length]),borderRadius:timeline?0:6,borderWidth:timeline?2.5:0,borderSkipped:false,pointRadius:timeline?3:0,pointBackgroundColor:'#fff',pointBorderColor:'#22956a',pointBorderWidth:2,pointHoverRadius:6,pointHoverBackgroundColor:'#22956a',pointHoverBorderColor:'#fff',pointHoverBorderWidth:3,tension:timeline?0.35:0,fill:timeline,maxBarThickness:24,barPercentage:0.75,categoryPercentage:0.82}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:400,easing:'easeOutQuart'},indexAxis:timeline?'x':'y',layout:{padding:{top:4,right:timeline?4:16,left:4}},plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a3329',titleColor:'#b8d5c8',bodyColor:'#fff',padding:{top:10,bottom:10,left:14,right:14},cornerRadius:10,displayColors:false,titleFont:{size:11,weight:'500'},bodyFont:{size:13,weight:'600'},callbacks:{title:items=>labels[items[0].dataIndex],label:ctx=>`${isQty?'':'฿'}${format.format(timeline?ctx.parsed.y:ctx.parsed.x)}${isQty?' '+shown[ctx.dataIndex].unit:''}`}}},scales:timeline?{x:{grid:{display:false},border:{display:false},ticks:{maxTicksLimit:6,maxRotation:0,font:{size:10,weight:'500'},color:'#a3ada7',padding:6}},y:{beginAtZero:true,border:{display:false},grid:{color:'#f0f4f1',lineWidth:1},ticks:{font:{size:10,weight:'500'},color:'#a3ada7',padding:8}}}:{x:{beginAtZero:true,border:{display:false},grid:{color:'#f0f4f1',lineWidth:1},ticks:{maxTicksLimit:4,font:{size:10,weight:'500'},color:'#a3ada7',padding:4,callback:v=>Math.abs(v)>=1000000?v/1000000+'m':Math.abs(v)>=1000?v/1000+'k':v}},y:{grid:{display:false},border:{display:false},ticks:{autoSkip:false,font:{size:11,weight:'500'},color:'#5a6b62',padding:8,callback:(_,i)=>labels[i]?.length>22?labels[i].slice(0,22)+'…':labels[i]}}}}});
    el('analysis-chart').setAttribute('aria-label',d.title);el('analysis-rows').replaceChildren();
    for(const row of d.rows){const tr=document.createElement('tr');for(const text of [label({...row,unit:''}),format.format(row.value),row.unit||'บาท']){const td=document.createElement('td');td.textContent=text;tr.append(td);}el('analysis-rows').append(tr);}
    el('analysis-export').disabled=false;
  }
  async function load(){
    if(!period)return;const id=++version;controller?.abort();controller=new AbortController();const active=controller;
    clear();const mode=el('analysis-mode').value,grain=el('analysis-grain').value;el('analysis-grain').hidden=mode!=='net';el('analysis-status').classList.remove('error');el('analysis-status').textContent='กำลังโหลดข้อมูลกราฟ…';
    const timer=setTimeout(()=>active.abort(),20000);
    try{const response=await fetch('/api/analytics?'+new URLSearchParams({...period,mode,grain}),{cache:'no-store',signal:active.signal});const result=await response.json();if(!response.ok)throw new Error(result.error);if(id!==version)return;data=result;draw(result);}
    catch(e){if(id!==version)return;clear();el('analysis-status').textContent=e.name==='AbortError'?'การโหลดใช้เวลานานเกินไป กรุณาลองใหม่':e.message;el('analysis-status').classList.add('error');}
    finally{clearTimeout(timer);}
  }
  window.loadSalesAnalysis=(start,end)=>{period={start,end};load();};
  window.clearSalesAnalysis=()=>{++version;controller?.abort();period=null;clear();el('analysis-status').textContent='รอข้อมูลช่วงวันที่';};
  el('analysis-mode').addEventListener('change',load);el('analysis-grain').addEventListener('change',load);
  el('analysis-export').addEventListener('click',()=>{if(!data)return;const rows=[[data.title],['ช่วงวันที่',data.start,data.end],[data.note],['รหัส','ชื่อ','ยอด / จำนวน','หน่วย'],...data.rows.map(r=>[r.code,r.name,r.value,r.unit||'บาท'])];const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[\s]*[=+@\-]/,m=>"'"+m).replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`sales-${data.mode}-${data.start}-${data.end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
})();
