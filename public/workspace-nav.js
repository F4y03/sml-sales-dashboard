const workspace = document.createElement('aside');
const accessStyle=document.createElement('link');accessStyle.rel='stylesheet';accessStyle.href='/access-ui.css';document.head.append(accessStyle);
const workspaceIcons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="4" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  customers: '<circle cx="8" cy="7" r="3"/><path d="M2 20v-3a6 6 0 0 1 10-4M15 20v-4m4 4v-7m4 7V9"/>',
  consignment: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v8l7 3m11-11v5M12 11v5m2 0h7m-3-3 3 3-3 3m-5 2h7m-4-3-3 3 3 3"/>',
  reports: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 17v-3m4 3v-6m4 6v-4"/>',
  products: '<path d="m3 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4m0-10v10m8-14v4m-4 6h7m-3-3 3 3-3 3"/>',
  executive: '<path d="M3 3h18M5 3v13h14V3M8 12l3-3 3 2 3-4M12 16v5m-4 0 4-3 4 3"/>',
};
const workspaceIcon = name => `<svg class="workspace-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${workspaceIcons[name]}</svg>`;
workspace.className = 'workspace-sidebar';
workspace.setAttribute('aria-label', 'เมนู Workspace');
workspace.innerHTML = `
  <a class="workspace-brand" href="index.html"><img src="assets/pr-plus-logo-red.png" alt="PR PLUS Professional Audio"><span>SML<small>analytics</small></span></a>
  <button class="workspace-toggle" type="button" aria-expanded="false" aria-controls="workspace-links">☰ เมนู Workspace</button>
  <nav id="workspace-links" class="workspace-links" aria-label="หน้าหลัก">
    <p class="workspace-label">WORKSPACE</p>
    <a href="index.html#overview" data-page="overview">${workspaceIcon('overview')}ภาพรวม</a>
    <a href="customers.html" data-page="customers" aria-label="วิเคราะห์ลูกค้าและสินค้า">${workspaceIcon('customers')}<span class="workspace-link-copy"><strong>วิเคราะห์</strong><small>ลูกค้าและสินค้า</small></span></a>
    <a href="consignment.html" data-page="consignment">${workspaceIcon('consignment')}รับ–เบิกสินค้าฝาก</a>
    <a href="products.html" data-page="products">${workspaceIcon('products')}เช็คราคา/สต๊อก</a>
    <a href="reports.html" data-page="reports">${workspaceIcon('reports')}รายงาน SML ทั้งหมด</a>
    <a href="executive.html" data-page="executive">${workspaceIcon('executive')}สรุปผู้บริหาร · 10 วินาที</a>
  </nav>
  <div class="workspace-bottom"><div class="workspace-source"><strong>SML Sales Dashboard</strong><small>PostgreSQL · SML</small></div><div class="workspace-profile"><span>DA</span><div><strong>Dashboard Admin</strong><small>Sales workspace</small></div></div></div>`;
document.body.classList.add('workspace-layout');
document.body.prepend(workspace);
workspace.querySelectorAll('nav a').forEach(link=>{link.hidden=true;});
const toggle = workspace.querySelector('.workspace-toggle');
function collapseWorkspace() {
  toggle.setAttribute('aria-expanded', 'false');
  workspace.classList.remove('workspace-expanded');
}
toggle.addEventListener('click', () => {
  const expanded = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(expanded));
  workspace.classList.toggle('workspace-expanded', expanded);
});
workspace.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
    collapseWorkspace(); toggle.focus();
  }
});
workspace.querySelectorAll('nav a').forEach(link => link.addEventListener('click', collapseWorkspace));
function updateWorkspace() {
  const filename = location.pathname.split('/').pop();
  const page = ['system-admin.html','select-territory.html','access-denied.html'].includes(filename) ? '' : filename === 'customers.html' ? 'customers' : filename === 'executive.html' ? 'executive' : filename === 'reports.html' ? 'reports' : filename === 'products.html' ? 'products' : filename === 'consignment.html' ? 'consignment' : 'overview';
  workspace.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', updateWorkspace);
updateWorkspace();

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (response.status === 401 && new URL(response.url, location.origin).origin === location.origin) {
    location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  }
  return response;
};
const logout = document.createElement('button');
logout.type = 'button';
logout.textContent = 'ออกจากระบบ ↗';
logout.className = 'workspace-logout';
workspace.querySelector('.workspace-bottom').append(logout);
logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    const response = await nativeFetch('/api/auth/logout', { method: 'POST', headers: { 'X-PRPlus-Request': '1' } });
    if (!response.ok) throw new Error('Logout failed');
    location.replace('/login.html');
  } catch { logout.textContent = 'ลองออกจากระบบอีกครั้ง'; logout.disabled = false; }
});
window.prplusUser = fetch('/api/auth/me').then(response => response.ok ? response.json() : null);
window.prplusUser.then(user => {
  if (!user) return;
  workspace.querySelector('.workspace-profile strong').textContent = user.username;
  workspace.querySelector('.workspace-profile > span').textContent = user.username.slice(0, 2).toUpperCase();
  // Keep compatibility with standalone fixture pages, while the backend remains authoritative.
  const can=p=>user.role==='super_admin'||user.permissions?.includes(p);
  const policy={overview:['dashboard'],executive:['dashboard'],customers:['customer_analysis','product_analysis'],consignment:['consignment'],products:['price_stock','product_info'],reports:['reports']};
  workspace.querySelectorAll('nav a').forEach(link=>{link.hidden=Array.isArray(user.permissions)?!policy[link.dataset.page]?.some(can):false;if(link.dataset.page==='reports'&&user.scope==='territory')link.hidden=true;});
  workspace.querySelector('.workspace-brand').href=user.landing||'/';
  workspace.querySelector('.workspace-profile small').textContent=user.role||'Sales workspace';
  if(user.dashboardName)workspace.querySelector('.workspace-brand > span').textContent=user.dashboardName;
  if(['users_manage','roles_manage','territories_manage','system_settings','environment_settings','activity_logs'].some(can)){
    const link=document.createElement('a');link.href='/system-admin.html';link.textContent='⚙ System Admin';if(location.pathname==='/system-admin.html')link.setAttribute('aria-current','page');workspace.querySelector('nav').append(link);
  }
  const sourceBadge=document.querySelector('.source-badge');
  const updateSourceBadge=text=>{if(!sourceBadge)return;const dot=document.createElement('span');dot.setAttribute('aria-hidden','true');sourceBadge.replaceChildren(dot,document.createTextNode(text));sourceBadge.setAttribute('aria-label','ขอบเขตข้อมูล '+text);};
  if(user.scope==='territory'){
    const bar=document.createElement('div');bar.className='territory-bar';const label=document.createElement('label');label.textContent='เขตปัจจุบัน: ';const select=document.createElement('select');select.setAttribute('aria-label','เขตปัจจุบัน');
    const blank=document.createElement('option');blank.value='';blank.textContent='เลือกเขต';select.append(blank);
    for(const t of user.territories){const o=document.createElement('option');o.value=t.id;o.textContent=t.name;select.append(o);}select.value=user.territoryId||'';label.append(select);bar.append(label);
    const selectedTerritory=user.territories.find(t=>Number(t.id)===Number(user.territoryId));updateSourceBadge(selectedTerritory?.name||'ยังไม่ได้เลือกเขต');if(sourceBadge)bar.append(sourceBadge);
    document.body.insertBefore(bar,workspace.nextSibling);
    select.onchange=async()=>{if(!select.value)return;select.disabled=true;try{const r=await nativeFetch('/api/auth/territory',{method:'POST',headers:{'Content-Type':'application/json','X-PRPlus-Request':'1'},body:JSON.stringify({territoryId:Number(select.value)})});const data=await r.json();if(!r.ok)throw new Error(data.error);location.replace(data.redirect);}catch(e){select.value=user.territoryId||'';select.disabled=false;let error=bar.querySelector('[role=alert]');if(!error){error=document.createElement('span');error.setAttribute('role','alert');bar.append(error);}error.textContent=e.message;}};
  } else updateSourceBadge('ทุกเขตการขาย');
  window.dispatchEvent(new CustomEvent('prplus-access',{detail:user}));
}).catch(() => {});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

const connection = document.createElement('div');
connection.className = 'workspace-connection';
connection.innerHTML = '<strong role="status" data-state="checking">กำลังตรวจการเชื่อมต่อ…</strong><small class="connection-checked">ยังไม่ได้ตรวจสอบ</small>';
workspace.querySelector('.workspace-source').replaceChildren(connection);
let checkingConnection = false;
async function checkConnection() {
  if (checkingConnection) return;
  checkingConnection = true;
  const state = connection.querySelector('[role="status"]');
  try {
    const response = await fetch('/api/connection-status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !(await response.json()).connected) throw new Error('Disconnected');
    state.dataset.state = 'connected';
    state.textContent = 'เชื่อมต่อ SML แล้ว';
  } catch {
    state.dataset.state = 'offline';
    state.textContent = 'เชื่อมต่อ SML ไม่สำเร็จ';
  } finally {
    connection.querySelector('.connection-checked').textContent = 'ตรวจล่าสุด ' + new Date().toLocaleTimeString('th-TH');
    checkingConnection = false;
  }
}
checkConnection();
setInterval(() => { if (!document.hidden) checkConnection(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkConnection(); });
