const el = id => document.getElementById(id);
const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dates = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
const money = value => `฿${currency.format(value)}`;
const dateLabel = value => value ? dates.format(new Date(`${value}T12:00:00`)) : 'ไม่มีบิลขายในช่วงนี้';
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const palette = ['#237d59', '#7eae83', '#b3cfa0', '#d8c984', '#669a9e', '#b499bb', '#c89678', '#7291b5'];
const customerPageSize = 10, productPageSize = 8;
let customers = [], filtered = [], selectedCode = null, detail = null, period = null;
let customerPage = 0, productPage = 0, masterController, detailController, masterRequest = 0, detailRequest = 0;
let filterTimer, masterUpdatedAt, detailOpener, backdropPointerDown = false;
let activeInsightsView = 'customers';

function productViewEvent(type) {
  document.dispatchEvent(new CustomEvent(type, { detail: {
    view: activeInsightsView, start: el('start').value, end: el('end').value, valid: validateDates()
  } }));
}

function switchInsightsView(view) {
  if (view === activeInsightsView) return;
  activeInsightsView = view;
  clearTimeout(filterTimer);
  invalidateMaster();
  el('customers-view-button').setAttribute('aria-pressed', String(view === 'customers'));
  el('products-view-button').setAttribute('aria-pressed', String(view === 'products'));
  el('customer-search').closest('label').hidden = view !== 'customers';
  el('performance-search').closest('label').hidden = view !== 'products';
  el('status').hidden = view !== 'customers';
  productViewEvent('insights-view-change');
  if (view === 'customers') loadCustomers();
}

function node(tag, text = '', className = '') {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}

function message(text, error = false) {
  el('status').textContent = text;
  el('status').classList.toggle('error', error);
}

async function requestJSON(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error(response.status === 404
      ? 'ไม่พบ API ลูกค้า กรุณารีสตาร์ตเซิร์ฟเวอร์ Dashboard แล้วลองใหม่'
      : 'เซิร์ฟเวอร์ส่งข้อมูลผิดรูปแบบ กรุณาเปิดหน้านี้ผ่านเซิร์ฟเวอร์ Dashboard แล้วลองใหม่');
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('ข้อมูลจากเซิร์ฟเวอร์ไม่สมบูรณ์ กรุณากดอัปเดตข้อมูลเพื่อลองใหม่');
  }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่');
  return data;
}

function clearDetail(text = 'เลือกลูกค้าเพื่อดูรายการสินค้าและสัดส่วนหมวดหมู่') {
  detailController?.abort();
  detailController = null;
  detailRequest++;
  detail = null;
  productPage = 0;
  el('detail-content').hidden = true;
  el('detail-retry').hidden = true;
  el('detail-status').hidden = false;
  el('detail-status').textContent = text;
  el('customer-detail').setAttribute('aria-busy', 'false');
  el('product-rows').replaceChildren();
  el('category-legend').replaceChildren();
  el('category-chart').replaceChildren();
}

function closeCustomerDetail() {
  const dialog = el('customer-detail');
  if (dialog.open) dialog.close();
  document.body.classList.remove('customer-dialog-open');
  backdropPointerDown = false;
  clearDetail();
  if (detailOpener?.isConnected) detailOpener.focus({ preventScroll: true });
  detailOpener = null;
}

function openCustomerDetail(code, trigger, revealInTable = false) {
  if (!period || !filtered.some(customer => customer.code === code)) return;
  detailOpener = trigger;
  // Open immediately so loading and retry feedback stay inside the popup.
  selectCustomer(code, revealInTable);
  const dialog = el('customer-detail');
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('customer-dialog-open');
  dialog.scrollTop = 0;
}

function updateSelectedHeading(customer) {
  el('detail-title').textContent = `รายการสินค้าของลูกค้า: ${customer?.name ?? 'ยังไม่ได้เลือก'}`;
  el('detail-subtitle').textContent = customer && period
    ? `${dateLabel(period.start)} – ${dateLabel(period.end)} · ${number.format(customer.invoiceCount)} บิลขาย · ยอดซื้อสุทธิ ${money(customer.net)}`
    : 'เลือกลูกค้าจากกราฟหรือตารางด้านบน';
  el('selected-code').hidden = !customer;
  el('selected-code').textContent = customer ? customer.code || 'ไม่ระบุรหัสลูกค้า' : '';
}

function updateSelection() {
  document.querySelectorAll('[data-customer-code]').forEach(item => {
    const selected = item.dataset.customerCode === selectedCode;
    if (item.tagName === 'TR') item.classList.toggle('selected', selected);
    else item.setAttribute('aria-pressed', String(selected));
  });
}

function emptyRow(body, columns, text) {
  const row = node('tr'), cell = node('td', text, 'empty-state empty-cell');
  cell.colSpan = columns;
  row.append(cell);
  body.append(row);
}

function renderChart() {
  const chart = el('customer-chart');
  chart.replaceChildren();
  const top = filtered.slice(0, 10);
  if (!top.length) {
    chart.append(node('p', 'ไม่พบลูกค้าตามเงื่อนไขที่เลือก\nลองเปลี่ยนช่วงวันที่หรือคำค้นหา', 'empty-state'));
    return;
  }
  const positive = Math.max(0, ...top.map(customer => customer.net));
  const negative = Math.max(0, ...top.map(customer => -customer.net));
  const domain = positive + negative || 1;
  const zero = negative / domain * 100;
  top.forEach((customer, index) => {
    const button = node('button', '', 'bar-row');
    button.type = 'button';
    button.dataset.customerCode = customer.code;
    button.setAttribute('aria-controls', 'customer-detail');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', `${index + 1}. ${customer.name} (${customer.code || 'ไม่ระบุรหัส'}) ยอดซื้อสุทธิ ${money(customer.net)} ดูรายการสินค้า`);
    button.title = `${customer.name} · ${customer.code || 'ไม่ระบุรหัส'} · ${money(customer.net)}`;
    const main = node('span', '', 'bar-main'), track = node('span', '', 'bar-track');
    const bar = node('span', '', `bar-fill${customer.net < 0 ? ' negative' : ''}`);
    bar.style.left = `${customer.net < 0 ? zero - Math.abs(customer.net) / domain * 100 : zero}%`;
    bar.style.width = `${Math.abs(customer.net) / domain * 100}%`;
    if (customer.net === 0) bar.style.display = 'none';
    track.setAttribute('aria-hidden', 'true');
    track.append(bar);
    if (negative > 0) {
      const axis = node('span', '', 'bar-axis');
      axis.style.left = `${Math.min(99.8, zero)}%`;
      track.append(axis);
    }
    main.append(node('span', customer.name, 'bar-name'), track);
    button.append(node('span', String(index + 1).padStart(2, '0'), 'bar-rank'), main,
      node('span', money(customer.net), `bar-value${customer.net < 0 ? ' negative' : ''}`));
    button.addEventListener('click', () => openCustomerDetail(customer.code, button, true));
    chart.append(button);
  });
}

function pagination(prefix, page, size, count, unit) {
  el(`${prefix}-page-info`).textContent = count ? `${number.format(page * size + 1)}–${number.format(Math.min((page + 1) * size, count))} จาก ${number.format(count)} ${unit}` : `0 ${unit}`;
  el(`${prefix}-prev`).disabled = page === 0;
  el(`${prefix}-next`).disabled = (page + 1) * size >= count;
}

function renderCustomers() {
  const body = el('customer-rows');
  body.replaceChildren();
  filtered.slice(customerPage * customerPageSize, (customerPage + 1) * customerPageSize).forEach(customer => {
    const row = node('tr'), nameCell = node('td'), button = node('button', customer.name, 'customer-name');
    row.dataset.customerCode = customer.code;
    button.type = 'button';
    button.dataset.customerCode = customer.code;
    button.title = customer.name;
    button.setAttribute('aria-controls', 'customer-detail');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', `ดูรายการสินค้าของ ${customer.name} (${customer.code || 'ไม่ระบุรหัส'})`);
    nameCell.append(button);
    row.append(node('td', customer.code || 'ไม่ระบุ'), nameCell, node('td', number.format(customer.invoiceCount), 'numeric'),
      node('td', money(customer.net), `numeric${customer.net < 0 ? ' negative' : ''}`));
    // A native button supports keyboard activation; the entire row also accepts clicks.
    row.addEventListener('click', () => openCustomerDetail(customer.code, button));
    body.append(row);
  });
  if (!filtered.length) emptyRow(body, 4, 'ไม่พบลูกค้าตามเงื่อนไขที่เลือก');
  pagination('customer', customerPage, customerPageSize, filtered.length, 'ราย');
  updateSelection();
}

function applySearch() {
  if (!period) return;
  if (el('customer-detail').open) closeCustomerDetail();
  const query = el('customer-search').value.trim().toLocaleLowerCase('th-TH');
  filtered = customers.filter(customer => `${customer.code}\n${customer.name}`.toLocaleLowerCase('th-TH').includes(query));
  customerPage = 0;
  el('total-net').textContent = money(filtered.reduce((sum, customer) => sum + customer.net, 0));
  el('customer-count').textContent = number.format(filtered.length);
  el('invoice-count').textContent = number.format(filtered.reduce((sum, customer) => sum + customer.invoiceCount, 0));
  el('matching-count').textContent = `${number.format(filtered.length)} ราย`;
  renderChart();
  renderCustomers();
  message(filtered.length
    ? `${dateLabel(period.start)} – ${dateLabel(period.end)} · พบลูกค้า ${number.format(filtered.length)} ราย${query ? ` จากทั้งหมด ${number.format(customers.length)} ราย` : ''}`
    : customers.length ? 'ไม่พบลูกค้าที่ตรงกับคำค้นหา ลองค้นหาด้วยรหัสหรือชื่ออื่น' : 'ไม่พบรายการลูกค้าในช่วงวันที่เลือก');
  if (!filtered.some(customer => customer.code === selectedCode)) {
    selectedCode = null;
    clearDetail();
    updateSelectedHeading(null);
  }
}

async function selectCustomer(code, revealInTable = false) {
  const customer = filtered.find(item => item.code === code);
  if (!customer || !period) return;
  if (revealInTable) {
    customerPage = Math.floor(filtered.indexOf(customer) / customerPageSize);
    renderCustomers();
  }
  if (selectedCode === code && (detail || el('customer-detail').getAttribute('aria-busy') === 'true')) {
    updateSelection();
    return;
  }
  selectedCode = code;
  clearDetail(`กำลังโหลดรายการสินค้าของ ${customer.name}…`);
  updateSelectedHeading(customer);
  updateSelection();
  const request = ++detailRequest;
  const controller = new AbortController();
  detailController = controller;
  el('customer-detail').setAttribute('aria-busy', 'true');
  try {
    const query = new URLSearchParams({ ...period, code });
    const data = await requestJSON(`/api/customer-insights/products?${query}`, controller.signal);
    if (request !== detailRequest) return;
    detail = data;
    updateSelectedHeading(data.customer);
    renderProducts();
    renderCategories();
    el('item-total').textContent = `รวมยอดรายการสินค้า ${money(data.itemNet)}`;
    el('detail-status').textContent = `โหลดสินค้าของ ${data.customer.name} แล้ว ${number.format(data.products.length)} รายการ`;
    el('detail-status').hidden = true;
    el('detail-content').hidden = false;
  } catch (error) {
    if (controller.signal.aborted || request !== detailRequest) return;
    el('detail-status').textContent = error.message === 'Failed to fetch' ? 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่' : error.message;
    el('detail-retry').hidden = false;
  } finally {
    if (request === detailRequest) {
      el('customer-detail').setAttribute('aria-busy', 'false');
      detailController = null;
    }
  }
}

function renderProducts() {
  if (!detail) return;
  const body = el('product-rows');
  body.replaceChildren();
  detail.products.slice(productPage * productPageSize, (productPage + 1) * productPageSize).forEach(product => {
    const row = node('tr'), name = node('td', product.name), quantity = node('td', number.format(product.quantity), 'numeric');
    name.append(node('small', product.code));
    quantity.append(node('small', product.unit));
    row.append(name, node('td', product.category, 'category-tag'), quantity,
      node('td', money(product.total), `numeric${product.total < 0 ? ' negative' : ''}`), node('td', dateLabel(product.lastPurchased)));
    body.append(row);
  });
  if (!detail.products.length) emptyRow(body, 5, 'ไม่พบรายการสินค้าในช่วงวันที่เลือก');
  pagination('product', productPage, productPageSize, detail.products.length, 'รายการ');
}

function renderCategories() {
  const svg = el('category-chart'), legend = el('category-legend');
  svg.replaceChildren();
  legend.replaceChildren();
  const positiveTotal = detail.categories.reduce((sum, category) => sum + Math.max(0, Number(category.total)), 0);
  const positives = detail.categories.filter(category => category.total > 0).length;
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.id = 'donut-title';
  title.textContent = positiveTotal > 0 ? `สัดส่วนการซื้อ ${positives} หมวดหมู่ ยอดสุทธิที่เป็นบวกรวม ${money(positiveTotal)} รายละเอียดเปอร์เซ็นต์อยู่ในรายการด้านล่าง` : 'ไม่มีมูลค่าซื้อสุทธิที่เป็นบวกสำหรับคำนวณสัดส่วน';
  svg.append(title);
  const circle = (color, attributes = {}) => {
    const item = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [key, value] of Object.entries({ cx: 100, cy: 100, r: 76, fill: 'none', stroke: color, 'stroke-width': 24, ...attributes })) item.setAttribute(key, String(value));
    svg.append(item);
    return item;
  };
  circle('#edf3ee');
  let offset = 0;
  detail.categories.forEach((category, index) => {
    const percent = positiveTotal > 0 && category.total > 0 ? category.total / positiveTotal * 100 : 0;
    const color = category.total > 0 ? palette[index % palette.length] : '#c5cec7';
    if (percent > 0) {
      const segment = circle(color, { pathLength: 100, 'stroke-dasharray': `${percent} ${100 - percent}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 100 100)' });
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      tip.textContent = `${category.name}: ${number.format(percent)}% · ${money(category.total)}`;
      segment.append(tip);
      offset += percent;
    }
    const item = node('li'), dot = node('span', '', 'legend-dot'), name = node('span', category.name, 'legend-name');
    dot.style.backgroundColor = color;
    dot.setAttribute('aria-hidden', 'true');
    name.append(node('small', money(category.total)));
    item.append(dot, name, node('span', percent > 0 ? `${number.format(percent)}%` : '—', 'legend-percent'));
    legend.append(item);
  });
  el('category-count').textContent = number.format(positives);
  el('category-empty').hidden = positiveTotal > 0;
  el('category-note').textContent = detail.categories.some(category => category.total <= 0)
    ? 'คำนวณสัดส่วนเฉพาะหมวดที่มียอดสุทธิมากกว่า 0 หมวดที่เป็นศูนย์หรือติดลบแสดงยอดไว้โดยไม่คิดเปอร์เซ็นต์ · หมวดหมู่อ้างอิงทะเบียนสินค้าปัจจุบัน'
    : 'สัดส่วน = ยอดสุทธิหมวดหมู่ ÷ ยอดสุทธิสินค้ารวม · หมวดหมู่อ้างอิงทะเบียนสินค้าปัจจุบัน';
}

function validateDates() {
  const start = el('start'), end = el('end');
  end.setCustomValidity('');
  if (start.value && end.value && (start.value > end.value || (Date.parse(end.value) - Date.parse(start.value)) / 86400000 > 365)) {
    end.setCustomValidity('กรุณาเลือกวันสิ้นสุดตั้งแต่วันเริ่มต้น และช่วงเวลาไม่เกิน 366 วัน');
  }
  return el('customer-filters').checkValidity();
}

function invalidateMaster() {
  if (el('customer-detail').open) closeCustomerDetail();
  masterController?.abort();
  masterRequest++;
  period = null;
  customers = [];
  filtered = [];
  clearDetail();
  el('customer-dashboard').hidden = true;
  el('refresh').disabled = false;
}

async function loadCustomers() {
  if (activeInsightsView !== 'customers') return;
  clearTimeout(filterTimer);
  invalidateMaster();
  if (!validateDates()) {
    message('กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน', true);
    return;
  }
  const selectedBefore = selectedCode;
  const requestedPeriod = { start: el('start').value, end: el('end').value };
  const controller = new AbortController();
  masterController = controller;
  const request = ++masterRequest;
  message('กำลังโหลดข้อมูลลูกค้าจาก SML…');
  el('refresh').disabled = true;
  try {
    const data = await requestJSON(`/api/customer-insights?${new URLSearchParams(requestedPeriod)}`, controller.signal);
    if (request !== masterRequest) return;
    customers = data.customers.map(customer => ({ ...customer, net: Number(customer.net), invoiceCount: Number(customer.invoiceCount) }))
      .sort((a, b) => b.net - a.net || a.code.localeCompare(b.code, 'th'));
    period = requestedPeriod;
    masterUpdatedAt = data.updatedAt;
    selectedCode = null;
    // Keep a selected customer across date changes only if it still matches both filters.
    const query = el('customer-search').value.trim().toLocaleLowerCase('th-TH');
    const previous = customers.find(customer => customer.code === selectedBefore && `${customer.code}\n${customer.name}`.toLocaleLowerCase('th-TH').includes(query));
    if (previous) selectedCode = previous.code;
    detailController = null;
    el('customer-dashboard').hidden = false;
    applySearch();
    el('updated').textContent = `อัปเดตข้อมูล ${new Date(masterUpdatedAt).toLocaleString('th-TH')}`;
  } catch (error) {
    if (controller.signal.aborted || request !== masterRequest) return;
    message(error.message === 'Failed to fetch' ? 'เชื่อมต่อ SML ไม่สำเร็จ กรุณากดอัปเดตข้อมูลเพื่อลองใหม่' : error.message, true);
  } finally {
    if (request === masterRequest) el('refresh').disabled = false;
  }
}

el('customer-filters').addEventListener('submit', event => {
  event.preventDefault();
  if (activeInsightsView === 'customers') loadCustomers();
  else productViewEvent('insights-product-refresh');
});
el('customers-view-button').addEventListener('click', () => switchInsightsView('customers'));
el('products-view-button').addEventListener('click', () => switchInsightsView('products'));
el('customer-search').addEventListener('input', applySearch);
for (const id of ['start', 'end']) {
  el(id).addEventListener('input', () => {
    invalidateMaster();
    clearTimeout(filterTimer);
    if (activeInsightsView === 'products') {
      productViewEvent('insights-period-change');
      return;
    }
    if (validateDates()) {
      message('กำลังอัปเดตข้อมูลตามช่วงวันที่…');
      filterTimer = setTimeout(loadCustomers, 250);
    } else message('กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน', true);
  });
}
for (const [prefix, size] of [['customer', customerPageSize], ['product', productPageSize]]) {
  for (const [direction, change] of [['prev', -1], ['next', 1]]) {
    el(`${prefix}-${direction}`).addEventListener('click', () => {
      if (prefix === 'customer') {
        customerPage = Math.max(0, Math.min(Math.max(0, Math.ceil(filtered.length / size) - 1), customerPage + change));
        renderCustomers();
      } else if (detail) {
        productPage = Math.max(0, Math.min(Math.max(0, Math.ceil(detail.products.length / size) - 1), productPage + change));
        renderProducts();
      }
    });
  }
}
el('detail-retry').addEventListener('click', () => selectCustomer(selectedCode));
el('detail-close').addEventListener('click', closeCustomerDetail);
el('customer-detail').addEventListener('cancel', event => {
  event.preventDefault();
  closeCustomerDetail();
});
el('customer-detail').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...el('customer-detail').querySelectorAll('button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter(control => control.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
});
el('customer-detail').addEventListener('close', () => {
  // Ignore a queued close event if the user has already opened another customer.
  if (!el('customer-detail').open && document.body.classList.contains('customer-dialog-open')) closeCustomerDetail();
});
function outsideDetail(event) {
  const bounds = el('customer-detail').getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
}
el('customer-detail').addEventListener('pointerdown', event => { backdropPointerDown = outsideDetail(event); });
el('customer-detail').addEventListener('click', event => {
  if (backdropPointerDown && outsideDetail(event)) closeCustomerDetail();
  backdropPointerDown = false;
});
const today = new Date();
el('start').value = iso(new Date(today.getFullYear(), today.getMonth(), 1));
el('end').value = iso(today);
loadCustomers();
