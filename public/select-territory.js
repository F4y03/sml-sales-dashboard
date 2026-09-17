const status=document.getElementById('territory-status'),choices=document.getElementById('territory-choices');
try {
  const response=await fetch('/api/auth/me');if(!response.ok)throw new Error('โหลดบัญชีไม่สำเร็จ');const user=await response.json();
  if(user.scope!=='territory')location.replace(user.landing);
  status.textContent=user.territories.length?'เลือกเขตเพื่อเริ่มใช้งาน':'ยังไม่ได้รับการกำหนดเขตการขาย กรุณาติดต่อผู้ดูแลระบบ';
  if(user.supportMessage){const p=document.createElement('p');p.textContent=user.supportMessage;status.after(p);}
  for(const t of user.territories){const b=document.createElement('button');b.textContent=t.name;b.type='button';b.onclick=async()=>{for(const x of choices.children)x.disabled=true;try{const r=await fetch('/api/auth/territory',{method:'POST',headers:{'Content-Type':'application/json','X-PRPlus-Request':'1'},body:JSON.stringify({territoryId:t.id})});const data=await r.json();if(!r.ok)throw new Error(data.error);location.replace(data.redirect);}catch(e){status.textContent=e.message;for(const x of choices.children)x.disabled=false;}};choices.append(b);}
} catch(e){status.textContent=e.message;}
