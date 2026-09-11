(() => {
  const get = id => document.getElementById(id);
  let chart, controller, version = 0, data, yearsLoaded = false;
  const currentYear = new Date().getFullYear();
  get('trend-year').disabled = true;
  const money = value => '฿' + Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  function draw() {
    chart?.destroy(); chart = null;
    if (!data || !window.Chart) return;
    const theme = window.dashboardTheme.palette();
    const now = new Date(), year = Number(data.year);
    // Keep future-dated documents from SML; only leave empty future months blank.
    const values = data.months.map(row => {
      const future = year > now.getFullYear() || (year === now.getFullYear() && row.month > now.getMonth() + 1);
      return future && Number(row.sales) === 0 ? null : Number(row.sales);
    });
    const ctx = get('monthly-chart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, '#ff3b30'); gradient.addColorStop(1, '#8b0805');
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: data.months.map(row => new Date(year, row.month - 1, 1).toLocaleDateString('th-TH', { month: 'short' })), datasets: [
        { type: 'line', label: 'ยอดขาย', data: values, borderColor: theme.ink, pointBackgroundColor: theme.ink, pointBorderColor: theme.surface, pointRadius: 3, borderWidth: 2, tension: 0, order: 0 },
        { label: 'ยอดขาย', data: values, backgroundColor: gradient, borderRadius: 4, maxBarThickness: 35, order: 1 },
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: false }, tooltip: { filter: item => item.datasetIndex === 0, callbacks: { label: item => money(item.parsed.y) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: theme.muted, maxRotation: 0 }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: theme.line }, border: { display: false }, ticks: { color: theme.muted, callback: value => Math.abs(value) >= 1000000 ? `${value / 1000000}m` : Math.abs(value) >= 1000 ? `${value / 1000}k` : value } },
        },
      },
    });
    get('monthly-chart').setAttribute('aria-label', `ยอดขายรายเดือน ปี ${year + 543}: ` + data.months.map((row, i) => `${chart.data.labels[i]} ${values[i] === null ? 'ยังไม่ถึงเดือนนี้' : money(values[i])}`).join(', '));
  }
  async function load() {
    const id = ++version;
    controller?.abort(); controller = new AbortController();
    data = null; draw();
    get('monthly-status').hidden = false; get('monthly-status').classList.remove('error');
    get('monthly-status').textContent = 'กำลังโหลดยอดขายรายเดือน…'; get('monthly-retry').hidden = true;
    try {
      if (!yearsLoaded) {
        const response = await fetch('/api/sales-trend/years', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        if (!response.ok) throw new Error('โหลดปีไม่สำเร็จ');
        const { years } = await response.json();
        if (id !== version) return;
        get('trend-year').replaceChildren(...years.map(year => new Option(String(year + 543), String(year))));
        if (!years.length) {
          get('monthly-status').textContent = 'ยังไม่มีข้อมูลยอดขาย';
          get('trend-year').disabled = true;
          return;
        }
        get('trend-year').value = String(years.includes(currentYear) ? currentYear : years[0]);
        get('trend-year').disabled = false;
        yearsLoaded = true;
      }
      const response = await fetch(`/api/sales-trend?year=${get('trend-year').value}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (!response.ok) throw new Error('โหลดยอดขายรายเดือนไม่สำเร็จ');
      const result = await response.json();
      if (id !== version) return;
      data = result; draw();
      get('monthly-status').textContent = `รวมปี ${Number(data.year) + 543}: ${money(chart.data.datasets[0].data.reduce((sum, value) => sum + (value ?? 0), 0))} · อัปเดต ${new Date(data.updatedAt).toLocaleTimeString('th-TH')}`;
    } catch (error) {
      if (id !== version) return;
      get('monthly-status').textContent = 'โหลดยอดขายรายเดือนไม่สำเร็จ กรุณาลองใหม่';
      get('monthly-status').classList.add('error'); get('monthly-retry').hidden = false;
    }
  }
  function switchMode() {
    const monthly = get('trend-mode').value === 'monthly';
    get('daily-trend-wrap').hidden = monthly; get('monthly-trend-wrap').hidden = !monthly;
    get('trend-year-label').hidden = !monthly; get('monthly-status').hidden = !monthly;
    get('monthly-retry').hidden = true;
    get('trend-title').textContent = monthly ? 'แนวโน้มยอดขายรายเดือน' : 'แนวโน้มยอดขายรายวัน';
    get('trend-subtitle').textContent = monthly ? 'Monthly Sales Trend · แท่งและเส้นแสดงยอดขายเดียวกัน' : 'Daily Sales Trend';
    get('trend-note').textContent = monthly ? 'ยอดขายตามเดือนของเอกสาร รวมวันที่ล่วงหน้า · ยังไม่หักรับคืน · เดือนปัจจุบันยังไม่ครบเดือน' : 'ยอดขายรวมตามวันที่เอกสาร';
    if (monthly) load();
    else { ++version; controller?.abort(); }
  }
  get('trend-mode').addEventListener('change', switchMode);
  get('trend-year').addEventListener('change', load);
  get('monthly-retry').addEventListener('click', load);
  window.addEventListener('dashboard-theme-change', draw);
  setInterval(() => { if (get('trend-mode').value === 'monthly' && !document.hidden) load(); }, 60000);
})();
