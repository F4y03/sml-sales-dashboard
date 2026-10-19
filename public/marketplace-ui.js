(() => {
  const PLATFORMS = ['shopee', 'lazada', 'tiktok'];
  const NAMES = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop', all: 'รวมทุกช่องทาง' };
  const STATUS = [
    ['completed', 'สำเร็จ', '✓'],
    ['pending', 'กำลังดำเนินการ', '…'],
    ['cancelled', 'ยกเลิก', '✕'],
    ['returned', 'คืนสินค้า', '↩'],
  ];
  const $ = id => document.getElementById(id);
  const form = $('filters'), startInput = $('start'), endInput = $('end'), status = $('status'), shopFilter = $('shop-filter');
  const tabs = [...document.querySelectorAll('.mp-tabs [role=tab]')];
  const presets = [...document.querySelectorAll('.ov-presets [data-preset]')];
  let platform = PLATFORMS.includes(location.hash.slice(1)) || location.hash === '#all' ? location.hash.slice(1) : 'all';
  let preset = 'latest', bounds = null, lastData = null, chart = null, request = 0;

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const money = (n, digits = 2) => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const count = n => Number(n || 0).toLocaleString('th-TH');
  const thaiDate = s => parseIso(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };

  function presetRange(name) {
    const today = new Date();
    const anchor = name === 'latest' && bounds?.last ? parseIso(bounds.last) : today;
    switch (name) {
      case '7d': return [iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), iso(today)];
      case '30d': return [iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)), iso(today)];
      case 'prev-month': return [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))];
      case 'year': return [iso(new Date(today.getFullYear(), 0, 1)), iso(today)];
      case 'month': return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)];
      // Latest month with data, ending today at the latest (no future days in the date box).
      default: return [iso(new Date(anchor.getFullYear(), anchor.getMonth(), 1)), iso(new Date(Math.min(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0), today)))];
    }
  }
  function applyPreset(name) {
    preset = name;
    presets.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
    [startInput.value, endInput.value] = presetRange(name);
  }
  function selectTab(name) {
    platform = name;
    tabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.platform === name)));
    $('mp-content').setAttribute('aria-labelledby', 'tab-' + name);
    history.replaceState(null, '', '#' + name);
    document.body.dataset.tab = name; // the TikTok sync widget shows on the TikTok tab only
  }

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.className = 'ov-status' + (kind ? ' ' + kind : '');
  }

  async function load() {
    const id = ++request;
    if (!startInput.value || !endInput.value || startInput.value > endInput.value) {
      setStatus('กรุณาเลือกช่วงวันที่ให้ถูกต้อง', 'error');
      return;
    }
    document.querySelector('.mp-kpis').classList.add('is-loading');
    setStatus('กำลังโหลดข้อมูล…');
    try {
      const query = new URLSearchParams({ platform, shop: shopFilter.value || 'all', start: startInput.value, end: endInput.value });
      const response = await fetch('/api/marketplace/summary?' + query, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (id !== request) return;
      if (!response.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
      const firstLoad = !bounds;
      bounds = data.bounds;
      // The first answer tells us the newest uploaded month; re-run once with that month.
      if (firstLoad && preset === 'latest' && bounds?.last) {
        const [s, e] = presetRange('latest');
        if (s !== startInput.value || e !== endInput.value) { [startInput.value, endInput.value] = [s, e]; return load(); }
      }
      lastData = data;
      render(data);
    } catch (error) {
      if (id !== request) return;
      lastData = null;
      renderError(error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message);
    } finally {
      if (id === request) document.querySelector('.mp-kpis').classList.remove('is-loading');
    }
  }

  function totals(rows) {
    const t = { sales: 0, orders: 0, allOrders: 0, ordersWithItems: 0, ordersWithFees: 0, feeBase: 0, fees: 0, netPayout: 0 };
    for (const row of rows) for (const key of Object.keys(t)) t[key] += Number(row[key] || 0);
    return t;
  }

  function renderError(message) {
    setStatus(message, 'error');
    for (const id of ['kpi-sales', 'kpi-orders', 'kpi-aov', 'kpi-fees', 'kpi-net']) $(id).textContent = '—';
    $('kpi-fees-foot').textContent = 'โหลดข้อมูลไม่สำเร็จ';
    $('mp-content').hidden = true;
  }

  // Shop filter only appears when the data holds more than one shop.
  function renderShopFilter(shops = []) {
    const keep = shopFilter.value || 'all';
    shopFilter.replaceChildren(new Option('ทุกร้าน', 'all'), ...shops.map(shop => new Option(shop.name + (shop.active ? '' : ' (ปิดแล้ว)'), String(shop.id))));
    shopFilter.value = shops.some(shop => String(shop.id) === keep) ? keep : 'all';
    $('shop-filter-wrap').hidden = shops.length < 2 && shopFilter.value === 'all';
  }

  function render(data) {
    $('mp-content').hidden = false;
    renderShopFilter(data.shops);
    const shopLabel = shopFilter.value === 'all' ? '' : ' · ' + shopFilter.selectedOptions[0].textContent;
    $('display-period').textContent = `${NAMES[platform]}${shopLabel} · ${thaiDate(data.start)} – ${thaiDate(data.end)}`;
    const badge = $('last-upload');
    badge.dataset.state = data.bounds?.lastUploadAt ? 'connected' : '';
    badge.textContent = data.bounds?.lastUploadAt
      ? 'อัปโหลดล่าสุด ' + new Date(data.bounds.lastUploadAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
      : 'ยังไม่มีการอัปโหลดไฟล์';

    const t = totals(data.platforms);
    if (!data.bounds?.last) setStatus(platform === 'all' ? 'ยังไม่มีข้อมูล — ให้แอดมินอัปโหลดไฟล์จาก Seller Center ก่อน' : `ยังไม่มีข้อมูล ${NAMES[platform]} — ให้แอดมินอัปโหลดไฟล์ก่อน`);
    else if (!t.allOrders) setStatus(`ไม่มีออเดอร์ในช่วงวันที่นี้ (ข้อมูลที่มีอยู่: ${thaiDate(data.bounds.first)} – ${thaiDate(data.bounds.last)})`);
    else setStatus('');

    $('kpi-sales').textContent = money(t.sales);
    $('kpi-orders').textContent = count(t.orders);
    $('kpi-aov').textContent = t.orders ? money(t.sales / t.orders) : '—';
    // No settlement rows means fee data is unknown, which is not the same as zero fees.
    if (t.ordersWithFees) {
      $('kpi-fees').textContent = money(t.fees);
      $('kpi-net').textContent = money(t.netPayout);
      const coverage = `มีข้อมูล ${count(t.ordersWithFees)} จาก ${count(t.feeBase)} ออเดอร์`;
      $('kpi-fees-foot').textContent = coverage;
      $('kpi-net-foot').textContent = coverage + ' · ยังไม่หักต้นทุน';
    } else {
      $('kpi-fees').textContent = '—';
      $('kpi-net').textContent = '—';
      const why = platform === 'lazada' ? 'ยังไม่มีใบแจ้งยอด Lazada ที่ตรงกับออเดอร์ในช่วงนี้' : 'ไม่มีไฟล์รายรับ/การชำระเงินในช่วงนี้';
      $('kpi-fees-foot').textContent = why;
      $('kpi-net-foot').textContent = why;
    }

    renderCompare(data);
    renderDaily(data);
    renderTop(data, t);
    renderStatuses(data);
    renderProvinces(data);
  }

  function renderCompare(data) {
    const panel = $('compare-panel');
    panel.hidden = platform !== 'all';
    if (panel.hidden) return;
    const rows = PLATFORMS.map(p => {
      const row = data.platforms.find(r => r.platform === p) || {};
      const st = s => data.statuses.find(r => r.platform === p && r.status === s)?.orders || 0;
      return { p, sales: row.sales || 0, orders: row.orders || 0, fees: row.ordersWithFees ? row.fees : null, net: row.ordersWithFees ? row.netPayout : null, cancelled: st('cancelled'), returned: st('returned') };
    });
    const total = rows.reduce((s, r) => s + r.sales, 0);
    const bars = $('compare-bars');
    bars.replaceChildren(...rows.filter(r => r.sales > 0).map(r => {
      const seg = el('span', 'mp-share-seg');
      seg.dataset.platform = r.p;
      seg.style.flexGrow = String(r.sales);
      seg.title = `${NAMES[r.p]} ${(r.sales / total * 100).toFixed(1)}%`;
      return seg;
    }));
    bars.hidden = !total;
    $('compare-body').replaceChildren(...rows.map(r => {
      const tr = el('tr');
      const name = el('th');
      name.scope = 'row';
      const chip = el('span', 'mp-chip', NAMES[r.p]);
      chip.dataset.platform = r.p;
      name.append(chip);
      tr.append(name);
      for (const value of [money(r.sales), total ? (r.sales / total * 100).toFixed(1) + '%' : '—', count(r.orders), r.orders ? money(r.sales / r.orders) : '—',
        r.fees == null ? 'ไม่มีข้อมูล' : money(r.fees), r.net == null ? 'ไม่มีข้อมูล' : money(r.net), count(r.cancelled), count(r.returned)]) tr.append(el('td', 'num', value));
      return tr;
    }));
  }

  function chartColors() {
    const style = getComputedStyle(document.documentElement);
    const v = name => style.getPropertyValue(name).trim();
    return { shopee: v('--mp-shopee'), lazada: v('--mp-lazada'), tiktok: v('--mp-tiktok'), ink: v('--muted') || '#888', line: v('--line') || '#ddd', surface: v('--surface') || '#fff' };
  }

  function renderDaily(data) {
    const dates = [];
    for (let d = parseIso(data.start); iso(d) <= data.end; d.setDate(d.getDate() + 1)) dates.push(iso(d));
    const series = (platform === 'all' ? PLATFORMS : [platform]).map(p => ({
      p, values: dates.map(date => data.daily.filter(r => r.date === date && r.platform === p).reduce((s, r) => s + r.sales, 0)),
    }));
    const hasData = series.some(s => s.values.some(Boolean));
    $('daily-empty').hidden = hasData;
    $('daily-empty').textContent = 'ไม่มียอดขายในช่วงวันที่นี้';
    document.querySelector('.mp-chart').hidden = !hasData;
    const legend = $('daily-legend');
    legend.replaceChildren(...(series.length > 1 ? series.map(s => { const item = el('span', 'mp-legend-item', NAMES[s.p]); item.dataset.platform = s.p; return item; }) : []));

    const table = $('daily-table');
    const head = el('tr');
    head.append(el('th', '', 'วันที่'), ...series.map(s => el('th', 'num', NAMES[s.p])));
    const thead = el('thead'); thead.append(head);
    const tbody = el('tbody');
    dates.forEach((date, i) => {
      if (!series.some(s => s.values[i])) return;
      const tr = el('tr');
      tr.append(el('td', '', thaiDate(date)), ...series.map(s => el('td', 'num', money(s.values[i]))));
      tbody.append(tr);
    });
    table.replaceChildren(thead, tbody);

    if (!hasData || !window.Chart) { chart?.destroy(); chart = null; return; }
    const colors = chartColors();
    const config = {
      type: 'bar',
      data: {
        labels: dates.map(date => parseIso(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })),
        datasets: series.map(s => ({ label: NAMES[s.p], data: s.values, backgroundColor: colors[s.p], borderColor: colors.surface, borderWidth: { top: 0, left: 0, right: 0, bottom: series.length > 1 ? 2 : 0 }, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 28 })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${money(ctx.parsed.y)}`, footer: items => items.length > 1 ? 'รวม ' + money(items.reduce((s, i) => s + i.parsed.y, 0)) : '' } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: colors.ink, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
          y: { stacked: true, beginAtZero: true, grid: { color: colors.line }, border: { display: false }, ticks: { color: colors.ink, callback: v => money(v, 0) } },
        },
      },
    };
    chart?.destroy();
    chart = new window.Chart($('daily-chart'), config);
  }

  function renderTop(data, t) {
    const list = $('top-list'), note = $('top-note');
    const missing = t.orders - t.ordersWithItems;
    note.hidden = !(missing > 0);
    note.textContent = platform === 'shopee'
      ? `ไม่รวม ${count(missing)} ออเดอร์ที่มาจาก "รายงานรายรับ" ซึ่งไม่มีรายชื่อสินค้า — อัปโหลดไฟล์คำสั่งซื้อ Shopee (Order.all) ช่วงเดียวกันเพื่อให้ครบ`
      : `ไม่รวม ${count(missing)} ออเดอร์ที่ไฟล์ไม่มีรายชื่อสินค้า (Shopee รายงานรายรับ)`;
    if (!data.topProducts.length) {
      list.replaceChildren(el('li', 'mp-empty', missing > 0 && platform === 'shopee' ? 'ไม่มีข้อมูลสินค้า' : 'ไม่มีสินค้าที่ขายได้ในช่วงนี้'));
      return;
    }
    const max = data.topProducts[0].sales || 1;
    list.replaceChildren(...data.topProducts.map((item, i) => {
      const li = el('li', 'mp-rank-item');
      li.append(el('span', 'mp-rank-no', String(i + 1)));
      const body = el('div', 'mp-rank-body');
      const title = el('strong', '', item.name);
      title.title = item.name;
      const meta = el('small', 'mp-rank-meta');
      if (item.sku) meta.append(el('span', '', item.sku));
      if (platform === 'all') for (const p of item.platforms) { const chip = el('span', 'mp-chip mp-chip-sm', NAMES[p] || p); chip.dataset.platform = p; meta.append(chip); }
      const bar = el('span', 'mp-bar');
      bar.style.setProperty('--w', (item.sales / max * 100).toFixed(1) + '%');
      body.append(title, meta, bar);
      const value = el('div', 'mp-rank-value');
      value.append(el('strong', '', money(item.sales)), el('small', '', count(item.quantity) + ' ชิ้น'));
      li.append(body, value);
      return li;
    }));
  }

  function renderStatuses(data) {
    const all = STATUS.map(([key, label, icon]) => {
      const rows = data.statuses.filter(r => r.status === key);
      return { key, label, icon, orders: rows.reduce((s, r) => s + r.orders, 0), sales: rows.reduce((s, r) => s + r.sales, 0), refund: rows.reduce((s, r) => s + (r.refund || 0), 0) };
    });
    const total = all.reduce((s, r) => s + r.orders, 0);
    $('status-list').replaceChildren(...all.map(r => {
      const li = el('li', 'mp-status');
      li.dataset.status = r.key;
      const head = el('div', 'mp-status-head');
      const name = el('span', 'mp-status-name');
      name.append(el('span', 'mp-status-icon', r.icon), document.createTextNode(r.label));
      const pct = total ? r.orders / total * 100 : 0;
      head.append(name, el('strong', '', `${count(r.orders)} ออเดอร์`));
      const bar = el('span', 'mp-bar');
      bar.style.setProperty('--w', pct.toFixed(1) + '%');
      const amount = r.key === 'returned' && r.refund ? `คืนเงิน ${money(r.refund)}` : money(r.sales);
      li.append(head, bar, el('small', 'mp-status-foot', `${total ? pct.toFixed(1) : '0'}% · ${amount}`));
      return li;
    }));
    const note = $('status-note');
    note.hidden = !(platform === 'shopee' || platform === 'all');
    note.textContent = 'Shopee: ถ้าอัปโหลดแค่รายงานรายรับ จะเห็นเฉพาะออเดอร์ที่โอนเงินแล้ว — อัปโหลดไฟล์คำสั่งซื้อ (Order.all) เพื่อให้เห็นออเดอร์ยกเลิกและกำลังจัดส่ง';
  }

  function renderProvinces(data) {
    const list = $('province-list'), note = $('province-note');
    note.hidden = !(platform === 'shopee' || platform === 'all');
    note.textContent = 'Shopee: จังหวัดมาจากไฟล์คำสั่งซื้อ (Order.all) เท่านั้น รายงานรายรับไม่มี · ระบบเก็บเฉพาะชื่อจังหวัด ไม่เก็บชื่อ เบอร์โทร หรือที่อยู่ลูกค้า';
    if (!data.provinces.length) { list.replaceChildren(el('li', 'mp-empty', 'ไม่มีข้อมูลจังหวัด')); return; }
    const max = data.provinces[0].sales || 1;
    list.replaceChildren(...data.provinces.map((row, i) => {
      const li = el('li', 'mp-rank-item');
      const body = el('div', 'mp-rank-body');
      const bar = el('span', 'mp-bar');
      bar.style.setProperty('--w', (row.sales / max * 100).toFixed(1) + '%');
      body.append(el('strong', '', row.province), bar);
      const value = el('div', 'mp-rank-value');
      value.append(el('strong', '', money(row.sales)), el('small', '', count(row.orders) + ' ออเดอร์'));
      li.append(el('span', 'mp-rank-no', String(i + 1)), body, value);
      return li;
    }));
  }

  tabs.forEach(tab => tab.addEventListener('click', () => { selectTab(tab.dataset.platform); load(); }));
  document.querySelector('.mp-tabs').addEventListener('keydown', event => {
    const i = tabs.findIndex(tab => tab.dataset.platform === platform);
    const next = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : null;
    if (next == null) return;
    const tab = tabs[(next + tabs.length) % tabs.length];
    tab.focus(); selectTab(tab.dataset.platform); load();
  });
  presets.forEach(button => button.addEventListener('click', () => { applyPreset(button.dataset.preset); load(); }));
  for (const input of [startInput, endInput]) input.addEventListener('change', () => { preset = ''; presets.forEach(b => b.setAttribute('aria-pressed', 'false')); });
  form.addEventListener('submit', event => { event.preventDefault(); load(); });
  shopFilter.addEventListener('change', load);
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (name !== platform && (name === 'all' || PLATFORMS.includes(name))) { selectTab(name); load(); }
  });
  // tiktok-api-panel.js announces a finished sync: show the new orders right away.
  window.addEventListener('tiktok-synced', () => load());
  window.addEventListener('lazada-synced', () => load());
  window.addEventListener('dashboard-theme-change', () => { if (lastData) renderDaily(lastData); });
  // New uploads show up without a manual reload.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 120000);
  window.prplusUser?.then(user => {
    if (user && (user.role === 'super_admin' || user.permissions?.includes('marketplace_upload'))) $('upload-link').hidden = false;
  });

  selectTab(platform);
  applyPreset('latest');
  load();
})();
