// Per-order fees table on marketplace.html (GET /api/marketplace/order-fees): sales, fees, % deducted, net and, on click,
// the whole order in a popup. Follows the page's view through the 'marketplace:view' event fired by marketplace-ui.js.
(() => {
  const $ = id => document.getElementById(id);
  const summary = $('fees-summary'), wrap = $('fees-wrap'), body = $('fees-body'), pager = $('fees-pager');
  const NAMES = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };
  // Known fee types (Shopee API / income report, TikTok Finance API); Lazada fee names arrive already readable.
  const LABELS = {
    commission_fee: 'ค่าคอมมิชชั่น', service_fee: 'ค่าบริการ', seller_transaction_fee: 'ค่าธุรกรรมการชำระเงิน',
    order_ams_commission_fee: 'ค่าคอมมิชชั่น AMS (Affiliate)', platform_infrastructure_fee: 'ค่าโครงสร้างพื้นฐานแพลตฟอร์ม',
    shipping_saver_fee: 'ค่าโปรแกรมประหยัดค่าจัดส่ง', platform_commission_amount: 'ค่าคอมมิชชั่นแพลตฟอร์ม',
    transaction_fee_amount: 'ค่าธุรกรรม', affiliate_commission_amount: 'ค่าคอมมิชชั่น Affiliate', referral_fee_amount: 'ค่าธรรมเนียมการแนะนำ',
    sfp_service_fee_amount: 'ค่าบริการ SFP', voucher_xtra_service_fee_amount: 'ค่าบริการ Voucher Xtra', flash_sales_service_fee_amount: 'ค่าบริการ Flash Sale',
    live_specials_fee_amount: 'ค่าบริการ LIVE Specials', affiliate_ads_commission_amount: 'ค่าคอมมิชชั่นโฆษณา Affiliate',
    affiliate_partner_commission_amount: 'ค่าคอมมิชชั่น Affiliate Partner', bonus_cashback_service_fee_amount: 'ค่าบริการ Bonus Cashback',
    refund_administration_fee_amount: 'ค่าดำเนินการคืนเงิน', fbt_fulfillment_fee_amount: 'ค่าบริการคลัง FBT', signature_confirmation_fee_amount: 'ค่ายืนยันลายเซ็น',
    shipping_insurance_fee_amount: 'ค่าประกันการขนส่ง', other_fee_amount: 'ค่าธรรมเนียมอื่น (TikTok ไม่ได้แยกชื่อมาให้)',
  };
  const label = key => LABELS[key] || key.replace(/_amount$|_fee$/, '').replace(/_/g, ' ');
  const money = v => (v === null || v === undefined ? '—' : '฿' + Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + '%');
  const day = s => new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  let view = null, page = 0, request = 0;

  // ---- Order popup -------------------------------------------------------------------------------------------------
  const STATUS = { completed: 'สำเร็จ', pending: 'กำลังดำเนินการ', cancelled: 'ยกเลิก', returned: 'คืนสินค้า' };
  const LOGOS = { shopee: 'Sp', lazada: 'Lz', tiktok: 'TT' };
  const dialog = $('order-dialog'), dialogBody = $('order-dialog-body');
  const svg = (tag, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const heading = text => el('h3', 'od-h', text);
  const share = (v, sales) => (sales > 0 ? pct(Math.round(v / sales * 10000) / 100) : '');

  function donut(percent) {
    const box = el('div', 'od-donut'), r = 42, c = 2 * Math.PI * r, ring = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    ring.append(svg('circle', { cx: 50, cy: 50, r, class: percent === null ? 'od-ring-empty' : 'od-ring-net' }));
    if (percent !== null) ring.append(svg('circle', { cx: 50, cy: 50, r, class: 'od-ring-fee', 'stroke-dasharray': `${c * Math.min(percent, 100) / 100} ${c}`, transform: 'rotate(-90 50 50)' }));
    const text = el('div', 'od-donut-label');
    text.append(el('small', '', 'โดนหัก'), el('strong', '', percent === null ? '—' : pct(percent)));
    box.append(ring, text);
    return box;
  }

  function summaryCard(o) {
    const card = el('section', 'od-card od-summary'), rows = el('div', 'od-money');
    const line = (k, v, cls = '') => { const row = el('div', 'od-line ' + cls); row.append(el('span', '', k), el('span', '', v)); return row; };
    rows.append(line('ราคาขาย', money(o.sales)), line('ค่าธรรมเนียมรวม', o.fees === null ? '—' : '− ' + money(o.fees), 'od-neg'));
    if (o.refund > 0) rows.append(line('คืนเงินให้ผู้ซื้อ', money(o.refund), 'od-dim'));
    rows.append(line('เงินที่ได้รับสุทธิ', money(o.net), 'od-net'));
    if (o.percent !== null) {
      const bar = el('div', 'od-bar'), net = el('span', 'od-bar-net'), fee = el('span', 'od-bar-fee');
      const netShare = Math.max(0, Math.min(100, 100 - o.percent));
      net.style.width = netShare + '%';
      fee.style.width = 100 - netShare + '%';
      bar.append(net, fee);
      const legend = el('div', 'od-legend');
      legend.append(el('span', 'od-key-net', 'สุทธิ ' + pct(Math.round(netShare * 100) / 100)), el('span', 'od-key-fee', 'ค่าธรรมเนียม ' + pct(o.percent)));
      rows.append(bar, legend);
    }
    card.append(donut(o.percent), rows);
    return card;
  }

  function feeSection(o) {
    const box = el('section', 'od-section');
    box.append(heading('ค่าธรรมเนียมแยกประเภท'));
    if (!o.detail) {
      box.append(el('div', 'od-alert', o.fees === null ? 'แพลตฟอร์มยังไม่ชำระเงินออเดอร์นี้ จึงยังไม่มีข้อมูลค่าธรรมเนียม'
        : 'ยังไม่มีรายละเอียดแยกประเภท มีแค่ยอดรวม (ระบบกำลังดึงรายละเอียดของออเดอร์เก่าใหม่)'));
      return box;
    }
    const entries = Object.entries(o.detail).sort((a, b) => b[1] - a[1]), max = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);
    const list = el('div', 'od-card od-fees');
    for (const [k, v] of entries) {
      const row = el('div', 'od-fee'), top = el('div', 'od-fee-top'), bar = el('div', 'od-fee-bar'), fill = el('span');
      top.append(el('span', '', label(k)), el('span', 'od-fee-amt', [money(v), share(v, o.sales)].filter(Boolean).join(' · ')));
      fill.style.width = Math.max(2, Math.abs(v) / max * 100) + '%';
      bar.append(fill);
      row.append(top, bar);
      list.append(row);
    }
    box.append(list);
    return box;
  }

  function itemsSection(o) {
    const box = el('section', 'od-section');
    box.append(heading('สินค้าในออเดอร์'));
    if (!o.items.length) { box.append(el('p', 'od-note', 'ไฟล์/ข้อมูลที่ได้มาไม่มีรายการสินค้าของออเดอร์นี้')); return box; }
    // Cancelled / returned lines are listed but not part of ราคาขาย (same rule as the sales total).
    const out = i => i.status === 'cancelled' || i.status === 'returned';
    for (const i of o.items) {
      const card = el('div', 'od-card od-item' + (out(i) ? ' is-out' : '')), main = el('div', 'od-item-main'), side = el('div', 'od-item-side');
      const name = el('div', 'od-item-name');
      name.append(el('span', 'od-item-text', i.name), el('span', 'od-chip', STATUS[i.status] || i.status || '—'));
      name.lastChild.dataset.status = i.status || 'pending';
      main.append(name, el('div', 'od-sku', i.sku || '—'));
      side.append(el('strong', '', money(i.sales)), el('small', '', '× ' + Number(i.quantity).toLocaleString('th-TH')));
      card.append(main, side);
      box.append(card);
    }
    const gone = o.items.filter(out);
    if (gone.length) box.append(el('p', 'od-note', `รายการที่ยกเลิก/คืนสินค้า (${money(gone.reduce((sum, i) => sum + i.sales, 0))}) ไม่นับในราคาขาย`));
    return box;
  }

  function infoSection(o) {
    const box = el('section', 'od-section'), grid = el('div', 'od-info');
    box.append(heading('ข้อมูลอื่น'));
    for (const [k, v] of [['สถานะจากแพลตฟอร์ม', o.statusRaw || '—'], ['จังหวัดปลายทาง', o.province || '—'],
      ['ที่มาของออเดอร์', o.source === 'api' ? 'ดึงผ่าน API' : 'ไฟล์ที่อัปโหลด'],
      ['อัปเดตข้อมูลการเงินล่าสุด', o.settledAt ? new Date(o.settledAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—']]) {
      const cell = el('div', 'od-card od-info-cell');
      cell.append(el('small', '', k), el('strong', '', v));
      grid.append(cell);
    }
    box.append(grid);
    return box;
  }

  function setHeader(o) {
    $('order-dialog-title').textContent = 'ออเดอร์ ' + o.orderId;
    const logo = $('od-logo');
    logo.textContent = LOGOS[o.platform] || '';
    logo.dataset.platform = o.platform;
    $('od-sub').textContent = [NAMES[o.platform], o.shop, o.orderDate && day(o.orderDate)].filter(Boolean).join(' · ');
    $('od-copy').onclick = () => navigator.clipboard?.writeText(o.orderId).then(() => {
      $('od-copy').textContent = '✓';
      setTimeout(() => { $('od-copy').textContent = '⧉'; }, 1200);
    }).catch(() => {});
  }

  async function openOrder(o) {
    setHeader(o);
    dialogBody.replaceChildren(el('p', 'od-note', 'กำลังโหลด…'));
    if (!dialog.open) dialog.showModal();
    try {
      const response = await fetch('/api/marketplace/order-detail?' + new URLSearchParams({ platform: o.platform, id: o.orderId }), { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดรายละเอียดออเดอร์ไม่สำเร็จ');
      setHeader(data);
      dialogBody.replaceChildren(summaryCard(data), feeSection(data), itemsSection(data), infoSection(data));
    } catch (error) {
      dialogBody.replaceChildren(el('div', 'od-alert', error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message));
    }
  }
  dialog.querySelectorAll('.od-close').forEach(b => b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); // click on the backdrop

  // ---- Table -------------------------------------------------------------------------------------------------------
  async function load() {
    if (!view) return;
    const id = ++request;
    summary.dataset.state = 'loading';
    summary.textContent = 'กำลังโหลด…';
    try {
      const q = new URLSearchParams({ ...view, ...filters(), page });
      const response = await fetch('/api/marketplace/order-fees?' + q, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (id !== request) return;
      if (!response.ok) throw new Error(data.error || 'โหลดค่าธรรมเนียมไม่สำเร็จ');
      const t = data.totals;
      body.replaceChildren(...data.orders.map(o => {
        const tr = el('tr', 'mp-fees-row');
        tr.tabIndex = 0;
        tr.title = 'กดเพื่อดูรายละเอียดออเดอร์';
        tr.append(el('td', '', day(o.orderDate)), el('td', '', o.orderId), el('td', '', NAMES[o.platform] || o.platform),
          el('td', 'num', money(o.sales)), el('td', 'num', money(o.fees)), el('td', 'num mp-fees-pct', pct(o.percent)), el('td', 'num', money(o.net)));
        tr.addEventListener('click', () => openOrder(o));
        tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrder(o); } });
        return tr;
      }));
      wrap.hidden = !data.orders.length;
      summary.dataset.state = t.orders ? 'ready' : 'empty';
      summary.textContent = !t.orders ? (filtered() ? 'ไม่พบออเดอร์ที่ตรงกับตัวกรอง' : 'ไม่มีออเดอร์ในช่วงนี้')
        : t.withFees ? `เฉลี่ยโดนหัก ${pct(t.percent)} ของราคาขาย · ค่าธรรมเนียมรวม ${money(t.fees)} จากราคาขาย ${money(t.sales)} · มีข้อมูลค่าธรรมเนียม ${t.withFees.toLocaleString('th-TH')} จาก ${t.orders.toLocaleString('th-TH')} ออเดอร์`
        : `ยังไม่มีข้อมูลค่าธรรมเนียมของ ${t.orders.toLocaleString('th-TH')} ออเดอร์ในช่วงนี้`;
      const pages = Math.ceil(t.orders / data.size);
      pager.hidden = pages <= 1;
      $('fees-page').textContent = `หน้า ${page + 1} / ${pages}`;
      $('fees-prev').disabled = page === 0;
      $('fees-next').disabled = page + 1 >= pages;
    } catch (error) {
      if (id !== request) return;
      wrap.hidden = true;
      pager.hidden = true;
      summary.dataset.state = 'error';
      summary.textContent = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message;
    }
  }

  document.addEventListener('marketplace:view', e => {
    if (e.detail.start > e.detail.end) { view = null; summary.textContent = 'ไม่มีข้อมูลในช่วงนี้'; wrap.hidden = pager.hidden = true; return; }
    view = e.detail; page = 0; load();
  });
  // Filters apply to this table only; the search waits for typing to pause.
  const filters = () => ({ q: $('fees-q').value.trim(), status: $('fees-status').value, fees: $('fees-has').value, sort: $('fees-sort').value });
  const filtered = () => { const f = filters(); return !!(f.q || f.status !== 'all' || f.fees !== 'all'); };
  const refilter = () => { $('fees-clear').hidden = !filtered(); page = 0; load(); };
  let typing = null;
  $('fees-q').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(refilter, 350); });
  for (const id of ['fees-status', 'fees-has', 'fees-sort']) $(id).addEventListener('change', refilter);
  $('fees-filters').addEventListener('submit', e => { e.preventDefault(); clearTimeout(typing); refilter(); });
  $('fees-clear').addEventListener('click', () => {
    $('fees-q').value = ''; $('fees-status').value = 'all'; $('fees-has').value = 'all';
    refilter();
  });
  $('fees-prev').addEventListener('click', () => { if (page > 0) { page--; load(); } });
  $('fees-next').addEventListener('click', () => { page++; load(); });
})();
