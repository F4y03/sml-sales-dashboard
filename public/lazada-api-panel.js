// Lazada sync widget (same as lazada-api-panel.js) in the marketplace.html header (Lazada tab): connection chip, Super Admin connect, sync for the page's date range.
// Sync answers carry no figures (uploaders may lack marketplace_view); a finished sync fires 'lazada-synced' so the page reloads.
(() => {
  const panel = document.getElementById('lazada-api');
  const chip = document.getElementById('lazada-chip');
  const meta = document.getElementById('lazada-meta');
  const connect = document.getElementById('lazada-connect');
  const button = document.getElementById('lazada-sync-button');
  const status = document.getElementById('lazada-status');
  const shopSelect = document.getElementById('lazada-shop-select');
  const start = document.getElementById('start');
  const end = document.getElementById('end');
  const MAX_DAYS = 92;
  const RESULTS = {
    connected: ['ready', 'เชื่อมต่อร้าน Lazada สำเร็จ กด "ดึงข้อมูลช่วงนี้" เพื่อดึงยอดขาย'],
    'not-configured': ['error', 'ยังไม่ได้ใส่ LAZADA_APP_KEY / LAZADA_APP_SECRET ใน .env ของเซิร์ฟเวอร์'],
    'no-dashboard-shop': ['error', 'ยังไม่มีร้านในระบบ กรุณาเพิ่มร้าน (เช่น "Lazada") ที่หน้า "อัปโหลดไฟล์ยอดขาย" › จัดการร้าน ก่อนกดเชื่อมต่อ'],
    'choose-shop': ['error', 'มีหลายร้านในระบบ กรุณาเลือกร้านก่อนกดเชื่อมต่อ'],
    expired: ['error', 'ลิงก์เชื่อมต่อหมดอายุหรือถูกใช้ไปแล้ว กรุณากดเชื่อมต่อใหม่'],
    denied: ['error', 'ไม่ได้รับอนุญาตจาก Lazada กรุณาลองใหม่'],
    'no-shop': ['error', 'บัญชี Lazada นี้ไม่มีร้านที่อนุญาตให้แอปเข้าถึง'],
    failed: ['error', 'เชื่อมต่อ Lazada ไม่สำเร็จ กรุณาลองใหม่'],
  };
  const when = iso => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const say = (state, text) => { status.dataset.state = state; status.textContent = text; };
  const offline = error => (error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message);
  const setChip = (state, text) => { chip.dataset.state = state; chip.textContent = text; };

  async function load() {
    try {
      const response = await fetch('/api/lazada/status', { cache: 'no-store' });
      if (response.status === 403) return; // no lazada_sync permission (Super Admin only by default): keep the widget hidden
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดสถานะ Lazada ไม่สำเร็จ');
      panel.hidden = false;
      const conns = data.connections || [];
      connect.hidden = !data.canConnect || !data.configured;
      connect.textContent = conns.length ? 'เชื่อมต่อใหม่' : 'เชื่อมต่อร้าน Lazada';
      if (!connect.hidden) loadShops();
      button.hidden = !conns.length;
      const failed = conns.find(c => c.lastSyncError);
      if (!data.configured) setChip('failed', 'ยังไม่ได้ตั้งค่า Lazada API');
      else if (!conns.length) setChip('', 'ยังไม่ได้เชื่อมต่อร้าน');
      else setChip(failed ? 'failed' : 'connected', `เชื่อมต่อแล้ว · ${conns.map(c => c.lazadaShop).join(', ')}`);
      const last = conns.map(c => c.lastSyncAt).filter(Boolean).sort().pop();
      meta.textContent = [last ? 'ดึงล่าสุด ' + when(last) : conns.length ? 'ยังไม่เคยดึงข้อมูล' : '',
        conns.length && data.autoSyncMinutes ? `อัตโนมัติทุก ${data.autoSyncMinutes} นาที` : ''].filter(Boolean).join(' · ');
      if (failed && !status.dataset.state) say('error', 'ครั้งล่าสุดผิดพลาด: ' + failed.lastSyncError);
      else if (!conns.length && data.configured && !data.canConnect && !status.dataset.state) say('', 'กรุณาให้ Super Admin เชื่อมต่อร้าน');
    } catch (error) {
      panel.hidden = false;
      setChip('failed', 'โหลดสถานะไม่สำเร็จ');
      say('error', offline(error));
    }
  }

  // Dashboard shop the Lazada orders are saved under; the picker only matters with several active shops.
  async function loadShops() {
    try {
      const response = await fetch('/api/marketplace/shops', { cache: 'no-store' });
      if (!response.ok) return;
      const active = ((await response.json()).shops || []).filter(shop => shop.active);
      shopSelect.replaceChildren(...active.map(shop => new Option(shop.name, shop.id)));
      shopSelect.hidden = active.length < 2;
    } catch { /* connect without a shop: the server asks to choose when it is ambiguous */ }
  }

  connect.addEventListener('click', () => {
    const shop = shopSelect.value;
    connect.href = '/api/lazada/connect' + (shop ? '?shop=' + encodeURIComponent(shop) : '');
  });

  // Syncs the range chosen in the page filter, so what is pulled is what is shown.
  button.addEventListener('click', async () => {
    if (!start.value || !end.value || start.value > end.value) return say('error', 'กรุณาเลือกช่วงวันที่ให้ถูกต้อง');
    if ((Date.parse(end.value) - Date.parse(start.value)) / 86400000 >= MAX_DAYS) return say('error', `ดึงได้ครั้งละไม่เกิน ${MAX_DAYS} วัน กรุณาเลือกช่วงวันที่สั้นลง`);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    say('loading', 'กำลังดึงข้อมูลจาก Lazada… อาจใช้เวลาสักครู่');
    try {
      const response = await fetch('/api/lazada/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ start: start.value, end: end.value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'ดึงข้อมูลไม่สำเร็จ กรุณาลองใหม่');
      say('ready', data.message);
    } catch (error) {
      say('error', offline(error));
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      load();
      window.dispatchEvent(new Event('lazada-synced')); // orders may be saved even when fees failed
    }
  });

  const result = new URLSearchParams(location.search).get('lazada');
  if (RESULTS[result]) {
    say(...RESULTS[result]);
    history.replaceState(null, '', location.pathname);
  }
  load();
})();
