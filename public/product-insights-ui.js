(() => {
  const byId = id => document.getElementById(id);
  const num = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
  const baht = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dayFormat = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  const money = value => `฿${baht.format(value)}`;
  const date = value => value ? dayFormat.format(new Date(`${value}T12:00:00`)) : 'ไม่มีบิลขายในช่วงนี้';
  const pageSize = 10;
  let active = false, data = null, scope = [], visible = [], page = 0, mode = 'all';
  let controller, requestId = 0, reloadTimer, buyerController, buyerRequest = 0, buyerData, buyerPage = 0, selectedSku, opener, outsideDown = false;

  function node(tag, text = '', className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  const descending = (a, b) => b.net - a.net || a.code.localeCompare(b.code, 'th');
  const declining = item => item.previousNet > 0 && item.net < item.previousNet;
  const unsold = item => item.registered && item.invoiceCount === 0;
  const change = item => item.previousNet > 0 ? (item.net - item.previousNet) / item.previousNet * 100 : null;
  function changeLabel(item) {
    const percent = change(item);
    return percent === null ? 'ไม่มีฐานบวกให้เทียบ' : `${percent > 0 ? '+' : ''}${num.format(percent)}%`;
  }
  function quantitiesCell(quantities) {
    const cell = node('td', '', 'numeric quantity-lines');
    if (!quantities.length) cell.textContent = '—';
    quantities.forEach(quantity => cell.append(node('span', `${num.format(quantity.net)} ${quantity.unit}`)));
    return cell;
  }
  function empty(body, count, text) {
    const row = node('tr'), cell = node('td', text, 'empty-state empty-cell');
    cell.colSpan = count; row.append(cell); body.append(row);
  }
  function pager(prefix, index, count) {
    byId(`${prefix}-page-info`).textContent = count ? `${num.format(index * pageSize + 1)}–${num.format(Math.min((index + 1) * pageSize, count))} จาก ${num.format(count)} รายการ` : '0 รายการ';
    byId(`${prefix}-prev`).disabled = index === 0;
    byId(`${prefix}-next`).disabled = (index + 1) * pageSize >= count;
  }
  function status(text, error = false) {
    byId('performance-status').textContent = text;
    byId('performance-status').classList.toggle('error', error);
  }
  async function getJSON(url, signal) {
    const response = await fetch(url, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('ไม่พบข้อมูล API สินค้า กรุณารีสตาร์ตเซิร์ฟเวอร์ Dashboard แล้วลองใหม่');
    let result;
    try { result = await response.json(); }
    catch (error) {
      if (error.name !== 'SyntaxError') throw error;
      throw new Error('ข้อมูลสินค้าจากเซิร์ฟเวอร์ไม่สมบูรณ์ กรุณาลองใหม่');
    }
    if (!response.ok) throw new Error(result.error || 'โหลดข้อมูลสินค้าไม่สำเร็จ กรุณาลองใหม่');
    return result;
  }

  function reset() {
    controller?.abort(); requestId++;
    clearTimeout(reloadTimer);
    data = null; scope = []; visible = [];
    byId('performance-dashboard').hidden = true;
    if (byId('sku-detail').open) closeSku();
  }
  async function load(detail) {
    reset();
    if (!active) return;
    if (!detail.valid) { status('กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน', true); byId('refresh').disabled = false; return; }
    const currentRequest = ++requestId;
    const currentController = new AbortController(); controller = currentController;
    byId('refresh').disabled = true;
    status('กำลังวิเคราะห์ยอดขายสินค้าและเปรียบเทียบช่วงก่อนหน้าจาก SML…');
    try {
      const result = await getJSON(`/api/customer-insights/catalog?${new URLSearchParams({ start: detail.start, end: detail.end })}`, currentController.signal);
      if (currentRequest !== requestId || !active) return;
      data = result;
      data.products = result.products.map(item => ({ ...item, net: Number(item.net), previousNet: Number(item.previousNet), invoiceCount: Number(item.invoiceCount), buyerCount: Number(item.buyerCount) }));
      const category = byId('performance-category'), previousCategory = category.value;
      const groups = new Map(data.products.map(item => [item.categoryCode, item.category]));
      category.replaceChildren(new Option('ทุกหมวดหมู่', '*'));
      [...groups].sort((a, b) => a[1].localeCompare(b[1], 'th')).forEach(([code, name]) => category.append(new Option(name, code)));
      category.value = groups.has(previousCategory) ? previousCategory : '*';
      byId('performance-dashboard').hidden = false;
      byId('performance-period').textContent = `${date(data.start)} – ${date(data.end)} · เทียบ ${date(data.previous.start)} – ${date(data.previous.end)} (${num.format(data.previous.days)} วันเท่ากัน)`;
      byId('performance-updated').textContent = `อัปเดต ${new Date(data.updatedAt).toLocaleString('th-TH')}`;
      renderScope();
    } catch (error) {
      if (currentController.signal.aborted || currentRequest !== requestId) return;
      status(error.message === 'Failed to fetch' ? 'เชื่อมต่อ SML ไม่สำเร็จ กรุณากดอัปเดตข้อมูลเพื่อลองใหม่' : error.message, true);
    } finally { if (currentRequest === requestId && active) byId('refresh').disabled = false; }
  }

  function renderScope() {
    if (!data) return;
    const search = byId('performance-search').value.trim().toLocaleLowerCase('th-TH'), category = byId('performance-category').value;
    scope = data.products.filter(item => (category === '*' || item.categoryCode === category)
      && `${item.code}\n${item.name}`.toLocaleLowerCase('th-TH').includes(search));
    const total = scope.reduce((sum, item) => sum + item.net, 0), previous = scope.reduce((sum, item) => sum + item.previousNet, 0);
    byId('performance-net').textContent = money(total);
    byId('performance-net-change').textContent = `${changeLabel({ net: total, previousNet: previous })} · เทียบช่วงก่อนหน้า`;
    byId('performance-sold').textContent = num.format(scope.filter(item => item.invoiceCount > 0).length);
    byId('performance-unsold').textContent = num.format(scope.filter(unsold).length);
    byId('performance-declining').textContent = num.format(scope.filter(declining).length);
    renderLeaders('performance-best', scope.filter(item => item.net > 0 && item.invoiceCount > 0).sort(descending).slice(0, 5), false);
    renderLeaders('performance-watch', scope.filter(declining).sort((a, b) => (b.previousNet - b.net) - (a.previousNet - a.net) || a.code.localeCompare(b.code)).slice(0, 5), true);
    status(scope.length ? `พบ ${num.format(scope.length)} รหัสสินค้า · คลิกสินค้าเพื่อดูจำนวนขายและลูกค้าที่ซื้อ` : 'ไม่พบสินค้าตามคำค้นหาและหมวดหมู่ที่เลือก');
    page = 0; renderTable();
  }
  function renderLeaders(id, products, watch) {
    const container = byId(id); container.replaceChildren();
    products.forEach((item, index) => {
      const button = node('button', '', 'performance-leader'), label = node('span', '', 'leader-label');
      button.type = 'button'; button.title = item.name;
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'sku-detail');
      label.append(node('strong', item.name), node('small', item.code));
      const value = node('span', watch ? `−${money(item.previousNet - item.net)}` : money(item.net), `leader-value${watch ? ' performance-negative' : ''}`);
      value.append(node('small', watch ? `ปัจจุบัน ${money(item.net)} · ${changeLabel(item)}` : `${num.format(item.buyerCount)} ลูกค้า · ${num.format(item.invoiceCount)} บิล`));
      button.append(node('span', String(index + 1).padStart(2, '0')), label, value);
      button.addEventListener('click', () => openSku(item, button)); container.append(button);
    });
    if (!products.length) container.append(node('p', watch ? 'ไม่พบสินค้าที่มียอดลดลงจากฐานบวกในช่วงเปรียบเทียบ' : 'ยังไม่มีสินค้าที่มียอดขายสุทธิเป็นบวกตามตัวกรอง', 'empty-state'));
  }

  function renderTable() {
    const modes = {
      all: ['สินค้าทั้งหมด', 'เรียงยอดสุทธิสูงไปต่ำ รวมสินค้าจากทะเบียนและสินค้าที่มีรายการในสองช่วงเวลา', () => scope.slice().sort(descending)],
      sold: ['สินค้าที่มีบิลขาย', 'มีเอกสารขายอย่างน้อย 1 บิลในช่วงที่เลือก รวมรายการที่ยอดสุทธิไม่บวก', () => scope.filter(item => item.invoiceCount > 0).sort(descending)],
      best: ['สินค้าขายดี 10 อันดับ', '10 อันดับยอดสุทธิสูงสุด เฉพาะสินค้าที่มีบิลขายและยอดสุทธิเป็นบวก', () => scope.filter(item => item.invoiceCount > 0 && item.net > 0).sort(descending).slice(0, 10)],
      slow: ['สินค้าขายน้อย 10 อันดับ', '10 อันดับยอดสุทธิต่ำสุดที่ยังเป็นบวกและมีบิลขาย เป็นการเปรียบเทียบในกลุ่มที่ค้นหา ไม่ใช่เกณฑ์ยอดขายเป้าหมาย', () => scope.filter(item => item.invoiceCount > 0 && item.net > 0).sort((a, b) => a.net - b.net || a.code.localeCompare(b.code)).slice(0, 10)],
      declining: ['สินค้าที่มียอดลดลง', 'ยอดสุทธิน้อยกว่าช่วงก่อนหน้าที่มีฐานมากกว่า 0 เรียงตามยอดเงินที่ลดลงมากที่สุด', () => scope.filter(declining).sort((a, b) => (b.previousNet - b.net) - (a.previousNet - a.net) || a.code.localeCompare(b.code))],
      unsold: ['สินค้าที่ยังไม่มีบิลขาย', 'สินค้าในทะเบียนที่ไม่มีเอกสารขายในช่วงที่เลือก อาจมีรับคืน/เพิ่มหนี้ เรียงคงเหลือในทะเบียนจากมากไปน้อย', () => scope.filter(unsold).sort((a, b) => (b.stock ?? -Infinity) - (a.stock ?? -Infinity) || a.code.localeCompare(b.code))],
      nonpositive: ['สินค้ามีบิลขาย แต่ยอดสุทธิไม่บวก', 'มีเอกสารขาย แต่ยอดขาย + เพิ่มหนี้ − รับคืน ไม่เกิน 0 บาท ควรตรวจรายการศูนย์บาทหรือรับคืน', () => scope.filter(item => item.invoiceCount > 0 && item.net <= 0).sort((a, b) => a.net - b.net || a.code.localeCompare(b.code))]
    };
    const [title, explanation, filter] = modes[mode]; visible = filter();
    byId('performance-table-title').textContent = title;
    byId('performance-explanation').textContent = `${explanation} · ${num.format(visible.length)} รหัสสินค้า`;
    document.querySelectorAll('[data-performance-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.performanceFilter === mode)));
    const body = byId('performance-rows'); body.replaceChildren();
    visible.slice(page * pageSize, (page + 1) * pageSize).forEach(item => {
      const row = node('tr'), name = node('td'), button = node('button', item.name, 'performance-product-button');
      button.type = 'button'; button.dataset.sku = item.code;
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'sku-detail');
      button.addEventListener('click', () => openSku(item, button));
      name.append(button, node('small', `${item.code} · ${item.category}`));
      const statusText = item.invoiceCount === 0 ? (item.registered ? 'ไม่มีบิลขาย' : 'ไม่มีบิลขาย / ไม่พบในทะเบียน') : item.net <= 0 ? 'สุทธิไม่บวก' : declining(item) ? 'ยอดลดลง' : 'มีบิลขาย';
      name.append(node('span', statusText, `product-status ${item.invoiceCount === 0 || item.net <= 0 || declining(item) ? 'watch' : 'good'}`));
      const bills = node('td', `${num.format(item.invoiceCount)} บิล`, 'numeric'); bills.append(node('small', `${num.format(item.buyerCount)} ลูกค้า`));
      const trend = node('td', changeLabel(item), `numeric ${declining(item) ? 'performance-negative' : item.previousNet > 0 && item.net > item.previousNet ? 'performance-positive' : ''}`);
      trend.append(node('small', `ก่อนหน้า ${money(item.previousNet)}`));
      const stock = node('td', item.stock == null ? 'ไม่มีข้อมูล' : `${num.format(item.stock)} ${item.stockUnit}`, 'numeric');
      row.append(name, quantitiesCell(item.quantities), node('td', money(item.net), `numeric${item.net < 0 ? ' performance-negative' : ''}`), bills, trend, stock, node('td', date(item.lastSold)));
      body.append(row);
    });
    if (!visible.length) empty(body, 7, 'ไม่พบสินค้าในกลุ่มนี้ ลองเปลี่ยนคำค้นหา หมวดหมู่ หรือกลุ่มสินค้า');
    pager('performance', page, visible.length);
  }

  function closeSku() {
    if (byId('sku-detail').open) byId('sku-detail').close();
    buyerController?.abort(); buyerRequest++; buyerController = null; buyerData = null;
    byId('sku-content').hidden = true; byId('sku-detail').setAttribute('aria-busy', 'false');
    document.body.classList.remove('product-dialog-open'); outsideDown = false;
    if (opener?.isConnected) opener.focus({ preventScroll: true }); opener = null;
  }
  async function openSku(item, trigger) {
    if (!data || !active) return;
    buyerController?.abort(); const currentController = new AbortController(); buyerController = currentController;
    const currentRequest = ++buyerRequest; selectedSku = item; opener = trigger; buyerPage = 0; buyerData = null;
    const dialog = byId('sku-detail');
    byId('sku-title').textContent = item.name;
    byId('sku-subtitle').textContent = `${item.code} · ${item.category} · ${date(data.start)} – ${date(data.end)}`;
    byId('sku-status').textContent = 'กำลังโหลดจำนวนขายและลูกค้าที่มีรายการ…'; byId('sku-status').hidden = false;
    byId('sku-content').hidden = true; byId('sku-retry').hidden = true;
    dialog.setAttribute('aria-busy', 'true');
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('product-dialog-open'); dialog.scrollTop = 0;
    try {
      const result = await getJSON(`/api/customer-insights/product-buyers?${new URLSearchParams({ start: data.start, end: data.end, code: item.code })}`, currentController.signal);
      if (currentRequest !== buyerRequest) return;
      buyerData = result; const product = result.product;
      byId('sku-net').textContent = money(product.net); byId('sku-change').textContent = `${changeLabel(product)} · เทียบ ${date(result.previous.start)} – ${date(result.previous.end)}`;
      byId('sku-sales').textContent = money(product.sales); byId('sku-added').textContent = `เพิ่มหนี้ ${money(product.added)}`;
      byId('sku-returns').textContent = money(product.returns); byId('sku-buyers-count').textContent = `${num.format(product.buyerCount)} ราย`;
      byId('sku-bills').textContent = `${num.format(product.invoiceCount)} บิลขาย`;
      const quantities = byId('sku-quantities'); quantities.replaceChildren();
      product.quantities.forEach(quantity => {
        const row = node('tr'); row.append(node('td', quantity.unit));
        for (const key of ['sold', 'added', 'returned', 'net']) row.append(node('td', num.format(quantity[key]), 'numeric'));
        quantities.append(row);
      });
      if (!product.quantities.length) empty(quantities, 5, 'ไม่มีรายการขาย เพิ่มหนี้ หรือรับคืนของสินค้านี้ในช่วงที่เลือก');
      renderBuyers(); byId('sku-status').hidden = true; byId('sku-content').hidden = false;
    } catch (error) {
      if (currentController.signal.aborted || currentRequest !== buyerRequest) return;
      byId('sku-status').textContent = error.message === 'Failed to fetch' ? 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่' : error.message;
      byId('sku-retry').hidden = false;
    } finally { if (currentRequest === buyerRequest) { dialog.setAttribute('aria-busy', 'false'); buyerController = null; } }
  }
  function renderBuyers() {
    const body = byId('sku-buyers'); body.replaceChildren();
    buyerData.buyers.slice(buyerPage * pageSize, (buyerPage + 1) * pageSize).forEach(buyer => {
      const row = node('tr'), name = node('td', buyer.name); name.append(node('small', buyer.code || 'ไม่ระบุรหัสลูกค้า'));
      row.append(name, quantitiesCell(buyer.quantities), node('td', num.format(buyer.invoiceCount), 'numeric'), node('td', money(buyer.net), 'numeric'), node('td', date(buyer.lastSold)));
      body.append(row);
    });
    if (!buyerData.buyers.length) empty(body, 5, 'ยังไม่มีลูกค้าที่มีรายการสินค้านี้ในช่วงวันที่เลือก');
    pager('sku', buyerPage, buyerData.buyers.length);
  }

  document.addEventListener('insights-view-change', event => {
    active = event.detail.view === 'products'; reset(); byId('product-view').hidden = !active;
    if (active) load(event.detail);
  });
  document.addEventListener('insights-product-refresh', event => { if (active) load(event.detail); });
  document.addEventListener('insights-period-change', event => {
    if (!active) return;
    reset(); byId('refresh').disabled = false;
    status(event.detail.valid ? 'กำลังอัปเดตการวิเคราะห์สินค้าตามช่วงวันที่…' : 'กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน', !event.detail.valid);
    if (event.detail.valid) reloadTimer = setTimeout(() => load(event.detail), 250);
  });
  byId('performance-search').addEventListener('input', renderScope);
  byId('performance-category').addEventListener('change', renderScope);
  document.querySelectorAll('[data-performance-filter]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.performanceFilter; page = 0; if (data) renderTable(); }));
  for (const [direction, delta] of [['prev', -1], ['next', 1]]) {
    byId(`performance-${direction}`).addEventListener('click', () => { page += delta; renderTable(); });
    byId(`sku-${direction}`).addEventListener('click', () => { buyerPage += delta; renderBuyers(); });
  }
  byId('sku-retry').addEventListener('click', () => openSku(selectedSku, opener));
  byId('sku-close').addEventListener('click', closeSku);
  byId('sku-detail').addEventListener('cancel', event => { event.preventDefault(); closeSku(); });
  byId('sku-detail').addEventListener('close', () => { if (!byId('sku-detail').open && document.body.classList.contains('product-dialog-open')) closeSku(); });
  function outside(event) { const bounds = byId('sku-detail').getBoundingClientRect(); return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom; }
  byId('sku-detail').addEventListener('pointerdown', event => { outsideDown = outside(event); });
  byId('sku-detail').addEventListener('click', event => { if (outsideDown && outside(event)) closeSku(); outsideDown = false; });
  byId('sku-detail').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...byId('sku-detail').querySelectorAll('button:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(control => control.getClientRects().length);
    if ((event.shiftKey && document.activeElement === controls[0]) || (!event.shiftKey && document.activeElement === controls.at(-1))) {
      event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  });
})();
