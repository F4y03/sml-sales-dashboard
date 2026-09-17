const content=document.getElementById('admin-content'),status=document.getElementById('admin-status'),tabs=document.getElementById('admin-tabs');
let me,catalog,current='users',auditBefore;
const has=p=>me.role==='super_admin'||me.permissions.includes(p);
const node=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
const button=(title,click,cls)=>{const b=node('button',title,cls);b.type='button';b.onclick=click;return b;};
const message=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
async function api(path,method='GET',body){const r=await fetch('/api/admin/'+path,{method,headers:{'Content-Type':'application/json','X-PRPlus-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'ดำเนินการไม่สำเร็จ');return data;}
const card=title=>{const c=node('section',undefined,'admin-card');if(title)c.append(node('h2',title));content.append(c);return c;};
function field(parent,label,name,value='',type='text'){const l=node('label',label),input=node(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.value=value;input.autocomplete=type==='password'?'new-password':'off';if(type!=='password')input.maxLength=200;l.append(input);parent.append(l);return input;}
function select(parent,label,name,items,value){const l=node('label',label),s=node('select');s.name=name;for(const item of items){const o=node('option',item.name);o.value=item.code;s.append(o);}s.value=value;l.append(s);parent.append(l);return s;}
function check(parent,label,name,value,checked){const l=node('label',undefined,'check'),i=node('input');i.type='checkbox';i.name=name;i.value=value;i.checked=checked;l.append(i,document.createTextNode(label));parent.append(l);return i;}
function table(parent,headers,rows){const wrap=node('div',undefined,'table-scroll'),t=node('table'),head=node('thead'),tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head);const body=node('tbody');for(const row of rows){const tr=node('tr');for(const item of row){const td=node('td');if(item instanceof Node)td.append(item);else td.textContent=item;tr.append(td);}body.append(tr);}t.append(body);wrap.append(t);parent.append(wrap);if(!rows.length)parent.append(node('p','ยังไม่มีรายการ','muted'));}
function submit(form,label,fn){
  const actions=node('div',undefined,'actions'),b=node('button',label,'primary'),feedback=node('p',undefined,'admin-form-status');
  b.type='submit';feedback.setAttribute('role','alert');feedback.setAttribute('aria-live','assertive');actions.append(b,feedback);form.append(actions);
  const clearError=()=>{feedback.textContent='';feedback.dataset.error='false';for(const field of form.elements)field.removeAttribute?.('aria-invalid');};
  const errorField=text=>{const rules=[['Username','username'],['ชื่อ','full_name'],['รหัสผ่าน','password'],['Role','role'],['สถานะ','is_active'],['เขต','territories'],['Permission','permissions'],['สิทธิ์','permissions']];const name=rules.find(([word])=>text.includes(word))?.[1];return name?form.elements.namedItem(name):null;};
  form.addEventListener('input',clearError);
  form.addEventListener('invalid',e=>{feedback.textContent=`กรุณาตรวจสอบช่อง ${e.target.closest('label')?.firstChild?.textContent?.trim()||e.target.name||'ที่กรอก'}`;feedback.dataset.error='true';},true);
  form.onsubmit=async e=>{e.preventDefault();clearError();b.disabled=true;feedback.textContent='กำลังบันทึก…';message('กำลังบันทึก…');try{await fn(new FormData(form));feedback.textContent='บันทึกแล้ว';message('บันทึกแล้ว');}catch(error){const detail=error.message||'ดำเนินการไม่สำเร็จ';feedback.textContent='บันทึกไม่ได้: '+detail;feedback.dataset.error='true';message(detail,true);const target=errorField(detail);if(target instanceof RadioNodeList){target[0]?.setAttribute('aria-invalid','true');target[0]?.focus();}else if(target){target.setAttribute('aria-invalid','true');target.focus();target.scrollIntoView({behavior:'smooth',block:'center'});}}finally{b.disabled=false;}};
  return actions;
}
function selected(form,name){return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);}
async function refreshCatalog(){catalog=await api('catalog');}

async function usersView(){
  const list=card('ผู้ใช้งาน'),{users}=await api('users');list.append(button('+ เพิ่มผู้ใช้',()=>editUser()));
  table(list,['ชื่อ / Username','Role','สถานะ','การจัดการ'],users.map(u=>{const actions=node('div',undefined,'actions');actions.append(button('แก้ไข',()=>editUser(u)));if(u.id!==me.id)actions.append(button('ลบ',async()=>{if(!confirm(`ยืนยันการลบผู้ใช้ ${u.username} หรือไม่? การลบไม่สามารถย้อนกลับได้`))return;try{await api('users/'+u.id,'DELETE');message('ลบผู้ใช้แล้ว');await show('users');}catch(e){message(e.message,true);}}));return [u.full_name+' / '+u.username,u.role,u.is_active?'เปิดใช้งาน':'ปิดใช้งาน',actions];}));
}
function editUser(user){
  content.querySelector('#user-editor')?.remove();const panel=card(user?'แก้ไขผู้ใช้':'เพิ่มผู้ใช้');panel.id='user-editor';const form=node('form'),grid=node('div',undefined,'admin-grid');form.append(grid);panel.append(form);
  field(grid,'ชื่อ–นามสกุล','full_name',user?.full_name).required=true;field(grid,'Username','username',user?.username).required=true;
  const role=select(grid,'Role','role',catalog.roles.filter(r=>me.role==='super_admin'||r.code!=='super_admin'),user?.role||'admin');if(me.role!=='super_admin'&&user)role.disabled=true;
  const active=check(grid,'เปิดใช้งานบัญชี','is_active','1',user?.is_active??true);
  const pass=field(grid,user?'รหัสผ่านใหม่ (เว้นว่างเพื่อคงเดิม)':'รหัสผ่าน','password','','password');pass.required=!user;
  pass.id='user-password';pass.placeholder=user?'•••••••• (รหัสเดิม)':'';
  const passwordLabel=pass.parentElement,passwordField=node('div',undefined,'admin-password-field'),passwordRow=node('div',undefined,'admin-password-row');
  passwordLabel.htmlFor=pass.id;passwordLabel.replaceWith(passwordField);passwordField.append(passwordLabel,passwordRow);
  const togglePassword=button('แสดง',()=>{const show=pass.type==='password';pass.type=show?'text':'password';togglePassword.textContent=show?'ซ่อน':'แสดง';togglePassword.setAttribute('aria-label',show?'ซ่อนรหัสผ่านที่กรอก':'แสดงรหัสผ่านที่กรอก');togglePassword.setAttribute('aria-pressed',String(show));});
  togglePassword.setAttribute('aria-controls',pass.id);togglePassword.setAttribute('aria-label','แสดงรหัสผ่านที่กรอก');togglePassword.setAttribute('aria-pressed','false');togglePassword.disabled=true;
  passwordRow.append(pass,togglePassword);
  const passwordHint=node('small',undefined,'muted');passwordHint.id='user-password-hint';passwordHint.setAttribute('role','status');pass.setAttribute('aria-describedby',passwordHint.id);passwordField.append(passwordHint);
  const updatePasswordHint=()=>{togglePassword.disabled=!pass.value;passwordHint.textContent=user?(pass.value?'จะเปลี่ยนรหัสผ่านเมื่อกดบันทึก':'แสดงเพียงสัญลักษณ์แทนรหัสเดิม กรอกช่องนี้เมื่อต้องการเปลี่ยน'):'กดแสดงเพื่อตรวจรหัสผ่านที่กำลังกรอก';if(!pass.value){pass.type='password';togglePassword.textContent='แสดง';togglePassword.setAttribute('aria-label','แสดงรหัสผ่านที่กรอก');togglePassword.setAttribute('aria-pressed','false');}};
  pass.addEventListener('input',updatePasswordHint);updatePasswordHint();
  const permissions=node('fieldset');permissions.append(node('legend','Additional Permissions'));const checks=node('div',undefined,'checks');permissions.append(checks);form.append(permissions);
  for(const p of catalog.permissions.filter(p=>p.code!=='environment_settings')){const c=check(checks,p.name,'permissions',p.code,user?.additionalPermissions?.includes(p.code));c.disabled=me.role!=='super_admin';}
  const territory=node('fieldset');territory.append(node('legend','Sales Territories'));const tchecks=node('div',undefined,'checks');territory.append(tchecks);form.append(territory);
  for(const t of catalog.territories.filter(t=>t.is_active)){const c=check(tchecks,t.name,'territories',t.id,user?.territoryIds?.includes(t.id));c.disabled=me.role!=='super_admin';}
  const defaults=node('p',undefined,'muted');grid.append(defaults);
  const update=()=>{const r=catalog.roles.find(r=>r.code===role.value);territory.hidden=r?.scope!=='territory';defaults.textContent='สิทธิ์ตาม Role: '+(r?.permissions.map(p=>catalog.permissions.find(x=>x.code===p)?.name||p).join(', ')||'ยังไม่มี');};role.onchange=update;update();
  submit(form,'บันทึกผู้ใช้',async data=>{await api('users'+(user?'/'+user.id:''),user?'PUT':'POST',{username:data.get('username'),full_name:data.get('full_name'),role:role.value,is_active:active.checked,password:data.get('password')||undefined,additionalPermissions:me.role==='super_admin'?selected(form,'permissions'):[],territoryIds:me.role==='super_admin'&&!territory.hidden?selected(form,'territories').map(Number):[]});await show('users');});
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}
async function territoriesView(){
  const list=card('เขตการขาย');list.append(node('p','Mapping เริ่มต้นใช้รหัสทีมและกลุ่มสินค้าฝากชุดเดิม รหัสที่ไม่กำหนดจะไม่เปิดให้ Sales เห็น','muted'),button('+ เพิ่มเขต',()=>editTerritory()));
  table(list,['Code','ชื่อ','สถานะ','การจัดการ'],catalog.territories.map(t=>[t.code,t.name,t.is_active?'เปิด':'ปิด',button('แก้ไข',()=>editTerritory(t))]));
}
function editTerritory(territory){
  content.querySelector('#territory-editor')?.remove();const panel=card(territory?'แก้ไขเขต':'เพิ่มเขต');panel.id='territory-editor';const form=node('form'),grid=node('div',undefined,'admin-grid');panel.append(form);form.append(grid);
  field(grid,'Territory Code เช่น BKK','code',territory?.code).required=true;field(grid,'ชื่อเขต','name',territory?.name).required=true;
  const active=check(grid,'เปิดใช้งาน','active','1',territory?.is_active??true);
  for(const [key,label] of [['teams','รหัสทีมขาย เช่น กจ, หย'],['customerCodes','รหัสลูกค้าเพิ่มเติม (ตรงรหัสเต็ม)'],['consignmentPrefixes','รหัสกลุ่มสินค้าฝาก เช่น ฝกจ, ฝหย']]){const input=field(grid,label,key,territory?.mapping[key]?.join(', ')||'','textarea');input.maxLength=20000;}
  form.append(node('p','แยกรหัสด้วยจุลภาค รหัสทีมอ้างอิง sale_code; รหัสลูกค้าเพิ่มเติมรวมเอกสารของลูกค้านั้นในเขตนี้','muted'));
  submit(form,'บันทึกเขต',async data=>{const mapping={};for(const key of ['teams','customerCodes','consignmentPrefixes'])mapping[key]=String(data.get(key)).split(',').map(s=>s.trim()).filter(Boolean);await api('territories'+(territory?'/'+territory.id:''),territory?'PUT':'POST',{code:data.get('code'),name:data.get('name'),is_active:active.checked,mapping});await refreshCatalog();await show('territories');});panel.scrollIntoView({behavior:'smooth'});
}
async function rolesView(){
  if(me.role!=='super_admin'){card('Roles').append(node('p','การแก้ Role ต้องใช้ Super Admin'));return;}
  const list=card('Roles');table(list,['Code','ชื่อ','ขอบเขต','การจัดการ'],catalog.roles.map(r=>[r.code,r.name,r.scope==='territory'?'เฉพาะเขต':'ทุกเขต',r.code==='super_admin'?'ทุกสิทธิ์':button('แก้สิทธิ์',()=>editRole(r))]));
  const panel=card('เพิ่ม Role'),form=node('form'),grid=node('div',undefined,'admin-grid');panel.append(form);form.append(grid);field(grid,'Code','code').required=true;field(grid,'ชื่อ','name').required=true;select(grid,'ขอบเขตข้อมูล','scope',[{code:'territory',name:'เฉพาะเขตที่ได้รับมอบหมาย'},{code:'all',name:'ทุกเขต'}],'territory');
  submit(form,'เพิ่ม Role',async data=>{await api('roles','POST',Object.fromEntries(data));await refreshCatalog();await show('roles');});
}
function editRole(role){content.querySelector('#role-editor')?.remove();const panel=card('สิทธิ์ของ '+role.name);panel.id='role-editor';const form=node('form');panel.append(form);field(form,'ชื่อ Role','name',role.name).required=true;const checks=node('div',undefined,'checks');form.append(checks);for(const p of catalog.permissions.filter(p=>p.code!=='environment_settings'))check(checks,p.name,'permissions',p.code,role.permissions.includes(p.code));submit(form,'บันทึกและให้ผู้ใช้ Role นี้เข้าสู่ระบบใหม่',async data=>{await api('roles/'+role.id,'PUT',{name:data.get('name'),permissions:selected(form,'permissions')});await refreshCatalog();await show('roles');});panel.scrollIntoView({behavior:'smooth'});}
async function permissionsView(){
  const list=card('Permissions');table(list,['Code','ชื่อ'],catalog.permissions.map(p=>[p.code,p.name]));if(me.role!=='super_admin')return;
  const panel=card('เพิ่ม Permission'),form=node('form');panel.append(form);field(form,'Code','code').required=true;field(form,'ชื่อ','name').required=true;form.append(node('p','หลังเพิ่ม Permission ผู้พัฒนาต้องผูกกับ Route/API ของโมดูลใหม่ด้วย requirePermission','muted'));submit(form,'เพิ่ม Permission',async data=>{await api('permissions','POST',Object.fromEntries(data));await refreshCatalog();await show('permissions');});
}
async function settingsView(environment=false){
  const values=await api(environment?'environment':'settings'),panel=card(environment?'Environment Settings':'System Settings'),form=node('form');panel.append(form);
  const keys=environment?['PGHOST','PGPORT','PGDATABASE','API_URL','DASHBOARD_NAME']:['dashboard_name','support_message'];
  if(environment)form.append(node('p','แก้ได้เฉพาะรายการที่อนุญาต ไม่มีรหัสผ่านหรือ Secret แสดงในหน้านี้ การเปลี่ยน Environment ต้องเริ่มเซิร์ฟเวอร์ใหม่','muted'));
  for(const key of keys)field(form,key,key,values[key]||'');
  submit(form,'บันทึก',async data=>{const body=Object.fromEntries([...data].filter(([,v])=>v.trim()));const result=await api(environment?'environment':'settings','PUT',body);if(result.restartRequired)panel.append(node('p','บันทึกแล้ว กรุณาเริ่มเซิร์ฟเวอร์ใหม่เพื่อใช้ Environment ที่แก้ไข','muted'));});
}
const activityTimeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',calendar:'gregory',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function activityTime(value){
  if(typeof value!=='string'||!value.trim())return 'ไม่ระบุเวลา';
  // SQLite CURRENT_TIMESTAMP is UTC, but its text has no timezone suffix.
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?value.replace(' ','T')+'Z':value;
  const date=new Date(normalized);if(!Number.isFinite(date.getTime()))return 'ไม่ระบุเวลา';
  const parts=Object.fromEntries(activityTimeFormat.formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
async function activityView(){
  const {logs}=await api('activity'+(auditBefore?'?before='+auditBefore:'')),panel=card('Activity Log');
  table(panel,['เวลาไทย (UTC+7)','ผู้ใช้','กิจกรรม','รายละเอียด'],logs.map(l=>[activityTime(l.created_at),l.username||'ไม่ระบุตัวตน',l.action,JSON.stringify(l.details)]));if(logs.length===100)panel.append(button('รายการก่อนหน้า',()=>{auditBefore=logs.at(-1).id;show('activity');}));
}
async function securityView(){const data=await api('security'),panel=card('Security');panel.append(node('p','Password: bcrypt · Cookie: HttpOnly · SML: Read-only · ไม่มี Localhost bypass','muted'));table(panel,['ผู้ใช้','Sessions','จัดการ'],data.sessions.map(s=>[s.username,s.sessions,button('ออกจากระบบทุกอุปกรณ์',async()=>{try{await api('security/revoke/'+s.id,'POST',{});await show('security');}catch(e){message(e.message,true);}})]));}
async function overviewView(){
  const p=card('ภาพรวมระบบ');p.append(node('p','สถานะผู้ใช้งาน สิทธิ์ และเขตการขายของระบบ','muted'));const grid=node('div',undefined,'admin-overview-grid');p.append(grid);
  const metric=(label,value,unit,description)=>{const box=node('div',undefined,'admin-metric');box.append(node('span',label),node('strong',value),node('small',unit),node('p',description,'admin-metric-description'));grid.append(box);};
  try{const [users,security,activity]=await Promise.all([api('users'),api('security'),api('activity')]);const active=users.users.filter(u=>u.is_active).length,disabled=users.users.length-active,territoriesCount=catalog.territories.filter(t=>t.is_active).length,sessions=security.sessions.reduce((n,s)=>n+Number(s.sessions||0),0);metric('ผู้ใช้ทั้งหมด',users.users.length,'บัญชี','จำนวนบัญชีที่ลงทะเบียนในระบบ');metric('เปิดใช้งาน',active,'บัญชี','บัญชีที่สามารถเข้าสู่ระบบได้ในขณะนี้');metric('ปิดใช้งาน',disabled,'บัญชี','บัญชีที่ถูกระงับและไม่สามารถเข้าสู่ระบบ');metric('Role',catalog.roles.length,'รายการ','ระดับสิทธิ์ที่กำหนดไว้ในระบบ');metric('เขตที่เปิดใช้งาน',territoriesCount,'เขต','เขตที่พร้อมมอบหมายให้ผู้ใช้งาน');metric('Session ที่ใช้งาน',sessions,'รายการ','การเข้าสู่ระบบที่ยังไม่หมดอายุ');const online=card('ผู้ใช้งานที่กำลังใช้งาน');online.append(node('p','ผู้ใช้ที่มี Session กำลังใช้งานอยู่ในขณะนี้','muted'));const onlineRows=security.sessions.filter(s=>Number(s.sessions)>0);if(onlineRows.length)table(online,['ผู้ใช้','จำนวน Session','สถานะ'],onlineRows.map(s=>[s.username,Number(s.sessions).toLocaleString('th-TH'),'ออนไลน์']));else online.append(node('p','ขณะนี้ยังไม่มีผู้ใช้งานอื่นกำลังใช้งาน','muted'));const recent=card('กิจกรรมล่าสุด');recent.append(node('p','รายการการเข้าสู่ระบบและการเปลี่ยนแปลงในระบบล่าสุด','muted'));if(activity.logs.length)table(recent,['เวลา','ผู้ใช้','กิจกรรม'],activity.logs.slice(0,5).map(l=>[activityTime(l.created_at),l.username||'ไม่ระบุตัวตน',l.action]));else recent.append(node('p','ยังไม่มีกิจกรรม','muted'));}catch(error){p.append(node('p',error.message,'admin-status'));}
}
const views={overview:overviewView,users:usersView,territories:territoriesView,roles:rolesView,permissions:permissionsView,settings:()=>settingsView(),environment:()=>settingsView(true),activity:activityView,security:securityView};
async function show(key){current=key;content.replaceChildren();message('กำลังโหลด…');for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.tab===key));try{await views[key]();message('');}catch(e){message(e.message,true);}}
try{
  const r=await fetch('/api/auth/me');if(!r.ok)throw new Error('กรุณาเข้าสู่ระบบ');me=await r.json();await refreshCatalog();
  for(const [key,label,p] of [['overview','Dashboard',null],['users','Users','users_manage'],['roles','Roles','super'],['permissions','Permissions','super'],['territories','Sales Territories','territories_manage'],['settings','System Settings','system_settings'],['environment','Environment Settings','super'],['activity','Activity Logs','activity_logs'],['security','Security','super']])if(!p||(p==='super'?me.role==='super_admin':has(p))){const b=button(label,()=>show(key));b.dataset.tab=key;tabs.append(b);}
  await show('overview');
}catch(e){message(e.message,true);}
