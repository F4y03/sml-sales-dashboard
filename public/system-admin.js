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
function submit(form,label,fn){const actions=node('div',undefined,'actions'),b=node('button',label,'primary');b.type='submit';actions.append(b);form.append(actions);form.onsubmit=async e=>{e.preventDefault();b.disabled=true;message('กำลังบันทึก…');try{await fn(new FormData(form));message('บันทึกแล้ว');}catch(error){message(error.message,true);}finally{b.disabled=false;}};return actions;}
function selected(form,name){return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);}
async function refreshCatalog(){catalog=await api('catalog');}

async function usersView(){
  const list=card('ผู้ใช้งาน'),{users}=await api('users');list.append(button('+ เพิ่มผู้ใช้',()=>editUser()));
  table(list,['ชื่อ / Username','Role','สถานะ','การจัดการ'],users.map(u=>[u.full_name+' / '+u.username,u.role,u.is_active?'เปิดใช้งาน':'ปิดใช้งาน',button('แก้ไข',()=>editUser(u))]));
}
function editUser(user){
  content.querySelector('#user-editor')?.remove();const panel=card(user?'แก้ไขผู้ใช้':'เพิ่มผู้ใช้');panel.id='user-editor';const form=node('form'),grid=node('div',undefined,'admin-grid');form.append(grid);panel.append(form);
  field(grid,'ชื่อ–นามสกุล','full_name',user?.full_name).required=true;field(grid,'Username','username',user?.username).required=true;
  const role=select(grid,'Role','role',catalog.roles.filter(r=>me.role==='super_admin'||r.code!=='super_admin'),user?.role||'admin');if(me.role!=='super_admin'&&user)role.disabled=true;
  const active=check(grid,'เปิดใช้งานบัญชี','is_active','1',user?.is_active??true);
  const pass=field(grid,user?'รหัสผ่านใหม่ (เว้นว่างเพื่อคงเดิม)':'รหัสผ่านอย่างน้อย 12 ตัวอักษร','password','','password');pass.minLength=12;pass.required=!user;
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
async function activityView(){
  const {logs}=await api('activity'+(auditBefore?'?before='+auditBefore:'')),panel=card('Activity Log');
  table(panel,['เวลา','ผู้ใช้','กิจกรรม','รายละเอียด'],logs.map(l=>[l.created_at,l.username||'ไม่ระบุตัวตน',l.action,JSON.stringify(l.details)]));if(logs.length===100)panel.append(button('รายการก่อนหน้า',()=>{auditBefore=logs.at(-1).id;show('activity');}));
}
async function securityView(){const data=await api('security'),panel=card('Security');panel.append(node('p','Password: bcrypt · Cookie: HttpOnly · SML: Read-only · ไม่มี Localhost bypass','muted'));table(panel,['ผู้ใช้','Sessions','จัดการ'],data.sessions.map(s=>[s.username,s.sessions,button('ออกจากระบบทุกอุปกรณ์',async()=>{try{await api('security/revoke/'+s.id,'POST',{});await show('security');}catch(e){message(e.message,true);}})]));}
async function overviewView(){const p=card('System Admin');p.append(node('p','เลือกเมนูเพื่อจัดการผู้ใช้ สิทธิ์ และเขตการขาย'));const links=node('div',undefined,'actions');for(const [name,url,permission] of [['สินค้า / Stock','/products.html','price_stock'],['ลูกค้า / สินค้า','/customers.html','customer_analysis'],['ยอดขาย','/index.html','dashboard'],['สินค้าฝาก','/consignment.html','consignment']])if(has(permission)){const a=node('a',name);a.href=url;links.append(a);}p.append(links);}
const views={overview:overviewView,users:usersView,territories:territoriesView,roles:rolesView,permissions:permissionsView,settings:()=>settingsView(),environment:()=>settingsView(true),activity:activityView,security:securityView};
async function show(key){current=key;content.replaceChildren();message('กำลังโหลด…');for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.tab===key));try{await views[key]();message('');}catch(e){message(e.message,true);}}
try{
  const r=await fetch('/api/auth/me');if(!r.ok)throw new Error('กรุณาเข้าสู่ระบบ');me=await r.json();await refreshCatalog();
  for(const [key,label,p] of [['overview','Dashboard',null],['users','Users','users_manage'],['roles','Roles','super'],['permissions','Permissions','super'],['territories','Sales Territories','territories_manage'],['settings','System Settings','system_settings'],['environment','Environment Settings','super'],['activity','Activity Logs','activity_logs'],['security','Security','super']])if(!p||(p==='super'?me.role==='super_admin':has(p))){const b=button(label,()=>show(key));b.dataset.tab=key;tabs.append(b);}
  await show('overview');
}catch(e){message(e.message,true);}
