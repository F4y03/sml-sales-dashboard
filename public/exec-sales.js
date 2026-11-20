// หน้าเว็บไซต์ — WooCommerce analytics. Data: /api/exec-sales/* (server checks the permission on every call and
// caches the shop's answers for 1 minute). Charts: Chart.js (same bundle as the rest of the app).
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const money = (n, d = 0) => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money2 = n => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const count = n => Number(n || 0).toLocaleString('th-TH');
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const thDate = (s, opt = { day: 'numeric', month: 'short', year: '2-digit' }) => parse(s).toLocaleDateString('th-TH', opt);
  const thMonth = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
  const STATUS = [ // fixed order + fixed colour per status (colour follows the entity, never the rank)
    ['completed', 'สำเร็จ', 'c3'], ['processing', 'รอจัดส่ง', 'c2'], ['on-hold', 'พักไว้', 'c5'], ['pending', 'รอชำระ', 'c4'],
    ['cancelled', 'ยกเลิก', 'other'], ['refunded', 'คืนเงิน', 'other'], ['failed', 'ชำระไม่สำเร็จ', 'other'],
  ];

  function colors() {
    const s = getComputedStyle(document.documentElement), v = n => s.getPropertyValue(n).trim();
    return { c1: v('--es-c1'), c2: v('--es-c2'), c3: v('--es-c3'), c4: v('--es-c4'), c5: v('--es-c5'), other: v('--es-other'), region: v('--es-region-out'),
      ink: v('--ink') || '#111', muted: v('--muted') || '#888', line: v('--line') || '#ddd', surface: v('--surface') || '#fff' };
  }

  async function api(path) {
    let r;
    try { r = await fetch(path, { cache: 'no-store' }); } catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'); }
    let data = null; try { data = await r.json(); } catch {}
    if (r.status === 403) throw new Error('คุณไม่มีสิทธิ์ดูหน้าเว็บไซต์ กรุณาติดต่อ Super Admin');
    if (!r.ok) throw new Error(data?.error || 'ดึงข้อมูลไม่สำเร็จ กรุณาลองใหม่');
    return data;
  }

  // ---------- state & period
  const state = { loadedAt: 0, start: '', end: '', preset: '7d', interval: 'day', metric: 'net', provinceMode: 'province', ov: null, tl: null, canViewOrders: false, req: 0, tlReq: 0 };
  const presets = [...document.querySelectorAll('[data-preset]')];
  function presetRange(name) {
    const t = new Date(), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
    switch (name) {
      case 'today': return [iso(t), iso(t)];
      case 'yesterday': { const x = new Date(y, m, d - 1); return [iso(x), iso(x)]; }
      case 'month': return [iso(new Date(y, m, 1)), iso(t)];
      case 'prev-month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
      case 'year': return [iso(new Date(y, 0, 1)), iso(t)];
      default: return [iso(new Date(y, m, d - 6)), iso(t)];
    }
  }
  function choosePreset(name) {
    state.preset = name;
    presets.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
    const custom = name === 'custom';
    $('custom-dates').hidden = !custom; $('custom-apply').hidden = !custom;
    if (custom) { $('start').value = state.start; $('end').value = state.end; return; }
    [state.start, state.end] = presetRange(name);
    // A sensible default resolution per range; the user can still switch.
    const days = (parse(state.end) - parse(state.start)) / 86400000 + 1;
    state.interval = days <= 2 ? 'hour' : days <= 62 ? 'day' : days <= 200 ? 'week' : 'month';
    load();
  }
  presets.forEach(b => b.addEventListener('click', () => choosePreset(b.dataset.preset)));
  $('filters').addEventListener('submit', e => {
    e.preventDefault();
    const s = $('start').value, en = $('end').value;
    if (!s || !en || s > en) { setStatus('กรุณาเลือกช่วงวันที่ให้ถูกต้อง', true); return; }
    if ((parse(en) - parse(s)) / 86400000 > 365) { setStatus('เลือกได้ไม่เกิน 366 วัน', true); return; }
    state.start = s; state.end = en;
    const days = (parse(en) - parse(s)) / 86400000 + 1;
    state.interval = days <= 2 ? 'hour' : days <= 62 ? 'day' : days <= 200 ? 'week' : 'month';
    load();
  });
  const setStatus = (text, error = false) => { $('status').textContent = text; $('status').className = 'ov-status' + (error ? ' error' : ''); };

  // ---------- panels: loading / empty / error
  const charts = {};
  const panel = name => document.querySelector(`.es-panel[data-chart="${name}"]`);
  function panelState(name, { loading = false, message = '', error = false } = {}) {
    const p = panel(name), box = p.querySelector('.es-chart');
    p.classList.toggle('is-loading', loading);
    box.querySelector('.es-empty')?.remove();
    p.querySelector('.es-png').disabled = loading || Boolean(message);
    if (message) {
      charts[name]?.destroy?.(); delete charts[name];
      box.querySelector('canvas').style.visibility = 'hidden';
      const m = el('div', 'es-empty', message); if (error) m.dataset.state = 'error'; box.append(m);
    } else box.querySelector('canvas').style.visibility = '';
  }
  const EMPTY = 'ไม่มีข้อมูลในช่วงนี้';

  // ---------- load
  async function load({ quiet = false } = {}) {
    const id = ++state.req;
    $('display-period').textContent = state.start === state.end ? thDate(state.start, { day: 'numeric', month: 'long', year: 'numeric' }) : `${thDate(state.start)} – ${thDate(state.end)}`;
    // Auto-refresh (quiet) keeps the current charts on screen until the new numbers arrive: no skeleton flash.
    if (!quiet) {
      setStatus('');
      $('kpi-error').textContent = '';
      document.querySelector('.es-kpis').classList.add('is-loading');
      for (const p of document.querySelectorAll('.es-panel')) panelState(p.dataset.chart, { loading: true });
    }
    loadTimeline({ quiet });
    try {
      const ov = await api(`/api/exec-sales/overview?start=${state.start}&end=${state.end}`);
      if (id !== state.req) return;
      state.ov = ov;
      $('display-prev').textContent = `${thDate(ov.prevStart)} – ${thDate(ov.prevEnd)}`;
      if (quiet) { setStatus(''); $('kpi-error').textContent = ''; }
      renderAll();
      state.loadedAt = Date.now();
      $('live').textContent = 'อัปเดตอัตโนมัติทุก 1 นาที · ล่าสุด ' + new Date(ov.generatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
      $('live').dataset.state = 'connected';
    } catch (error) {
      if (id !== state.req) return;
      if (quiet && state.ov) {
        // Keep showing the last good numbers; try again on the next tick.
        state.loadedAt = Date.now() - AUTO_MS + 30000;
        $('live').textContent = 'ดึงอัตโนมัติไม่สำเร็จ · แสดงข้อมูลเมื่อ ' + new Date(state.ov.generatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
        $('live').dataset.state = 'failed';
        return;
      }
      state.ov = null;
      document.querySelector('.es-kpis').classList.remove('is-loading');
      document.querySelectorAll('.es-kpis .ov-value').forEach(v => { v.textContent = '—'; });
      setStatus('โหลดข้อมูลไม่สำเร็จ: ' + (error instanceof TypeError ? 'ข้อมูลที่ได้รับไม่ถูกต้อง' : error.message), true);
      $('live').textContent = 'เชื่อมต่อเว็บไซต์ไม่สำเร็จ'; $('live').dataset.state = 'failed';
      for (const p of document.querySelectorAll('.es-panel')) if (p.dataset.chart !== 'timeline') panelState(p.dataset.chart, { message: 'โหลดข้อมูลไม่สำเร็จ', error: true });
    }
  }
  async function loadTimeline({ quiet = false } = {}) {
    const id = ++state.tlReq;
    syncIntervalButtons();
    if (!quiet) panelState('timeline', { loading: true });
    try {
      const tl = await api(`/api/exec-sales/timeline?start=${state.start}&end=${state.end}&interval=${state.interval}`);
      if (id !== state.tlReq) return;
      state.tl = tl; state.interval = tl.interval; syncIntervalButtons();
      renderTimeline();
    } catch (error) {
      if (id !== state.tlReq) return;
      if (quiet && state.tl) return; // keep the last good chart
      state.tl = null;
      panelState('timeline', { message: 'โหลดกราฟไม่สำเร็จ: ' + (error instanceof TypeError ? 'ข้อมูลที่ได้รับไม่ถูกต้อง' : error.message), error: true });
    }
  }
  function syncIntervalButtons() {
    const days = state.start ? (parse(state.end) - parse(state.start)) / 86400000 + 1 : 7;
    document.querySelectorAll('#interval-seg [data-interval]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.interval === state.interval));
      b.disabled = b.dataset.interval === 'hour' && days > 7;
      b.title = b.disabled ? 'รายชั่วโมงดูได้เมื่อช่วงไม่เกิน 7 วัน' : '';
    });
  }
  document.querySelectorAll('#interval-seg [data-interval]').forEach(b => b.addEventListener('click', () => { state.interval = b.dataset.interval; loadTimeline(); }));
  document.querySelectorAll('#product-seg [data-metric]').forEach(b => b.addEventListener('click', () => {
    state.metric = b.dataset.metric; document.querySelectorAll('#product-seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderProducts();
  }));
  document.querySelectorAll('#province-seg [data-mode]').forEach(b => b.addEventListener('click', () => {
    state.provinceMode = b.dataset.mode; document.querySelectorAll('#province-seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderProvinces();
  }));

  function renderAll() {
    renderKpis(); renderStatus(); renderProducts(); renderDonut('categories', 'legend-categories', state.ov.categories, s => s.items.map(c => ({ name: c.name, value: c.net })));
    renderProvinces();
  }

  // ---------- drill-down to จัดการออเดอร์ (only when the viewer may open that page)
  function goOrders({ start, end, product, name, status }) {
    if (!state.canViewOrders) return;
    const q = new URLSearchParams({ status: status || 'any', start, end: end || start });
    if (product) { q.set('product', product); q.set('pname', name || ''); }
    q.set('from', 'exec');
    location.href = 'online-orders.html?' + q;
  }
  const clickable = name => panel(name).querySelector('.es-chart').classList.toggle('is-clickable', state.canViewOrders);

  // ---------- shared chart options
  function baseOptions(c, { money: isMoney = true, stacked = false, horizontal = false, onPick } = {}) {
    const fmt = isMoney ? v => money(v) : v => count(v);
    const valueAxis = { beginAtZero: true, stacked, grid: { color: c.line }, border: { display: false }, ticks: { color: c.muted, maxRotation: 0, maxTicksLimit: horizontal ? 5 : undefined, callback: v => (isMoney ? (Math.abs(v) >= 1e6 ? '฿' + (v / 1e6).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + 'M' : money(v)) : count(v)), precision: isMoney ? undefined : 0 } };
    const catAxis = { stacked, grid: { display: false }, border: { color: c.line }, ticks: { color: c.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: horizontal ? undefined : 10 } };
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: horizontal ? 'nearest' : 'index', intersect: horizontal, axis: horizontal ? 'y' : 'x' },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } } },
      scales: horizontal ? { x: valueAxis, y: { ...catAxis, ticks: { ...catAxis.ticks, color: c.ink, callback(v) { const l = this.getLabelForValue(v); return l.length > 26 ? l.slice(0, 25) + '…' : l; } } } } : { x: catAxis, y: valueAxis },
      onClick: onPick ? (evt, els, chart) => { const hit = chart.getElementsAtEventForMode(evt, horizontal ? 'nearest' : 'index', { intersect: horizontal }, false)[0]; if (hit) onPick(hit.index, hit.datasetIndex); } : undefined,
    };
  }
  function draw(name, config) {
    charts[name]?.destroy?.();
    charts[name] = new window.Chart(panel(name).querySelector('canvas'), config);
  }
  const legend = (id, items) => $(id).replaceChildren(...items.map(([label, color, kind = '']) => { const s = el('span'); const i = el('i', kind); i.style.setProperty('--c', color); s.append(i, document.createTextNode(label)); return s; }));
  function sectionGuard(name, section) {
    if (!section?.ok) { panelState(name, { message: 'โหลดข้อมูลส่วนนี้ไม่สำเร็จ: ' + (section?.error || 'ไม่ทราบสาเหตุ'), error: true }); return false; }
    return true;
  }

  // ---------- KPI cards
  const KPI = { net: { f: money2 }, orders: { f: count }, aov: { f: money2 }, discount: { f: money2, inverse: true }, refunds: { f: money2, inverse: true } };
  function renderKpis() {
    const k = state.ov.kpis, wrap = document.querySelector('.es-kpis');
    wrap.classList.remove('is-loading');
    if (!k.ok) { document.querySelectorAll('.es-kpis .ov-value').forEach(v => { v.textContent = '—'; }); $('kpi-error').textContent = 'โหลดการ์ดสรุปไม่สำเร็จ: ' + k.error; return; }
    for (const card of wrap.querySelectorAll('[data-kpi]')) {
      const key = card.dataset.kpi, cfg = KPI[key], cur = k.current[key], prev = k.previous[key];
      card.querySelector('.ov-value').textContent = cfg.f(cur);
      card.querySelector('.es-prev').textContent = 'ช่วงก่อน ' + cfg.f(prev);
      const badge = card.querySelector('.ov-badge');
      if (prev > 0) {
        const p = (cur - prev) / prev * 100, up = p >= 0;
        // Discount / refunds: going up is bad news, so the colour flips (the arrow still shows the direction).
        const good = cfg.inverse ? !up : up;
        badge.textContent = `${up ? '▲' : '▼'} ${Math.abs(p).toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`;
        badge.className = 'ov-badge ' + (Math.abs(p) < 0.05 ? 'neutral' : good ? 'up' : 'down');
        badge.title = `เทียบช่วงก่อนหน้า (${cfg.f(prev)})`;
        badge.hidden = false;
      } else { badge.textContent = cur > 0 ? 'ใหม่' : '—'; badge.className = 'ov-badge neutral'; badge.title = 'ช่วงก่อนหน้าไม่มีข้อมูล'; badge.hidden = false; }
      spark(card.querySelector('.ov-spark'), k.spark.map(s => s[key]), badge.classList.contains('down') ? 'down' : badge.classList.contains('up') ? 'up' : '');
    }
  }
  function spark(svg, values, tone) {
    svg.replaceChildren();
    svg.setAttribute('class', 'ov-spark ' + tone);
    if (values.length < 2 || !values.some(Boolean)) return;
    const max = Math.max(...values), min = Math.min(0, ...values), span = max - min || 1;
    const x = i => (i / (values.length - 1)) * 240, y = v => 38 - ((v - min) / span) * 34;
    const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ns = 'http://www.w3.org/2000/svg', node = (t, a) => { const n = document.createElementNS(ns, t); for (const k in a) n.setAttribute(k, a[k]); svg.append(n); return n; };
    node('path', { d: `${line}L240,40L0,40Z`, fill: 'currentColor', 'fill-opacity': '0.14' });
    node('path', { d: line, class: 'ov-spark-line', 'vector-effect': 'non-scaling-stroke' });
  }

  // ---------- 1. sales over time (current vs previous, dashed)
  function intervalLabel(start, interval) {
    if (!start) return '';
    if (interval === 'hour') return thDate(start, { day: 'numeric', month: 'short' }) + ' ' + start.slice(11, 16);
    if (interval === 'week') return 'สัปดาห์ ' + thDate(start, { day: 'numeric', month: 'short' });
    if (interval === 'month') return thMonth(start.slice(0, 7));
    return thDate(start, { day: 'numeric', month: 'short' });
  }
  function renderTimeline() {
    const tl = state.tl, c = colors();
    if (!tl) return;
    panelState('timeline');
    if (!tl.current.some(i => i.net) && !tl.previous.some(i => i.net)) { panelState('timeline', { message: EMPTY }); legend('legend-timeline', []); return; }
    legend('legend-timeline', [[`ช่วงนี้ (${thDate(tl.start)} – ${thDate(tl.end)})`, c.c1, 'line'], [`ช่วงก่อนหน้า (${thDate(tl.prevStart)} – ${thDate(tl.prevEnd)})`, c.c2, 'dash']]);
    const labels = tl.current.map(i => intervalLabel(i.start, tl.interval));
    const opts = baseOptions(c, { onPick: idx => { const i = tl.current[idx]; if (i) goOrders({ start: i.start.slice(0, 10), end: (i.end || i.start).slice(0, 10) }); } });
    opts.plugins.tooltip.callbacks = {
      title: items => labels[items[0].dataIndex],
      label: ctx => ctx.datasetIndex === 0 ? `ช่วงนี้: ${money(ctx.parsed.y)}` : `ช่วงก่อน (${intervalLabel(tl.previous[ctx.dataIndex]?.start, tl.interval)}): ${money(ctx.parsed.y)}`,
      footer: items => { const i = tl.current[items[0].dataIndex]; return i ? `${count(i.orders)} ออเดอร์` : ''; },
    };
    draw('timeline', { type: 'line', data: { labels, datasets: [
      { label: 'ช่วงนี้', data: tl.current.map(i => i.net), borderColor: c.c1, backgroundColor: c.c1, borderWidth: 2, pointRadius: tl.current.length > 40 ? 0 : 3, pointHoverRadius: 5, tension: 0.25 },
      { label: 'ช่วงก่อน', data: tl.current.map((_, i) => tl.previous[i]?.net ?? null), borderColor: c.c2, backgroundColor: c.c2, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4, tension: 0.25 },
    ] }, options: opts });
    clickable('timeline');
  }

  // ---------- 2. orders per day, stacked by status
  function bucketsFor(bucket) {
    const keys = [];
    if (bucket === 'day') for (let d = parse(state.ov.start); iso(d) <= state.ov.end; d.setDate(d.getDate() + 1)) keys.push(iso(d));
    else for (let d = new Date(parse(state.ov.start).getFullYear(), parse(state.ov.start).getMonth(), 1); iso(d).slice(0, 7) <= state.ov.end.slice(0, 7); d.setMonth(d.getMonth() + 1)) keys.push(iso(d).slice(0, 7));
    return keys;
  }
  const bucketLabel = (k, bucket) => (bucket === 'day' ? thDate(k, { day: 'numeric', month: 'short' }) : thMonth(k));
  const bucketRange = (k, bucket) => bucket === 'day' ? { start: k, end: k } : { start: k + '-01', end: iso(new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0)) };
  function renderStatus() {
    const s = state.ov.statusChart, c = colors();
    if (!sectionGuard('status', s)) return;
    panelState('status');
    const keys = bucketsFor(s.bucket);
    const known = STATUS.filter(([st]) => s.series.some(x => x.status === st));
    const extra = s.series.filter(x => !STATUS.some(([st]) => st === x.status)).map(x => [x.status, x.status, 'other']);
    const rows = [...known, ...extra].map(([st, label, col]) => ({ st, label, color: c[col], counts: s.series.find(x => x.status === st)?.counts || {} }));
    if (!rows.length) { panelState('status', { message: EMPTY }); legend('legend-status', []); return; }
    legend('legend-status', rows.map(r => [r.label, r.color]));
    const totals = state.ov.statusTotals?.ok ? state.ov.statusTotals.items.filter(x => x.total).map(x => `${x.name} ${count(x.total)}`).join(' · ') : '';
    $('note-status').textContent = (s.truncated ? 'แสดง 5,000 ออเดอร์แรกของช่วงนี้ · ' : '') + (s.bucket === 'month' ? 'ช่วงยาวเกิน 92 วัน แสดงเป็นรายเดือน · ' : '') + (totals ? 'ทั้งร้านทุกช่วงเวลา: ' + totals : '');
    const opts = baseOptions(c, { money: false, stacked: true, onPick: (idx, ds) => goOrders({ ...bucketRange(keys[idx], s.bucket), status: rows[ds]?.st }) });
    opts.plugins.tooltip.callbacks.label = ctx => ctx.parsed.y ? `${ctx.dataset.label}: ${count(ctx.parsed.y)} ออเดอร์` : null;
    opts.plugins.tooltip.callbacks.footer = items => 'รวม ' + count(items.reduce((a, i) => a + i.parsed.y, 0)) + ' ออเดอร์';
    draw('status', { type: 'bar', data: { labels: keys.map(k => bucketLabel(k, s.bucket)), datasets: rows.map(r => ({ label: r.label, data: keys.map(k => r.counts[k] || 0), backgroundColor: r.color, borderColor: c.surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: 3, maxBarThickness: 26 })) }, options: opts });
    clickable('status');
  }

  // ---------- 3. top products (horizontal)
  function renderProducts() {
    const s = state.ov?.products, c = colors();
    if (!state.ov || !sectionGuard('products', s)) return;
    panelState('products');
    const list = state.metric === 'net' ? s.byNet : s.byQty;
    if (!list.length) { panelState('products', { message: EMPTY }); return; }
    const isMoney = state.metric === 'net';
    const opts = baseOptions(c, { money: isMoney, horizontal: true, onPick: idx => goOrders({ start: state.ov.start, end: state.ov.end, product: list[idx].id, name: list[idx].name }) });
    opts.plugins.tooltip.callbacks = { title: items => list[items[0].dataIndex].name, label: ctx => { const p = list[ctx.dataIndex]; return [`ยอดขาย: ${money(p.net)}`, `จำนวน: ${count(p.qty)} ชิ้น`, p.sku ? `SKU: ${p.sku}` : ''].filter(Boolean); } };
    draw('products', { type: 'bar', data: { labels: list.map(p => p.name), datasets: [{ label: isMoney ? 'ยอดขาย' : 'จำนวนชิ้น', data: list.map(p => (isMoney ? p.net : p.qty)), backgroundColor: c.c1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 }] }, options: opts });
    clickable('products');
  }

  // ---------- 4. category donut
  function renderDonut(name, legendId, section, pick) {
    const c = colors();
    if (!sectionGuard(name, section)) { $(legendId).replaceChildren(); return; }
    panelState(name);
    let items = pick(section).filter(i => i.value > 0).sort((a, b) => b.value - a.value);
    if (!items.length) { panelState(name, { message: EMPTY }); $(legendId).replaceChildren(); return; }
    if (items.length > 6) items = [...items.slice(0, 5), { name: 'อื่นๆ', value: items.slice(5).reduce((a, i) => a + i.value, 0), other: true }];
    const palette = [c.c1, c.c2, c.c3, c.c4, c.c5];
    const fill = items.map((i, idx) => (i.other || i.name === 'อื่นๆ' ? c.other : palette[idx]));
    const total = items.reduce((a, i) => a + i.value, 0);
    const pctOf = v => (v / total * 100).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + '%';
    $(legendId).replaceChildren(...items.map((i, idx) => { const li = el('li'); const dot = el('i'); dot.style.setProperty('--c', fill[idx]); const n = el('span', '', i.name); n.title = i.name; const b = el('b', '', money(i.value)); b.append(el('small', '', pctOf(i.value))); li.append(dot, n, b); return li; }));
    draw(name, { type: 'doughnut', data: { labels: items.map(i => i.name), datasets: [{ data: items.map(i => i.value), backgroundColor: fill, borderColor: c.surface, borderWidth: 2, hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${money(ctx.parsed)} (${pctOf(ctx.parsed)})` + (items[ctx.dataIndex].orders ? ` · ${count(items[ctx.dataIndex].orders)} ออเดอร์` : '') } } } } });
  }

  // ---------- 6. provinces / regions (horizontal, same red as the regional consignment chart)
  function renderProvinces() {
    const s = state.ov?.provinces, c = colors();
    if (!state.ov || !sectionGuard('provinces', s)) return;
    panelState('provinces');
    const list = (state.provinceMode === 'region' ? s.regions : s.provinces).filter(x => x.total > 0).slice(0, 10);
    if (!list.length) { panelState('provinces', { message: EMPTY }); return; }
    $('note-provinces').textContent = 'จังหวัดจากรหัสไปรษณีย์ที่อยู่จัดส่ง · ยอดตามออเดอร์รวมค่าส่ง' + (s.truncated ? ' · นับจาก 5,000 ออเดอร์แรก' : '');
    const opts = baseOptions(c, { horizontal: true });
    opts.plugins.tooltip.callbacks = { title: items => list[items[0].dataIndex].name + (list[items[0].dataIndex].region && state.provinceMode === 'province' ? ` (${list[items[0].dataIndex].region})` : ''), label: ctx => [`ยอดขาย: ${money(ctx.parsed.x)}`, `${count(list[ctx.dataIndex].orders)} ออเดอร์`] };
    draw('provinces', { type: 'bar', data: { labels: list.map(x => x.name), datasets: [{ label: 'ยอดขาย', data: list.map(x => x.total), backgroundColor: c.region, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 }] }, options: opts });
  }

  // ---------- PNG + Excel/CSV
  document.querySelectorAll('.es-png').forEach(btn => btn.addEventListener('click', () => {
    const p = btn.closest('.es-panel'), src = p.querySelector('canvas'), c = colors();
    const title = p.querySelector('h2').textContent, scale = 1, pad2 = 24 * (window.devicePixelRatio || 1);
    const out = document.createElement('canvas');
    out.width = src.width + pad2 * 2; out.height = src.height + pad2 * 3;
    const ctx = out.getContext('2d');
    ctx.fillStyle = c.surface; ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = c.ink; ctx.font = `700 ${Math.round(16 * (window.devicePixelRatio || 1))}px "IBM Plex Sans Thai", sans-serif`; ctx.textBaseline = 'top';
    ctx.fillText(`${title} · ${$('display-period').textContent}`, pad2, pad2 * 0.6);
    ctx.drawImage(src, pad2, pad2 * 2, src.width * scale, src.height * scale);
    const a = document.createElement('a');
    a.download = `เว็บไซต์-${p.dataset.chart}-${state.start}_${state.end}.png`;
    a.href = out.toDataURL('image/png'); a.click();
  }));
  async function exportFile(format, btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'กำลังเตรียม…';
    try {
      const r = await fetch(`/api/exec-sales/export?start=${state.start}&end=${state.end}&format=${format}`, { cache: 'no-store' });
      if (!r.ok) { let m = 'ส่งออกไม่สำเร็จ'; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = `เว็บไซต์-${state.start}_${state.end}.${format}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setStatus('ส่งออกไม่สำเร็จ: ' + e.message, true); } finally { btn.disabled = false; btn.textContent = old; }
  }
  $('export-xlsx').addEventListener('click', e => exportFile('xlsx', e.currentTarget));
  $('export-csv').addEventListener('click', e => exportFile('csv', e.currentTarget));

  // ---------- theme / resize
  const rerender = () => { if (state.ov) renderAll(); if (state.tl) renderTimeline(); };
  window.addEventListener('dashboard-theme-change', () => requestAnimationFrame(rerender));

  // ---------- auto refresh: every minute while the page is open and visible (the server keeps answers for
  // 1 minute, so polling faster would only return the same numbers). Rolling presets (วันนี้ / 7 วัน / เดือนนี้ …)
  // move with the clock, so a page left open past midnight shows the new day.
  const AUTO_MS = 60 * 1000 + 5000;
  function autoRefresh() {
    if (document.hidden || !state.loadedAt || Date.now() - state.loadedAt < AUTO_MS) return;
    if (state.preset !== 'custom') [state.start, state.end] = presetRange(state.preset);
    state.loadedAt = Date.now(); // no double fire while this request runs
    load({ quiet: true });
  }
  setInterval(autoRefresh, 15000);
  document.addEventListener('visibilitychange', autoRefresh);

  // ---------- boot
  api('/api/exec-sales/me').then(me => {
    state.canViewOrders = me.canViewOrders;
    if (!me.configured) { $('config-alert').hidden = false; $('config-alert').textContent = 'ยังไม่ได้ตั้งค่าการเชื่อมต่อเว็บไซต์ (WC_KEY / WC_SECRET) — ติดต่อผู้ดูแลระบบ'; }
    if (state.canViewOrders) for (const n of ['timeline', 'status', 'products']) clickable(n);
  }).catch(() => {});
  const waitChart = () => (window.Chart ? choosePreset('7d') : setTimeout(waitChart, 50));
  waitChart();
})();
