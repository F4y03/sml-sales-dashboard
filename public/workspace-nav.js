const workspace = document.createElement('aside');
workspace.className = 'workspace-sidebar';
workspace.setAttribute('aria-label', 'เมนู Workspace');
workspace.innerHTML = `
  <a class="workspace-brand" href="index.html"><img src="assets/pr-plus-logo-red.png" alt="PR PLUS Professional Audio"><span>SML<small>analytics</small></span></a>
  <button class="workspace-toggle" type="button" aria-expanded="false" aria-controls="workspace-links">☰ เมนู Workspace</button>
  <nav id="workspace-links" class="workspace-links" aria-label="หน้าหลัก">
    <p class="workspace-label">WORKSPACE</p>
    <a href="index.html#overview" data-page="overview"><span aria-hidden="true">▦</span>Home</a>
    <a href="executive.html" data-page="executive"><span aria-hidden="true">◈</span>สรุปผู้บริหาร · 10 วินาที</a>
    <a href="customers.html" data-page="customers"><span aria-hidden="true">◎</span>ข้อมูลเชิงลึกลูกค้า</a>
    <a href="reports.html" data-page="reports"><span aria-hidden="true">▤</span>รายงาน SML ทั้งหมด</a>
    <a href="products.html" data-page="products"><span aria-hidden="true">▧</span>ข้อมูลสินค้า / ส่งออก</a>
  </nav>
  <div class="workspace-bottom"><div class="workspace-source"><strong>SML Sales Dashboard</strong><small>PostgreSQL · SML</small></div><div class="workspace-profile"><span>DA</span><div><strong>Dashboard Admin</strong><small>Sales workspace</small></div></div></div>`;
document.body.classList.add('workspace-layout');
document.body.prepend(workspace);
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
  const page = filename === 'customers.html' ? 'customers' : filename === 'executive.html' ? 'executive' : filename === 'reports.html' ? 'reports' : filename === 'products.html' ? 'products' : 'overview';
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
logout.style.cssText = 'margin-top:12px;width:100%;padding:10px;border:1px solid #e5d9d7;border-radius:8px;background:#fff;color:#b52b31;cursor:pointer;font:inherit;font-size:12px';
workspace.querySelector('.workspace-bottom').append(logout);
logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    const response = await nativeFetch('/api/auth/logout', { method: 'POST', headers: { 'X-PRPlus-Request': '1' } });
    if (!response.ok) throw new Error('Logout failed');
    location.replace('/login.html');
  } catch { logout.textContent = 'ลองออกจากระบบอีกครั้ง'; logout.disabled = false; }
});
fetch('/api/auth/me').then(response => response.ok ? response.json() : null).then(user => {
  if (!user) return;
  workspace.querySelector('.workspace-profile strong').textContent = user.username;
  workspace.querySelector('.workspace-profile > span').textContent = user.username.slice(0, 2).toUpperCase();
}).catch(() => {});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
