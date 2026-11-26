// จัดการออเดอร์ออนไลน์ (WooCommerce · proplusaudio.com). All data comes from /api/online-orders/* (server keeps the
// WooCommerce keys); the server re-checks orders_view / orders_update on every call, the UI only hides controls.
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n, digits = 2) => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const count = n => Number(n || 0).toLocaleString('th-TH');
  const TZ = 'Asia/Bangkok';
  const thaiDateTime = iso => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.' : '—');
  const thaiDate = ymd => new Date(ymd + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const telHref = phone => 'tel:' + String(phone).replace(/[^\d+]/g, '');

  const STATUS = {
    pending: ['รอชำระเงิน', 'gold'], 'on-hold': ['พักไว้ / รอตรวจสลิป', 'gold'], processing: ['รอจัดส่ง', 'blue'],
    completed: ['สำเร็จ / ส่งแล้ว', 'green'], cancelled: ['ยกเลิก', 'neutral'], refunded: ['คืนเงิน', 'red'],
    failed: ['ชำระไม่สำเร็จ', 'red'], 'checkout-draft': ['ร่าง', 'neutral'],
  };
  const TAB_LABEL = { verify: 'ตรวจชำระ', processing: 'รอจัดส่ง', completed: 'ส่งแล้ว', closed: 'ยกเลิก/คืนเงิน', any: 'ทั้งหมด' };
  // Single WooCommerce statuses (e.g. from a ยอดขายเว็บไซต์ chart link) open the tab that contains them.
  const TAB_OF = { pending: 'verify', 'on-hold': 'verify', processing: 'processing', completed: 'completed', cancelled: 'closed', refunded: 'closed', failed: 'closed', 'checkout-draft': 'any' };
  const CARRIERS = ['Kerry Express', 'Flash Express', 'J&T Express', 'ไปรษณีย์ไทย (EMS)', 'ไปรษณีย์ไทย (ลงทะเบียน)', 'Best Express', 'Ninja Van', 'DHL eCommerce', 'SCG Express', 'Nim Express', 'Lalamove', 'ขนส่งของร้านเอง'];
  const verifyBadge = () => { const b = el('span', 'oo-badge', 'รอตรวจสลิป'); b.dataset.tone = 'gold'; return b; };
  const badge = status => { const [label, tone] = STATUS[status] || [status, 'neutral']; const b = el('span', 'oo-badge', label); b.dataset.tone = tone; return b; };

  async function api(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetch(path, {
        method, cache: 'no-store',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); }
    let data = null;
    try { data = await response.json(); } catch {}
    if (response.status === 403) throw new Error(data?.error === 'ไม่มีสิทธิ์เข้าถึง' ? 'คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อ Super Admin' : data?.error || 'คุณไม่มีสิทธิ์ทำรายการนี้');
    if (!response.ok) throw new Error(data?.error || 'เรียกข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    return data;
  }

  // ---------- state
  const state = { view: 'orders', status: 'verify', page: 1, search: '', me: { canUpdate: false }, ordersReq: 0, summaryReq: 0, salesLoaded: false, filter: null };
  // Drill-down from หน้าเว็บไซต์: ?start=&end=&product=&pname=&status= (the server validates every value again).
  {
    const p = new URLSearchParams(location.search), ymd = /^d{4}-d{2}-d{2}$/;
    if (ymd.test(p.get('start') || '') || /^d+$/.test(p.get('product') || '')) {
      state.filter = { start: ymd.test(p.get('start') || '') ? p.get('start') : '', end: ymd.test(p.get('end') || '') ? p.get('end') : '', product: /^d+$/.test(p.get('product') || '') ? p.get('product') : '', pname: (p.get('pname') || '').slice(0, 120) };
      const st = p.get('status');
      if (st && (TAB_LABEL[st] || TAB_OF[st])) state.status = TAB_LABEL[st] ? st : TAB_OF[st];
    }
  }
  const thShort = ymd => new Date(ymd + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  function renderFilterChip() {
    document.querySelector('.oo-filter-chip')?.remove();
    const f = state.filter;
    if (!f) return;
    const parts = [];
    if (f.start) parts.push(f.start === f.end || !f.end ? 'วันที่ ' + thShort(f.start) : `${thShort(f.start)} – ${thShort(f.end)}`);
    if (f.product) parts.push('สินค้า ' + (f.pname || '#' + f.product));
    const chip = el('div', 'oo-filter-chip');
    chip.append(el('span', '', 'กรองจากหน้าเว็บไซต์: ' + parts.join(' · ')));
    const x = el('button', 'mp-btn mp-btn-sm', '✕ ล้างตัวกรอง'); x.type = 'button';
    x.addEventListener('click', () => { state.filter = null; history.replaceState(null, '', location.pathname + location.hash); state.page = 1; renderFilterChip(); loadOrders(); });
    chip.append(x);
    document.querySelector('#orders-panel .mp-panel-head').after(chip);
  }
  const live = $('live');
  const setLive = (text, s) => { live.textContent = text; if (s) live.dataset.state = s; else delete live.dataset.state; };

  // ---------- view switching
  const viewTabs = [...document.querySelectorAll('.mp-tabs [role=tab]')];
  function selectView(view, push = true) {
    state.view = view;
    document.body.dataset.view = view;
    viewTabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    $('view-orders').hidden = view !== 'orders';
    $('orders-panel').hidden = view !== 'orders';
    $('view-sales').hidden = view !== 'sales';
    $('sales-panels').hidden = view !== 'sales';
    if (push && !location.hash.startsWith('#order-')) history.replaceState(null, '', view === 'sales' ? '#sales' : location.pathname + location.search);
    if (view === 'sales' && !state.salesLoaded) loadSales();
  }
  viewTabs.forEach(t => t.addEventListener('click', () => selectView(t.dataset.view)));

  // ---------- summary cards
  async function loadSummary() {
    const id = ++state.summaryReq;
    $('summary-status').textContent = '';
    $('summary-status').className = 'ov-status';
    document.querySelector('.oo-kpis').classList.add('is-loading');
    try {
      const s = await api('/api/online-orders/summary');
      if (id !== state.summaryReq) return;
      $('kpi-awaiting').textContent = count(s.awaitingPayment);
      $('kpi-awaiting-foot').textContent = `รอชำระเงิน ${count(s.pending)} · พักไว้ ${count(s.onHold)} · โอนแล้วรอตรวจ ${count(s.unverified || 0)}`;
      $('kpi-processing').textContent = count(s.processing);
      $('kpi-today').textContent = count(s.completedToday);
      $('kpi-overdue').textContent = count(s.overdue);
      $('kpi-overdue').classList.toggle('down', s.overdue > 0);
    } catch (error) {
      if (id !== state.summaryReq) return;
      for (const k of ['kpi-awaiting', 'kpi-processing', 'kpi-today', 'kpi-overdue']) $(k).textContent = '—';
      $('summary-status').textContent = 'โหลดสรุปไม่สำเร็จ: ' + error.message;
      $('summary-status').className = 'ov-status error';
    } finally {
      if (id === state.summaryReq) document.querySelector('.oo-kpis').classList.remove('is-loading');
    }
  }
  document.querySelectorAll('.oo-kpis [data-filter]').forEach(card => {
    const go = () => { setStatus(card.dataset.filter); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  // ---------- order list
  const statusButtons = [...document.querySelectorAll('.oo-status-tabs [data-status]')];
  function setStatus(status) {
    state.status = status; state.page = 1;
    statusButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
    loadOrders();
  }
  statusButtons.forEach(b => b.addEventListener('click', () => setStatus(b.dataset.status)));
  $('search-form').addEventListener('submit', e => { e.preventDefault(); state.search = $('search').value.trim(); state.page = 1; loadOrders(); });
  $('search').addEventListener('search', () => { if (!$('search').value && state.search) { state.search = ''; state.page = 1; loadOrders(); } });
  $('prev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadOrders(); } });
  $('next').addEventListener('click', () => { state.page++; loadOrders(); });

  async function loadOrders({ quiet = false } = {}) {
    const id = ++state.ordersReq;
    const stateEl = $('orders-state');
    $('orders-title').textContent = 'ออเดอร์ · ' + TAB_LABEL[state.status] + (state.search ? ` · ค้นหา "${state.search}"` : '');
    if (!quiet) { stateEl.hidden = false; stateEl.removeAttribute('data-state'); stateEl.textContent = 'กำลังโหลดออเดอร์…'; $('orders-wrap').classList.add('is-loading'); }
    try {
      const q = new URLSearchParams({ status: state.status, page: state.page, per_page: 50 });
      if (state.search) q.set('q', state.search);
      if (state.filter?.start) { q.set('start', state.filter.start); q.set('end', state.filter.end || state.filter.start); }
      if (state.filter?.product) q.set('product', state.filter.product);
      const data = await api('/api/online-orders?' + q);
      if (id !== state.ordersReq) return;
      renderOrders(data);
      setLive('อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.', 'connected');
    } catch (error) {
      if (id !== state.ordersReq) return;
      setLive('เชื่อมต่อเว็บไซต์ไม่สำเร็จ', 'failed');
      if (quiet && !$('orders-wrap').hidden) return; // keep the last good list on a failed background refresh
      $('orders-wrap').hidden = true; $('pager').hidden = true; $('orders-count').textContent = '';
      stateEl.hidden = false; stateEl.dataset.state = 'error'; stateEl.textContent = 'โหลดออเดอร์ไม่สำเร็จ: ' + error.message;
    } finally {
      if (id === state.ordersReq) $('orders-wrap').classList.remove('is-loading');
    }
  }

  function renderOrders(data) {
    const stateEl = $('orders-state');
    $('orders-count').textContent = data.total ? `ทั้งหมด ${count(data.total)} ออเดอร์` : '';
    if (!data.orders.length) {
      $('orders-wrap').hidden = true; $('pager').hidden = true;
      stateEl.hidden = false; stateEl.removeAttribute('data-state');
      stateEl.textContent = state.search ? 'ไม่พบออเดอร์ที่ตรงกับคำค้นหา' : 'ไม่มีออเดอร์ในสถานะนี้';
      return;
    }
    stateEl.hidden = true;
    const overdueBefore = Date.now() - 2 * 86400000;
    $('orders-body').replaceChildren(...data.orders.map(o => {
      const tr = el('tr', 'oo-row');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'link');
      tr.setAttribute('aria-label', `เปิดออเดอร์ #${o.number}`);
      const no = el('td', 'oo-no');
      no.append(el('strong', '', '#' + o.number));
      if (o.hasNote) { const n = el('span', 'oo-note-dot', '✎'); n.title = 'ลูกค้าฝากข้อความ'; n.setAttribute('aria-label', 'ลูกค้าฝากข้อความ'); no.append(n); }
      const date = el('td', '', thaiDateTime(o.dateCreated));
      if (o.status === 'processing' && Date.parse(o.dateCreated) < overdueBefore) { date.append(el('span', 'oo-late', 'ค้าง')); }
      const cust = el('td', 'oo-cust');
      cust.append(el('span', '', o.customer));
      if (o.phone) cust.append(el('small', '', o.phone));
      const st = el('td'); st.append(o.needsVerify && o.status === 'processing' ? verifyBadge() : badge(o.status));
      tr.append(no, date, cust, el('td', 'num', money(o.total)), el('td', 'oo-pay', o.paymentMethod || '—'), st);
      const open = () => openOrder(o.id);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      return tr;
    }));
    $('orders-wrap').hidden = false;
    $('pager').hidden = data.totalPages <= 1;
    $('page-label').textContent = `หน้า ${count(data.page)} / ${count(data.totalPages)}`;
    $('prev').disabled = data.page <= 1;
    $('next').disabled = data.page >= data.totalPages;
  }

  // ---------- order detail
  const dialog = $('order-dialog'), body = $('od-body');
  let current = null, detailReq = 0;
  $('od-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (location.hash.startsWith('#order-')) history.replaceState(null, '', state.view === 'sales' ? '#sales' : location.pathname + location.search); current = null; });

  async function openOrder(id) {
    const req = ++detailReq;
    history.replaceState(null, '', '#order-' + id);
    $('od-title').textContent = 'ออเดอร์ #' + id;
    $('od-sub').textContent = '';
    body.replaceChildren(el('p', 'mp-muted', 'กำลังโหลดรายละเอียด…'));
    if (!dialog.open) dialog.showModal();
    try {
      const data = await api('/api/online-orders/' + encodeURIComponent(id));
      if (req !== detailReq) return;
      current = data;
      renderDetail();
    } catch (error) {
      if (req !== detailReq) return;
      const p = el('p', 'oo-error', 'โหลดรายละเอียดไม่สำเร็จ: ' + error.message);
      const retry = el('button', 'mp-btn mp-btn-sm', 'ลองใหม่');
      retry.type = 'button'; retry.addEventListener('click', () => openOrder(id));
      body.replaceChildren(p, retry);
    }
  }

  function section(title, ...children) {
    const s = el('section', 'od-card oo-sec');
    s.append(el('h3', 'od-h', title), ...children);
    return s;
  }
  function line(label, value, cls = '') { const d = el('div', 'od-line ' + cls); d.append(el('span', '', label), el('span', '', value)); return d; }

  function renderDetail() {
    const { order: o, notes } = current;
    const canUpdate = Boolean(current.canUpdate);
    $('od-title').textContent = 'ออเดอร์ #' + o.number;
    $('od-sub').replaceChildren(o.needsVerify ? verifyBadge() : badge(o.status), document.createTextNode(' สั่งซื้อ ' + thaiDateTime(o.dateCreated)));
    // ตรวจชำระ: show only the payment-check box (slip, confirm, not found, cancel).
    if (o.needsVerify) { body.replaceChildren(paymentCheck(o, canUpdate)); return; }
    const parts = [];

    if (o.customerNote) {
      const box = el('div', 'oo-customer-note');
      box.append(el('strong', '', '📝 ข้อความจากลูกค้า'), el('p', '', o.customerNote));
      parts.push(box);
    }

    // Items
    const list = el('ul', 'oo-items');
    for (const item of o.items) {
      const li = el('li', 'oo-item');
      if (item.image) { const img = el('img'); img.src = item.image; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; li.append(img); }
      else li.append(el('span', 'oo-noimg', '📦'));
      const info = el('div', 'oo-item-info');
      info.append(el('strong', '', item.name));
      const meta = el('small', '', [item.sku ? 'SKU ' + item.sku : 'ไม่มี SKU', ...item.options.map(op => `${op.name}: ${op.value}`)].join(' · '));
      info.append(meta);
      const qty = el('div', 'oo-item-qty');
      qty.append(el('span', '', `${count(item.quantity)} × ${money(item.price)}`), el('strong', '', money(item.total)));
      li.append(info, qty);
      list.append(li);
    }
    const totals = el('div', 'od-money oo-totals');
    totals.append(line('ค่าสินค้า', money(o.subtotal)));
    if (o.discountTotal) totals.append(line('ส่วนลด' + (o.coupons.length ? ` (${o.coupons.join(', ')})` : ''), '−' + money(o.discountTotal), 'od-neg'));
    for (const f of o.fees) totals.append(line(f.name, money(f.total)));
    totals.append(line('ค่าจัดส่ง', money(o.shippingTotal)));
    const net = line('ยอดรวม', money(o.total), 'od-net'); totals.append(net);
    parts.push(section(`สินค้า (${count(o.itemCount)} ชิ้น)`, list, totals));

    // Shipping
    const ship = el('div', 'oo-ship');
    ship.append(el('strong', '', o.shipping.name || '—'));
    for (const l of o.shipping.lines) ship.append(el('span', '', l));
    if (o.shipping.phone) { const a = el('a', 'oo-tel', '📞 ' + o.shipping.phone); a.href = telHref(o.shipping.phone); ship.append(a); }
    const method = el('p', 'od-note', 'วิธีจัดส่ง: ' + (o.shippingMethods.map(m => m.title).join(', ') || '—'));
    parts.push(section('ที่อยู่จัดส่ง', ship, method));

    // Payment
    const pay = el('div', 'od-money');
    pay.append(line('วิธีชำระ', o.paymentMethod || '—'));
    pay.append(line('ชำระเมื่อ', o.datePaid ? thaiDateTime(o.datePaid) : 'ยังไม่ชำระ', o.datePaid ? '' : 'od-dim'));
    if (o.transactionId) pay.append(line('เลขอ้างอิง', o.transactionId));
    if (o.billing.email) pay.append(line('อีเมล', o.billing.email));
    if (o.billing.phone && o.billing.phone !== o.shipping.phone) { const d = line('เบอร์ผู้สั่งซื้อ', ''); const a = el('a', 'oo-tel', o.billing.phone); a.href = telHref(o.billing.phone); d.lastChild.append(a); pay.append(d); }
    // ตรวจการชำระเงิน: shown first while the order waits for payment / slip check.
    if (o.needsVerify) parts.splice(o.customerNote ? 1 : 0, 0, paymentCheck(o, canUpdate));
    parts.push(section('การชำระเงิน', pay));

    // Actions
    const printRow = el('div', 'oo-actions');
    const pl = el('button', 'mp-btn mp-btn-sm', '🖨 ใบรายการสินค้า (A6)'); pl.type = 'button'; pl.addEventListener('click', () => printDoc('packing'));
    const lb = el('button', 'mp-btn mp-btn-sm', '🖨 ใบปะหน้า (A6)'); lb.type = 'button'; lb.addEventListener('click', () => printDoc('label'));
    const both = el('button', 'mp-btn mp-btn-sm', '🖨 พิมพ์ทั้งสองใบ'); both.type = 'button'; both.addEventListener('click', () => printDoc('both'));
    printRow.append(pl, lb, both);
    if (canUpdate) parts.push(section('อัปเดตออเดอร์', statusForm(o), trackingForm(o), noteForm(o), printRow));
    else parts.push(section('พิมพ์เอกสาร', printRow, el('p', 'od-note', 'คุณมีสิทธิ์ดูออเดอร์อย่างเดียว — การเปลี่ยนสถานะ/เพิ่มโน้ตต้องได้รับสิทธิ์ "ดู + อัปเดต" จาก Super Admin')));

    // Notes
    const notesList = el('ol', 'oo-notes');
    if (!notes.length) notesList.append(el('li', 'mp-muted', 'ยังไม่มีโน้ต'));
    for (const n of notes) {
      const li = el('li', 'oo-note');
      li.dataset.customer = String(n.customerNote);
      const head = el('div', 'oo-note-head');
      head.append(el('span', 'oo-note-type', n.customerNote ? 'แจ้งลูกค้า' : 'ภายใน'), el('small', '', `${thaiDateTime(n.date)}${n.author ? ' · ' + n.author : ''}`));
      li.append(head, el('p', '', n.note));
      notesList.append(li);
    }
    parts.push(section('โน้ตของออเดอร์', notesList));
    body.replaceChildren(...parts);
  }

  function paymentCheck(o, canUpdate) {
    const box = el('section', 'od-card oo-sec oo-paycheck');
    box.append(el('h3', 'od-h', '💳 ตรวจการชำระเงิน'));
    const amt = el('div', 'oo-pay-amount'); amt.append(el('small', '', 'ยอดที่ต้องได้รับ'), el('strong', '', money(o.total)));
    const meta = el('div', 'od-money');
    meta.append(line('วิธีชำระ', o.paymentMethod || '—'), line('สั่งซื้อเมื่อ', thaiDateTime(o.dateCreated)), line('ชื่อผู้สั่งซื้อ', o.billing.name || o.shipping.name || '—'));
    box.append(amt, meta);
    // ข้อมูลที่ลูกค้ากรอกตอนแจ้งโอน (Seed Confirm); falls back to the bank saved on the order.
    const given = (label, value) => line(label, value || 'ไม่ได้ระบุ', value ? '' : 'od-dim');
    const confs = o.confirmations || [];
    if (!confs.length) {
      const c = el('div', 'od-money oo-confirm');
      c.append(el('h4', 'oo-confirm-h', 'ข้อมูลที่ลูกค้าแจ้งโอน'), given('โอนจากธนาคาร', o.fromBank), given('ชื่อบัญชีผู้โอน', o.fromAccName), given('เลขบัญชีผู้โอน', o.fromAccNo));
      box.append(c);
    }
    for (const cf of confs) {
      const c = el('div', 'od-money oo-confirm');
      c.append(el('h4', 'oo-confirm-h', 'ข้อมูลที่ลูกค้าแจ้งโอน' + (cf.submittedAt ? ' · ' + thaiDateTime(cf.submittedAt) : '')));
      if (cf.amount != null) {
        const diff = Math.round((cf.amount - o.total) * 100) / 100;
        const amtLine = line('ยอดที่แจ้งโอน', money(cf.amount) + (diff === 0 ? ' ✓ ตรงกับยอดออเดอร์' : ` ⚠ ${diff > 0 ? 'เกิน' : 'ขาด'} ${money(Math.abs(diff))}`));
        amtLine.dataset.match = String(diff === 0);
        c.append(amtLine);
      } else c.append(given('ยอดที่แจ้งโอน', ''));
      c.append(given('โอนจากธนาคาร', o.fromBank || (/โอนจากธนาคาร:\s*([^)]*\)?)/.exec(cf.detail)?.[1] ?? '')));
      c.append(given('ชื่อบัญชีผู้โอน', o.fromAccName), given('เลขบัญชีผู้โอน', o.fromAccNo));
      c.append(given('วันเวลาที่โอน', cf.transferDate), given('ชื่อผู้แจ้ง', cf.name), given('เบอร์ติดต่อ', cf.contact));
      const toAcc = [cf.toBank, cf.toAccountName, cf.toAccountNo].filter(x => x && !/^x+$/i.test(x)).join(' · ');
      c.append(given('โอนเข้าบัญชีร้าน', toAcc));
      if (cf.remark) c.append(line('หมายเหตุจากลูกค้า', cf.remark));
      if (cf.detail) c.append(el('p', 'od-note', cf.detail));
      box.append(c);
    }
    if (o.customerNote) { const cn = el('div', 'oo-customer-note'); cn.append(el('strong', '', '📝 ข้อความจากลูกค้า'), el('p', '', o.customerNote)); box.append(cn); }
    const slips = el('div', 'oo-slips');
    if (o.slips?.length) for (const u of o.slips) { const a = el('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; const img = el('img'); img.src = u; img.alt = 'สลิปการโอน'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; a.append(img); a.addEventListener('click', e => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); openSlip(u); }); slips.append(a); }
    else slips.append(el('p', 'od-note', 'เว็บไซต์ไม่ได้เก็บรูปสลิปไว้ในออเดอร์ — ตรวจยอดเงินเข้าจากแอปธนาคาร หรือดูสลิปในอีเมล "Admin Checking Payment" / แชท LINE'));
    box.append(slips);
    if (!canUpdate) { box.append(el('p', 'od-note', 'ต้องมีสิทธิ์ "ดู + อัปเดต" จึงยืนยันการชำระเงินได้')); return box; }
    const form = el('form', 'oo-form');
    const at = el('input', 'mp-input'); at.maxLength = 40; at.placeholder = 'เช่น 20/11 14:32 น.';
    const l1 = el('label', '', 'เวลาโอนตามสลิป (ไม่บังคับ)'); l1.append(at);
    const note = el('input', 'mp-input'); note.maxLength = 500; note.placeholder = 'เช่น ธนาคาร/เลขอ้างอิง หรือเหตุผลที่ไม่พบยอด';
    const l2 = el('label', '', 'หมายเหตุ'); l2.append(note);
    const ok = el('button', 'mp-btn mp-btn-sm mp-btn-primary', '✓ ยืนยันรับเงิน → ย้ายไปรอจัดส่ง'); ok.type = 'button';
    const no = el('button', 'mp-btn mp-btn-sm', '✕ ไม่พบยอดเงิน'); no.type = 'button';
    const notifyWrap = el('label', 'oo-check'); const notify = el('input'); notify.type = 'checkbox'; notifyWrap.append(notify, document.createTextNode(' แจ้งลูกค้าว่ายังไม่พบยอด (ลูกค้าได้รับอีเมล)'));
    const msg = formStatus();
    form.append(l1, l2, ok, no, notifyWrap, msg);
    const send = async (action) => {
      if (action === 'reject' && !note.value.trim()) { msg.dataset.state = 'error'; msg.textContent = 'กรุณาระบุเหตุผลที่ไม่พบยอดเงินในช่องหมายเหตุ'; note.focus(); return; }
      const yes = await confirmChange(action === 'confirm'
        ? `ยืนยันว่าได้รับเงิน ${money(o.total)} ของออเดอร์ #${o.number} แล้ว?\n\nสถานะจะเปลี่ยนเป็น "รอจัดส่ง" และบันทึกว่าคุณเป็นผู้ตรวจ`
        : `บันทึกว่าไม่พบยอดเงินของออเดอร์ #${o.number}?\nสถานะยังคงเดิม${notify.checked ? '\nลูกค้าจะได้รับอีเมลแจ้ง' : ''}`);
      if (!yes) return;
      setBusy(form, true); msg.dataset.state = ''; msg.textContent = 'กำลังบันทึก…';
      try {
        await api(`/api/online-orders/${o.id}/payment`, { method: 'POST', body: { action, note: note.value.trim(), transferAt: at.value.trim(), notifyCustomer: notify.checked } });
        await refreshNotes(); renderDetail(); loadOrders({ quiet: true }); loadSummary();
      } catch (error) { msg.dataset.state = 'error'; msg.textContent = 'บันทึกไม่สำเร็จ: ' + error.message; setBusy(form, false); }
    };
    ok.addEventListener('click', () => send('confirm'));
    no.addEventListener('click', () => send('reject'));
    box.append(form, cancelForm(o));
    return box;
  }

  // ยกเลิกคำสั่งซื้อ from the ตรวจชำระ box: reason required, optional email to the customer.
  function cancelForm(o) {
    const form = el('form', 'oo-form oo-cancel');
    form.append(el('h4', 'oo-cancel-h', '🚫 ยกเลิกคำสั่งซื้อ'));
    const reason = el('textarea', 'mp-input'); reason.rows = 2; reason.maxLength = 500; reason.placeholder = 'เช่น ยอดโอนไม่ครบ / ลูกค้าขอยกเลิก / สินค้าหมด';
    const l1 = el('label', 'oo-wide', 'เหตุผลที่ยกเลิก (จำเป็น)'); l1.append(reason);
    const notifyWrap = el('label', 'oo-check'); const notify = el('input'); notify.type = 'checkbox'; notify.checked = true;
    notifyWrap.append(notify, document.createTextNode(' ส่งอีเมลแจ้งเหตุผลให้ลูกค้า' + (o.billing.email ? ` (${o.billing.email})` : '')));
    const btn = el('button', 'mp-btn mp-btn-sm oo-btn-danger', 'ยกเลิกคำสั่งซื้อ'); btn.type = 'submit';
    const msg = formStatus();
    form.append(l1, notifyWrap, btn, msg);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const why = reason.value.trim();
      if (!why) { msg.dataset.state = 'error'; msg.textContent = 'กรุณาระบุเหตุผลที่ยกเลิก'; reason.focus(); return; }
      const yes = await confirmChange(`ยกเลิกคำสั่งซื้อ #${o.number} (${money(o.total)})?\n\nเหตุผล: ${why}\n${notify.checked ? 'ลูกค้าจะได้รับอีเมลแจ้งเหตุผล' : 'ไม่ส่งอีเมลแจ้งลูกค้า'}\n\nสถานะจะเปลี่ยนเป็น "ยกเลิก"`);
      if (!yes) return;
      setBusy(form, true); msg.dataset.state = ''; msg.textContent = 'กำลังยกเลิก…';
      try {
        await api(`/api/online-orders/${o.id}/payment`, { method: 'POST', body: { action: 'cancel', note: why, notifyCustomer: notify.checked } });
        await refreshNotes(); renderDetail(); loadOrders({ quiet: true }); loadSummary();
      } catch (error) { msg.dataset.state = 'error'; msg.textContent = 'ยกเลิกไม่สำเร็จ: ' + error.message; setBusy(form, false); }
    });
    return form;
  }

  // Slip lightbox: a dialog on top of the order dialog; click anywhere / Esc / ✕ closes it.
  let slipBox = null;
  function openSlip(url) {
    if (!slipBox) {
      slipBox = el('dialog', 'oo-lightbox');
      slipBox.setAttribute('aria-label', 'สลิปการโอน');
      const close = el('button', 'oo-lightbox-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'ปิด');
      const img = el('img'); img.alt = 'สลิปการโอน'; img.referrerPolicy = 'no-referrer';
      const open = el('a', 'oo-lightbox-open', 'เปิดในแท็บใหม่ ↗'); open.target = '_blank'; open.rel = 'noopener noreferrer';
      slipBox.append(close, img, open);
      slipBox.addEventListener('click', e => { if (e.target !== open) slipBox.close(); });
      document.body.append(slipBox);
    }
    slipBox.querySelector('img').src = url;
    slipBox.querySelector('a').href = url;
    slipBox.showModal();
  }

  const formStatus = () => el('p', 'oo-form-status', '');
  function setBusy(form, busy) { form.querySelectorAll('button,input,select,textarea').forEach(x => { x.disabled = busy; }); }

  function statusForm(o) {
    const form = el('form', 'oo-form');
    const label = el('label', '', 'เปลี่ยนสถานะ');
    const select = el('select', 'mp-input');
    for (const s of ['pending', 'on-hold', 'processing', 'completed', 'cancelled', 'refunded', 'failed']) {
      const op = el('option', '', STATUS[s][0]); op.value = s; if (s === o.status) op.selected = true; select.append(op);
    }
    label.append(select);
    const btn = el('button', 'mp-btn mp-btn-sm mp-btn-primary', 'บันทึกสถานะ'); btn.type = 'submit';
    const msg = formStatus();
    form.append(label, btn, msg);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (select.value === o.status) { msg.dataset.state = 'error'; msg.textContent = 'สถานะเหมือนเดิม ไม่ต้องบันทึก'; return; }
      const ok = await confirmChange(`เปลี่ยนสถานะออเดอร์ #${o.number}\nจาก "${STATUS[o.status]?.[0] || o.status}" เป็น "${STATUS[select.value][0]}"?` + (['completed', 'cancelled', 'refunded'].includes(select.value) ? '\n\nเว็บไซต์อาจส่งอีเมลแจ้งลูกค้าอัตโนมัติ' : ''));
      if (!ok) { select.value = o.status; return; }
      setBusy(form, true); msg.dataset.state = ''; msg.textContent = 'กำลังบันทึก…';
      try {
        const r = await api(`/api/online-orders/${o.id}/status`, { method: 'PUT', body: { status: select.value } });
        current.order = r.order;
        await refreshNotes();
        renderDetail();
        loadOrders({ quiet: true }); loadSummary();
      } catch (error) { msg.dataset.state = 'error'; msg.textContent = 'บันทึกไม่สำเร็จ: ' + error.message; setBusy(form, false); }
    });
    return form;
  }

  function trackingForm(o) {
    const form = el('form', 'oo-form');
    const carrier = el('select', 'mp-input'); carrier.required = true;
    const blank = el('option', '', 'เลือกขนส่ง'); blank.value = ''; carrier.append(blank);
    for (const c of CARRIERS) { const op = el('option', '', c); op.value = c; carrier.append(op); }
    const l1 = el('label', '', 'ขนส่ง'); l1.append(carrier);
    const tracking = el('input', 'mp-input'); tracking.required = true; tracking.maxLength = 60; tracking.placeholder = 'เช่น TH0123456789'; tracking.autocomplete = 'off'; tracking.pattern = '[A-Za-z0-9\\- ]+';
    const l2 = el('label', '', 'เลขพัสดุ'); l2.append(tracking);
    const btn = el('button', 'mp-btn mp-btn-sm mp-btn-primary', 'ส่งเลขพัสดุให้ลูกค้า'); btn.type = 'submit';
    const hint = el('small', 'oo-hint', 'บันทึกเป็นโน้ตแจ้งลูกค้า (ลูกค้าได้รับอีเมลจากเว็บไซต์)');
    const msg = formStatus();
    form.append(l1, l2, btn, hint, msg);
    form.addEventListener('submit', e => submitNote(e, form, msg, { kind: 'tracking', carrier: carrier.value, tracking: tracking.value.trim() }, o));
    return form;
  }

  function noteForm(o) {
    const form = el('form', 'oo-form');
    const kind = el('select', 'mp-input');
    for (const [v, t] of [['internal', 'โน้ตภายในทีม'], ['serial', 'Serial number']]) { const op = el('option', '', t); op.value = v; kind.append(op); }
    const l1 = el('label', '', 'ประเภท'); l1.append(kind);
    const text = el('textarea', 'mp-input'); text.required = true; text.maxLength = 1000; text.rows = 2; text.placeholder = 'ลูกค้าไม่เห็นโน้ตนี้';
    const l2 = el('label', 'oo-wide', 'ข้อความ'); l2.append(text);
    kind.addEventListener('change', () => { text.placeholder = kind.value === 'serial' ? 'เช่น SN: A1B2C3, A1B2C4' : 'ลูกค้าไม่เห็นโน้ตนี้'; });
    const btn = el('button', 'mp-btn mp-btn-sm', 'บันทึกโน้ต'); btn.type = 'submit';
    const msg = formStatus();
    form.append(l1, l2, btn, msg);
    form.addEventListener('submit', e => submitNote(e, form, msg, { kind: kind.value, text: text.value.trim() }, o));
    return form;
  }

  async function submitNote(e, form, msg, payload, o) {
    e.preventDefault();
    setBusy(form, true); msg.dataset.state = ''; msg.textContent = 'กำลังบันทึก…';
    try {
      await api(`/api/online-orders/${o.id}/notes`, { method: 'POST', body: payload });
      await refreshNotes();
      renderDetail();
    } catch (error) { msg.dataset.state = 'error'; msg.textContent = 'บันทึกไม่สำเร็จ: ' + error.message; setBusy(form, false); }
  }
  async function refreshNotes() {
    try { const d = await api('/api/online-orders/' + current.order.id); current = d; } catch { /* the saved change still stands; notes refresh on reopen */ }
  }

  const confirmDialog = $('confirm-dialog');
  function confirmChange(text) {
    $('confirm-text').textContent = text;
    confirmDialog.returnValue = '';
    confirmDialog.showModal();
    $('confirm-ok').focus();
    return new Promise(resolve => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true }));
  }

  // ---------- print (A6 packing list / shipping label)
  let storeInfo = null;
  async function printDoc(kind) {
    const o = current?.order;
    if (!o) return;
    const win = window.open('', '_blank', 'width=520,height=760');
    if (!win) { alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up สำหรับเว็บนี้'); return; }
    win.document.write('<p style="font-family:sans-serif">กำลังเตรียมเอกสาร…</p>');
    if (!storeInfo) storeInfo = await api('/api/online-orders/store').catch(() => ({ name: 'PROPLUS AUDIO', lines: [], phone: '' }));
    const packing = `
      <section class="page">
        <header><div><b>${esc(storeInfo.name)}</b><small>ใบรายการสินค้า</small></div><div class="r"><b>#${esc(o.number)}</b><small>${esc(thaiDateTime(o.dateCreated))}</small></div></header>
        <p class="to"><b>${esc(o.shipping.name)}</b> ${esc(o.shipping.phone)}</p>
        <table><thead><tr><th>สินค้า</th><th class="n">จำนวน</th></tr></thead><tbody>
        ${o.items.map(i => `<tr><td>${esc(i.name)}<small>${esc([i.sku && 'SKU ' + i.sku, ...i.options.map(op => op.name + ': ' + op.value)].filter(Boolean).join(' · '))}</small></td><td class="n">${esc(count(i.quantity))}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>รวม</td><td class="n">${esc(count(o.itemCount))} ชิ้น</td></tr></tfoot></table>
        ${o.customerNote ? `<p class="note"><b>ข้อความจากลูกค้า:</b> ${esc(o.customerNote)}</p>` : ''}
        <p class="foot">ยอดรวม ${esc(money(o.total))} · ${esc(o.paymentMethod)}</p>
        <p class="check">☐ หยิบสินค้าครบ &nbsp; ☐ ตรวจสภาพ &nbsp; ☐ แพ็คแล้ว</p>
      </section>`;
    const label = `
      <section class="page label">
        <div class="box from"><small>ผู้ส่ง</small><b>${esc(storeInfo.name)}</b>${storeInfo.lines.map(l => `<span>${esc(l)}</span>`).join('')}${storeInfo.phone ? `<span>โทร ${esc(storeInfo.phone)}</span>` : ''}</div>
        <div class="box toaddr"><small>ผู้รับ</small><b class="big">${esc(o.shipping.name)}</b>${o.shipping.lines.map(l => `<span>${esc(l)}</span>`).join('')}<b class="tel">โทร ${esc(o.shipping.phone || '-')}</b></div>
        <div class="meta"><span>ออเดอร์ <b>#${esc(o.number)}</b></span><span>${esc(o.shippingMethods.map(m => m.title).join(', ') || '')}</span><span>${esc(count(o.itemCount))} ชิ้น</span></div>
        ${/ปลายทาง|cod/i.test(o.paymentMethod) ? `<div class="cod">เก็บเงินปลายทาง ${esc(money(o.total))}</div>` : ''}
      </section>`;
    const pages = kind === 'packing' ? packing : kind === 'label' ? label : packing + label;
    win.document.open();
    win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ออเดอร์ #${esc(o.number)}</title>
      <style>
        @page { size: A6 portrait; margin: 5mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: "IBM Plex Sans Thai", "Leelawadee UI", Tahoma, sans-serif; font-size: 10.5pt; color: #000; background: #fff; }
        .page { width: 95mm; min-height: 136mm; padding: 1mm; page-break-after: always; break-after: page; }
        .page:last-child { page-break-after: auto; break-after: auto; }
        header { display: flex; justify-content: space-between; gap: 4mm; border-bottom: 1.5px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
        header b { display: block; font-size: 12pt; } header small, td small { display: block; font-size: 8.5pt; color: #333; } .r { text-align: right; }
        .to { margin: 0 0 2mm; } table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #999; padding: 1.4mm 1mm; text-align: left; vertical-align: top; } th { font-size: 9pt; } .n { text-align: right; white-space: nowrap; width: 14mm; }
        tfoot td { font-weight: 700; border-bottom: 0; } .note { border: 1.5px solid #000; padding: 2mm; margin: 2mm 0; } .foot { margin: 2mm 0 0; font-size: 9pt; } .check { margin: 3mm 0 0; font-size: 9pt; }
        .label { display: flex; flex-direction: column; gap: 2.5mm; }
        .box { border: 1.5px solid #000; border-radius: 2mm; padding: 2.5mm; display: flex; flex-direction: column; gap: .6mm; }
        .box small { font-size: 8.5pt; font-weight: 700; } .from { font-size: 9pt; } .toaddr { font-size: 12.5pt; flex: 1; } .big { font-size: 15pt; } .tel { margin-top: 1.5mm; font-size: 13pt; }
        .meta { display: flex; justify-content: space-between; gap: 2mm; font-size: 9pt; border-top: 1px dashed #000; padding-top: 2mm; flex-wrap: wrap; }
        .cod { border: 2px solid #000; padding: 2mm; text-align: center; font-size: 13pt; font-weight: 700; }
        @media screen { body { background: #eee; } .page { background: #fff; margin: 8px auto; box-shadow: 0 1px 6px #0003; } }
      </style></head><body>${pages}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch {} }, 300);
  }

  // ---------- sales (WooCommerce reports)
  const salesPresets = [...document.querySelectorAll('#sales-filters [data-preset]')];
  let chart = null, lastSales = null, salesReq = 0;
  function presetRange(name) {
    const t = new Date();
    switch (name) {
      case '7d': return [iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6)), iso(t)];
      case 'month': return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
      case 'prev-month': return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
      case 'year': return [iso(new Date(t.getFullYear(), 0, 1)), iso(t)];
      default: return [iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 29)), iso(t)];
    }
  }
  function applyPreset(name) {
    salesPresets.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
    [$('sales-start').value, $('sales-end').value] = presetRange(name);
  }
  salesPresets.forEach(b => b.addEventListener('click', () => { applyPreset(b.dataset.preset); loadSales(); }));
  for (const id of ['sales-start', 'sales-end']) $(id).addEventListener('input', () => salesPresets.forEach(b => b.setAttribute('aria-pressed', 'false')));
  $('sales-filters').addEventListener('submit', e => { e.preventDefault(); loadSales(); });
  applyPreset('30d');

  async function loadSales() {
    const id = ++salesReq, start = $('sales-start').value, end = $('sales-end').value, status = $('sales-status');
    if (!start || !end || start > end) { status.textContent = 'กรุณาเลือกช่วงวันที่ให้ถูกต้อง'; status.className = 'ov-status error'; return; }
    state.salesLoaded = true;
    status.textContent = 'กำลังโหลดยอดขาย…'; status.className = 'ov-status';
    document.querySelector('.oo-sales-kpis').classList.add('is-loading');
    $('display-period').textContent = `${thaiDate(start)} – ${thaiDate(end)}`;
    try {
      const data = await api(`/api/online-orders/sales?start=${start}&end=${end}`);
      if (id !== salesReq) return;
      lastSales = data;
      $('kpi-sales').textContent = money(data.totalSales);
      $('kpi-sales-foot').textContent = data.totalRefunds ? `คืนเงิน ${money(data.totalRefunds)}` : 'จากรายงานยอดขาย WooCommerce';
      $('kpi-orders').textContent = count(data.orders);
      $('kpi-orders-foot').textContent = `${count(data.totalItems)} ชิ้น`;
      $('kpi-aov').textContent = data.orders ? money(data.averagePerOrder) : '—';
      renderDaily(data);
      renderTop(data);
      status.textContent = '';
    } catch (error) {
      if (id !== salesReq) return;
      for (const k of ['kpi-sales', 'kpi-orders', 'kpi-aov']) $(k).textContent = '—';
      status.textContent = 'โหลดยอดขายไม่สำเร็จ: ' + error.message; status.className = 'ov-status error';
      $('top-list').replaceChildren(el('li', 'mp-empty', 'ไม่มีข้อมูล'));
      $('daily-empty').hidden = false; $('daily-empty').textContent = 'ไม่มีข้อมูล'; document.querySelector('#sales-panels .mp-chart').hidden = true;
      chart?.destroy(); chart = null;
    } finally {
      if (id === salesReq) document.querySelector('.oo-sales-kpis').classList.remove('is-loading');
    }
  }

  function renderDaily(data) {
    const byDate = new Map(data.daily.map(d => [d.date, d]));
    const dates = [];
    for (let d = new Date(data.start + 'T00:00:00'); iso(d) <= data.end; d.setDate(d.getDate() + 1)) dates.push(iso(d));
    const values = dates.map(d => byDate.get(d)?.sales || 0), orders = dates.map(d => byDate.get(d)?.orders || 0);
    const hasData = values.some(Boolean);
    $('daily-source').textContent = data.dailySource === 'wc-analytics' ? 'WooCommerce Analytics' : 'รายงานยอดขาย WooCommerce';
    $('daily-empty').hidden = hasData; $('daily-empty').textContent = 'ไม่มียอดขายในช่วงวันที่นี้';
    const chartBox = document.querySelector('#sales-panels .mp-chart');
    chartBox.hidden = !hasData;
    const head = el('tr'); head.append(el('th', '', 'วันที่'), el('th', 'num', 'ยอดขาย'), el('th', 'num', 'ออเดอร์'));
    const thead = el('thead'); thead.append(head);
    const tbody = el('tbody');
    dates.forEach((d, i) => { if (!values[i] && !orders[i]) return; const tr = el('tr'); tr.append(el('td', '', thaiDate(d)), el('td', 'num', money(values[i])), el('td', 'num', count(orders[i]))); tbody.append(tr); });
    $('daily-table').replaceChildren(thead, tbody);
    if (!hasData || !window.Chart) { chart?.destroy(); chart = null; return; }
    const style = getComputedStyle(document.documentElement), v = n => style.getPropertyValue(n).trim();
    const colors = { bar: v('--brand') || '#d80600', ink: v('--muted') || '#888', line: v('--line') || '#ddd' };
    chart?.destroy();
    chart = new window.Chart($('daily-chart'), {
      type: 'bar',
      data: {
        labels: dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })),
        datasets: [{ label: 'ยอดขาย', data: values, backgroundColor: colors.bar, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 28 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `ยอดขาย: ${money(ctx.parsed.y)}`, footer: items => `${count(orders[items[0].dataIndex])} ออเดอร์` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: colors.ink, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: colors.line }, border: { display: false }, ticks: { color: colors.ink, callback: val => money(val, 0) } },
        },
      },
    });
  }

  function renderTop(data) {
    const list = $('top-list');
    if (!data.topSellers.length) { list.replaceChildren(el('li', 'mp-empty', 'ไม่มีสินค้าที่ขายได้ในช่วงนี้')); return; }
    const max = data.topSellers[0].quantity || 1;
    list.replaceChildren(...data.topSellers.map((item, i) => {
      const li = el('li', 'mp-rank-item');
      li.append(el('span', 'mp-rank-no', String(i + 1)));
      const b = el('div', 'mp-rank-body');
      const title = el('strong', '', item.name); title.title = item.name;
      const meta = el('small', 'mp-rank-meta');
      if (item.sku) meta.append(el('span', '', item.sku));
      if (item.price) meta.append(el('span', '', money(item.price)));
      const bar = el('span', 'mp-bar'); bar.style.setProperty('--w', (item.quantity / max * 100).toFixed(1) + '%');
      b.append(title, meta, bar);
      const value = el('div', 'mp-rank-value');
      value.append(el('strong', '', count(item.quantity) + ' ชิ้น'));
      li.append(b, value);
      return li;
    }));
  }
  window.addEventListener('dashboard-theme-change', () => { if (lastSales && state.view === 'sales') renderDaily(lastSales); });

  // ---------- boot + auto refresh every 2 minutes
  $('refresh').addEventListener('click', () => { if (state.view === 'sales') loadSales(); else { loadSummary(); loadOrders(); } });
  setInterval(() => { if (!document.hidden && state.view === 'orders') { loadSummary(); loadOrders({ quiet: true }); } }, 120000);

  api('/api/online-orders/me').then(me => {
    state.me = me;
    $('perm-link').hidden = !me.canManagePermissions;
    if (!me.configured) { const a = $('config-alert'); a.hidden = false; a.textContent = 'ยังไม่ได้ตั้งค่าการเชื่อมต่อเว็บไซต์ (WC_KEY / WC_SECRET ใน .env ของ server) — ข้อมูลจะแสดงไม่ได้จนกว่าผู้ดูแลระบบจะตั้งค่า'; }
  }).catch(error => { const a = $('config-alert'); a.hidden = false; a.textContent = error.message; });

  const hash = location.hash;
  statusButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === state.status)));
  renderFilterChip();
  selectView(hash === '#sales' ? 'sales' : 'orders', false);
  loadSummary();
  loadOrders();
  const m = /^#order-(\d+)$/.exec(hash);
  if (m) openOrder(Number(m[1]));
})();
