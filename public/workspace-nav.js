const workspace = document.createElement('aside');
workspace.className = 'workspace-sidebar';
workspace.setAttribute('aria-label', 'เมนู Workspace');
workspace.innerHTML = `
  <a class="workspace-brand" href="index.html"><img src="assets/pr-plus-logo-red.png" alt="PR PLUS Professional Audio"><span>SML<small>analytics</small></span></a>
  <button class="workspace-toggle" type="button" aria-expanded="false" aria-controls="workspace-links">☰ เมนู Workspace</button>
  <nav id="workspace-links" class="workspace-links" aria-label="หน้าหลัก">
    <p class="workspace-label">WORKSPACE</p>
    <a href="executive.html" data-page="executive"><span aria-hidden="true">◈</span>สรุปผู้บริหาร · 10 วินาที</a>
    <a href="index.html#overview" data-page="overview"><span aria-hidden="true">▦</span>ภาพรวมยอดขาย</a>
    <a href="index.html#charts" data-page="charts"><span aria-hidden="true">▥</span>วิเคราะห์ยอดขาย</a>
    <a href="index.html#products" data-page="bestsellers"><span aria-hidden="true">▧</span>สินค้าขายดี</a>
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
  const page = filename === 'executive.html' ? 'executive' : filename === 'reports.html' ? 'reports' : filename === 'products.html' ? 'products' : location.hash === '#charts' ? 'charts' : location.hash === '#products' ? 'bestsellers' : 'overview';
  workspace.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', updateWorkspace);
updateWorkspace();
