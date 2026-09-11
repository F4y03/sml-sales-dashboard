const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const money = value => '฿' + number.format(Number(value));
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
let charts = [], current = null, requestId = 0;
function syncControls() {
  const single = $('period').value === 'day';
  $('single-field').hidden = !single;
  $('range-fields').hidden = single;
  const today = iso(new Date()), yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
  $('day-today').setAttribute('aria-pressed', String(single && $('start').value === today));
  $('day-yesterday').setAttribute('aria-pressed', String(single && $('start').value === iso(yesterday)));
}
$('year').textContent = new Date().getFullYear();
function setPeriod() {
  if ($('period').value === 'day') return;
  if ($('period').value === 'custom') return;
  const end = new Date(), start = new Date();
  if ($('period').value === 'month') start.setDate(1);
  else start.setDate(end.getDate() - Number($('period').value) + 1);
  $('start').value = iso(start); $('end').value = iso(end);
}
function cell(row, text, className = '') {
  const td = document.createElement('td'); td.textContent = text; td.className = className; row.append(td); return td;
}
let productPage = 0;
const PAGE_SIZE = 5;
let invoicePage = 0, invoiceSearch = '';
const INVOICE_PAGE_SIZE = 25;
function renderProductPage(products) {
  const body = $('product-rows'); body.replaceChildren();
  const total = products.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (productPage >= totalPages) productPage = totalPages - 1;
  if (productPage < 0) productPage = 0;
  const start = productPage * PAGE_SIZE;
  const pageItems = products.slice(start, start + PAGE_SIZE);
  const sum = products.reduce((n, p) => n + Number(p.sales), 0);
  pageItems.forEach((p, i) => {
    const globalIndex = start + i;
    const row = document.createElement('tr');
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(globalIndex + 1); cell(row, '').append(rank);
    cell(row, p.name || p.code, 'product-name'); cell(row, p.code);
    const quantityButton = document.createElement('button');
    quantityButton.type = 'button'; quantityButton.className = 'quantity-link';
    quantityButton.textContent = `${number.format(p.quantity)} ${p.unit || ''}`;
    quantityButton.setAttribute('aria-label', `ดูบิลของ ${p.name || p.code}`);
    quantityButton.setAttribute('aria-haspopup', 'dialog');
    quantityButton.setAttribute('aria-controls', 'product-invoices');
    row.classList.add('product-invoice-row');
    row.addEventListener('click', () => {
      quantityButton.focus({ preventScroll: true });
      openProductInvoices(p);
    });
    cell(row, '', 'text-right').append(quantityButton); cell(row, money(p.sales), 'text-right font-medium');
    const percent = sum > 0 ? Number(p.sales) / sum * 100 : 0;
    const share = cell(row, '', 'text-right'), track = document.createElement('span'), bar = document.createElement('i');
    track.className = 'share'; bar.style.width = `${Math.max(0, Math.min(100, percent))}%`; track.append(bar); share.append(track, `${percent.toFixed(1)}%`); body.append(row);
  });
  if (!total) { const row = document.createElement('tr'); const td = cell(row, 'ไม่พบข้อมูลสินค้าในช่วงเวลาที่เลือก', 'text-center'); td.colSpan = 6; body.append(row); }
  $('product-pill').textContent = `${number.format(total)} รายการในช่วงที่เลือก`;
  $('product-page-info').textContent = total ? `แสดง ${start + 1}–${Math.min(start + PAGE_SIZE, total)} จาก ${total} รายการ` : '';
  $('product-prev').disabled = productPage <= 0;
  $('product-next').disabled = productPage >= totalPages - 1;
}
function openProductInvoices(product) {
  if (!current) return;
  $('product-invoices-title').textContent = `${product.name || product.code} (${product.code})`;
  $('product-invoices-period').textContent = `${current.period.start} – ${current.period.end} · รวม ${number.format(product.quantity)} ${product.unit || ''} · ${money(product.sales)} · ยังไม่หักรับคืน`;
  const body = $('product-invoice-rows'); body.replaceChildren();
  (product.invoices || []).forEach(invoice => {
    const row = document.createElement('tr');
    cell(row, new Date(invoice.date + 'T00:00:00').toLocaleDateString('th-TH'));
    cell(row, invoice.docNo); cell(row, `${number.format(invoice.quantity)} ${product.unit || ''}`);
    cell(row, money(invoice.sales)); body.append(row);
  });
  $('product-invoices').showModal();
}
$('close-product-invoices').addEventListener('click', () => $('product-invoices').close());
function renderInvoiceRows(data) {
  const body = $('invoice-rows'); body.replaceChildren();
  data.invoices.forEach(invoice => {
    const row = document.createElement('tr');
    cell(row, new Date(invoice.date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }));
    cell(row, invoice.docNo);
    cell(row, invoice.customer || invoice.customerCode || 'ไม่ระบุลูกค้า');
    cell(row, money(invoice.total), 'text-right font-medium');
    body.append(row);
  });
  if (!data.invoices.length) {
    const row = document.createElement('tr'), td = cell(row, 'ไม่พบบิลตามเงื่อนไขที่ค้นหา', 'text-center');
    td.colSpan = 4; body.append(row);
  }
  const start = data.page * data.pageSize + 1;
  const end = Math.min((data.page + 1) * data.pageSize, data.total);
  $('invoice-page-info').textContent = data.total ? `แสดง ${start}–${end} จาก ${number.format(data.total)} บิล` : 'ไม่พบรายการบิล';
  $('invoice-prev').disabled = data.page <= 0;
  $('invoice-next').disabled = end >= data.total;
  $('invoice-status').textContent = `อัปเดตรายการ ${new Date(data.updatedAt).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
}
async function loadInvoices(page = 0) {
  if (!current?.period) { $('status').textContent = 'กรุณาโหลดข้อมูลยอดขายก่อนดูรายการบิล'; return; }
  invoicePage = Math.max(0, page);
  $('invoice-status').classList.remove('error');
  $('invoice-status').textContent = 'กำลังดึงรายการบิล…';
  $('invoice-prev').disabled = true; $('invoice-next').disabled = true;
  const params = new URLSearchParams({ start: current.period.start, end: current.period.end, page: invoicePage, pageSize: INVOICE_PAGE_SIZE, q: invoiceSearch });
  try {
    const response = await fetch(`/api/invoices?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'โหลดรายการบิลไม่สำเร็จ');
    renderInvoiceRows(data);
  } catch (error) {
    $('invoice-status').textContent = error.name === 'TimeoutError' ? 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่' : error.message;
    $('invoice-status').classList.add('error');
    $('invoice-rows').replaceChildren();
    $('invoice-page-info').textContent = '';
  }
}
function openInvoices() {
  if (!current?.period) { $('status').textContent = 'กรุณาโหลดข้อมูลยอดขายก่อนดูรายการบิล'; return; }
  const dateLabel = value => new Date(value+'T00:00:00').toLocaleDateString('th-TH', {day:'numeric',month:'long',year:'numeric'});
  $('invoice-dialog-period').textContent = current.period.start === current.period.end ? dateLabel(current.period.start) : `${dateLabel(current.period.start)} – ${dateLabel(current.period.end)}`;
  $('invoice-search').value = invoiceSearch;
  $('invoice-dialog').showModal();
  loadInvoices(0);
}
function render(data) {
  $('total-sales').textContent = money(data.totalSales);
  $('total-invoices').textContent = number.format(data.totalInvoices);
  $('item-sales').textContent = money(data.itemSales);
  $('total-sales').dataset.amount = String(data.totalSales);
  $('item-sales').dataset.amount = String(data.itemSales);
  productPage = 0;
  renderProductPage(data.products);
  $('updated').textContent = `อัปเดต ${new Date(data.updatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`;
  charts.forEach(chart => chart.destroy()); charts = [];
  if (!window.Chart) return;
  Chart.defaults.font.family = "'Noto Sans Thai', Tahoma, sans-serif";
  const theme = window.dashboardTheme?.palette() || {muted:'#656973',line:'#e0e2e6',brand:'#e10600',surface:'#fff'};
  Chart.defaults.color = theme.muted;
  const options = () => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    layout: { padding: { top: 8, right: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#482629', titleColor: '#f5dcd7', bodyColor: '#fff',
        padding: { top: 10, bottom: 10, left: 14, right: 14 },
        cornerRadius: 10, displayColors: false,
        titleFont: { size: 11, weight: '500' }, bodyFont: { size: 13, weight: '600' },
        callbacks: { label: ctx => ` ${money(ctx.parsed.y)}` }
      }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10, weight: '500' }, color: theme.muted, maxRotation: 0, maxTicksLimit: 7, padding: 6 } },
      y: { beginAtZero: true, border: { display: false }, grid: { color: theme.line, lineWidth: 1 }, ticks: { font: { size: 10, weight: '500' }, color: theme.muted, maxTicksLimit: 5, padding: 8, callback: v => Math.abs(v) >= 1000000 ? `${v / 1000000}m` : Math.abs(v) >= 1000 ? `${v / 1000}k` : v } }
    }
  });
  const ctx = $('daily-chart').getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(225, 6, 0, 0.18)'); gradient.addColorStop(0.6, 'rgba(225, 6, 0, 0.06)'); gradient.addColorStop(1, 'rgba(225, 6, 0, 0)');
  charts.push(new Chart(ctx, { type: 'line', data: { labels: data.daily.map(d => new Date(d.day + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })), datasets: [{ data: data.daily.map(d => Number(d.sales)), borderColor: theme.brand, backgroundColor: gradient, fill: true, tension: 0, borderWidth: 2.5, pointRadius: data.daily.length === 1 ? 5 : 0, pointHoverRadius: 6, pointBackgroundColor: '#fff', pointBorderColor: theme.brand, pointBorderWidth: 2.5, pointHoverBackgroundColor: theme.brand, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3 }] }, options: options() }));
  const warehouseColors = ['#813437', '#bb7261', '#cc9589', '#d9b7a6', '#e8c9bf', '#e8c9bf'];
  const warehouseChart = document.getElementById('warehouse-chart');
  if (warehouseChart) charts.push(new Chart(warehouseChart, { type: 'bar', data: { labels: data.warehouses.map(w => w.name), datasets: [{ data: data.warehouses.map(w => Number(w.sales)), backgroundColor: data.warehouses.map((w, i) => Number(w.sales) < 0 ? '#c34f52' : warehouseColors[i % warehouseColors.length]), borderRadius: 7, maxBarThickness: 42, borderSkipped: false }] }, options: { ...options(), plugins: { ...options().plugins, tooltip: { ...options().plugins.tooltip, callbacks: { label: ctx => ` ${money(ctx.parsed.y)}` } } } } }));
}
async function load() {
  syncControls();
  const id = ++requestId, start = $('start').value, end = $('end').value;
  current = null; $('export').disabled = true;
  $('product-invoices').close();
  $('status').classList.remove('error');
  if (!start || !end || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365) {
    $('status').textContent = 'กรุณาเลือกช่วงวันที่ให้ถูกต้อง ไม่เกิน 366 วัน'; $('status').classList.add('error'); return;
  }
  $('apply').disabled = true; $('refresh').disabled = true; $('status').textContent = 'กำลังอัปเดตข้อมูลจาก SML…';
  $('connection-badge').textContent = 'SML · กำลังอัปเดต'; $('connection-badge').className = 'live-badge';
  try {
    let data;
    {
      if (location.protocol === 'file:') throw new Error('กรุณาเปิดผ่าน http://localhost:3001 เพื่อเชื่อมต่อ SML');
      const response = await fetch(`/api/dashboard?${new URLSearchParams({ start, end })}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('ไม่พบ API กรุณาเริ่ม Backend ด้วย npm start');
      data = await response.json(); if (!response.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
    }
    if (id !== requestId) return;
    invoiceSearch = ''; invoicePage = 0;
    render(data); current = data; current.period = { start, end }; $('export').disabled = false;
    window.loadSalesAnalysis?.(start, end);
    const dateLabel = value => new Date(value+'T00:00:00').toLocaleDateString('th-TH', {day:'numeric',month:'long',year:'numeric'});
    $('display-period').textContent = start === end ? dateLabel(start) : `${dateLabel(start)} – ${dateLabel(end)}`;
    $('connection-badge').textContent = '● เชื่อมต่อ SML แล้ว'; $('connection-badge').className = 'live-badge connected';
    $('status').textContent = `อัปเดต ${new Date(data.updatedAt).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} · รีเฟรชอัตโนมัติทุก 60 วินาที`;
  } catch (error) {
    if (id !== requestId) return;
    $('connection-badge').textContent = 'เชื่อมต่อไม่สำเร็จ'; $('connection-badge').className = 'live-badge failed';
    $('display-period').textContent = 'ยังไม่มีข้อมูลล่าสุด';
    charts.forEach(chart => chart.destroy()); charts = [];
    ['total-sales', 'item-sales', 'total-invoices'].forEach(key => { $(key).textContent = '—'; delete $(key).dataset.amount; });
    $('product-rows').replaceChildren(); $('invoice-rows').replaceChildren(); $('invoice-page-info').textContent = ''; $('updated').textContent = 'ยังไม่ได้อัปเดต';
    $('status').textContent = error.name === 'TimeoutError' ? 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่' : error.message; $('status').classList.add('error');
  } finally { if (id === requestId) { $('apply').disabled = false; $('refresh').disabled = false; } }
}
$('filters').addEventListener('submit', e => { e.preventDefault(); load(); });
$('product-prev').addEventListener('click', () => { if (current) { productPage--; renderProductPage(current.products); } });
$('product-next').addEventListener('click', () => { if (current) { productPage++; renderProductPage(current.products); } });
$('invoice-card').addEventListener('click', openInvoices);
$('invoice-card').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInvoices(); } });
$('close-invoices').addEventListener('click', () => $('invoice-dialog').close());
$('invoice-search-form').addEventListener('submit', e => { e.preventDefault(); invoiceSearch = $('invoice-search').value.trim(); loadInvoices(0); });
$('invoice-prev').addEventListener('click', () => loadInvoices(invoicePage - 1));
$('invoice-next').addEventListener('click', () => loadInvoices(invoicePage + 1));
$('period').addEventListener('change', () => { if ($('period').value === 'day') { oneDay($('dashboard-day').value || iso(new Date())); return; } setPeriod(); syncControls(); if ($('period').value !== 'custom') load(); });
['start', 'end'].forEach(id => $(id).addEventListener('change', () => { $('period').value = 'custom'; syncControls(); $('status').textContent = 'ช่วงวันที่เปลี่ยนแล้ว กดแสดงข้อมูลเพื่ออัปเดต'; }));
$('refresh').addEventListener('click', () => { setPeriod(); load(); });
$('export').addEventListener('click', () => {
  if (!current) return;
  const rows = [['Period', current.period.start, current.period.end], ['Report', '4007 / 4014'], ['แหล่งข้อมูล', current.source], ['ยอดขายรวม', current.totalSales], ['จำนวนบิล', current.totalInvoices], [], ['วันที่', 'ยอดขาย'], ...current.daily.map(d => [d.day, d.sales]), [], ['คลังสินค้า', 'ยอดขาย'], ...current.warehouses.map(w => [w.name, w.sales]), [], ['รหัสสินค้า', 'สินค้า', 'จำนวน', 'หน่วย', 'ยอดขาย'], ...current.products.map(p => [p.code, p.name, p.quantity, p.unit, p.sales])];
  const csv = rows.map(row => row.map(value => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = 'sml-sales-dashboard.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
// Reset a browser-restored selection so the dashboard always starts with real SML data.
function oneDay(value) { if (!value) return; $('period').value = 'day'; $('start').value = value; $('end').value = value; $('dashboard-day').value = value; load(); }
function clearDay() {
  $('period').value = 'month';
  $('dashboard-day').value = iso(new Date());
  setPeriod();
  load();
}
$('dashboard-day').value = iso(new Date());
$('dashboard-day').addEventListener('change', () => oneDay($('dashboard-day').value));
$('day-today').addEventListener('click', () => { const value = iso(new Date()); if ($('period').value === 'day' && $('start').value === value) clearDay(); else oneDay(value); });
$('day-yesterday').addEventListener('click', () => { const d = new Date(); d.setDate(d.getDate()-1); const value = iso(d); if ($('period').value === 'day' && $('start').value === value) clearDay(); else oneDay(value); });
$('clear-day').addEventListener('click', clearDay);
$('source').value = 'live';
setPeriod(); load();

setInterval(() => { if (!document.hidden && !$('apply').disabled) { setPeriod(); load(); } }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('apply').disabled) { setPeriod(); load(); } });

window.addEventListener('dashboard-theme-change', () => { const theme=window.dashboardTheme.palette(); for(const chart of charts){for(const scale of Object.values(chart.options.scales || {})){if(scale.ticks)scale.ticks.color=theme.muted;if(scale.grid)scale.grid.color=theme.line;}chart.data.datasets.forEach(dataset=>{dataset.borderColor=theme.brand;});chart.update('none');} });
