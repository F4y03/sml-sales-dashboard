// TikTok Shop API page (tiktok-shop.html): connection status, Super Admin connect, manual sync.
// Like file uploads, the server answers sync with "สำเร็จ" only — no order counts or totals.
(() => {
  const panel = document.getElementById('tiktok-api');
  const list = document.getElementById('tiktok-connections');
  const connect = document.getElementById('tiktok-connect');
  const syncBox = document.getElementById('tiktok-sync');
  const start = document.getElementById('tiktok-start');
  const end = document.getElementById('tiktok-end');
  const button = document.getElementById('tiktok-sync-button');
  const status = document.getElementById('tiktok-status');
  const shopRow = document.getElementById('tiktok-shop-row');
  const shopSelect = document.getElementById('shop-select');
  const RESULTS = {
    connected: ['ready', 'เชื่อมต่อร้าน TikTok สำเร็จ กด "ดึงข้อมูล" เพื่อดึงยอดขาย'],
    'not-configured': ['error', 'ยังไม่ได้ใส่ TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_SERVICE_ID ใน .env ของเซิร์ฟเวอร์'],
    'choose-shop': ['error', 'มีหลายร้านในระบบ กรุณาเลือกร้านก่อนกดเชื่อมต่อ'],
    expired: ['error', 'ลิงก์เชื่อมต่อหมดอายุหรือถูกใช้ไปแล้ว กรุณากดเชื่อมต่อใหม่'],
    denied: ['error', 'ไม่ได้รับอนุญาตจาก TikTok กรุณาลองใหม่'],
    'no-shop': ['error', 'บัญชี TikTok นี้ไม่มีร้านที่อนุญาตให้แอปเข้าถึง'],
    failed: ['error', 'เชื่อมต่อ TikTok ไม่สำเร็จ กรุณาลองใหม่'],
  };
  const pad = n => String(n).padStart(2, '0');
  const day = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const when = iso => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'ยังไม่เคยดึงข้อมูล');
  const say = (state, text) => { status.dataset.state = state; status.textContent = text; };
  const offline = error => (error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message);

  const today = new Date();
  end.value = day(today);
  start.value = day(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));

  async function load() {
    try {
      const response = await fetch('/api/tiktok/status', { cache: 'no-store' });
      if (response.status === 403) return; // no marketplace_upload permission: keep the panel hidden
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดสถานะ TikTok ไม่สำเร็จ');
      panel.hidden = false;
      connect.hidden = !data.canConnect || !data.configured;
      if (data.connections.length) connect.textContent = 'เชื่อมต่อใหม่';
      if (!connect.hidden) loadShops();
      syncBox.hidden = !data.connections.length;
      list.replaceChildren(...data.connections.map(c => {
        const li = document.createElement('li');
        li.className = 'mp-shop-item';
        li.dataset.active = c.lastSyncError ? '0' : '1';
        const name = document.createElement('span');
        name.textContent = `${c.tiktokShop} → ร้าน ${c.shop} · ดึงล่าสุด: ${when(c.lastSyncAt)}` + (c.lastSyncError ? ` · ผิดพลาด: ${c.lastSyncError}` : '');
        li.append(name);
        return li;
      }));
      if (!data.configured) say('empty', 'ยังไม่ได้ตั้งค่า TikTok API ในเซิร์ฟเวอร์');
      else if (data.connections.length) { if (!status.dataset.state) say('ready', ''); }
      else say('empty', data.canConnect ? 'ยังไม่ได้เชื่อมต่อ กด "เชื่อมต่อร้าน TikTok"' : 'ยังไม่ได้เชื่อมต่อ กรุณาให้ Super Admin เชื่อมต่อร้าน');
    } catch (error) {
      panel.hidden = false;
      say('error', offline(error));
    }
  }

  // Dashboard shop the TikTok orders are saved under; the picker only matters with several active shops.
  async function loadShops() {
    try {
      const response = await fetch('/api/marketplace/shops', { cache: 'no-store' });
      if (!response.ok) return;
      const active = ((await response.json()).shops || []).filter(shop => shop.active);
      shopSelect.replaceChildren(...active.map(shop => new Option(shop.name, shop.id)));
      shopRow.hidden = active.length < 2;
    } catch { /* connect without a shop: the server asks to choose when it is ambiguous */ }
  }

  connect.addEventListener('click', () => {
    const shop = shopSelect.value;
    connect.href = '/api/tiktok/connect' + (shop ? '?shop=' + encodeURIComponent(shop) : '');
  });

  button.addEventListener('click', async () => {
    if (!start.value || !end.value || start.value > end.value) return say('error', 'กรุณาเลือกช่วงวันที่ให้ถูกต้อง');
    button.disabled = true;
    say('loading', 'กำลังดึงข้อมูลจาก TikTok… อาจใช้เวลาสักครู่');
    try {
      const response = await fetch('/api/tiktok/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ start: start.value, end: end.value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'ดึงข้อมูลไม่สำเร็จ กรุณาลองใหม่');
      say('ready', data.message);
    } catch (error) {
      say('error', offline(error));
    } finally {
      button.disabled = false;
      load();
    }
  });

  const result = new URLSearchParams(location.search).get('tiktok');
  if (RESULTS[result]) {
    say(...RESULTS[result]);
    history.replaceState(null, '', location.pathname);
  }
  load();
})();
