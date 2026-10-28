// Shopee sync widget (same as lazada-api-panel.js) in the marketplace.html header (Shopee tab): connection chip, Super Admin connect,
// sync for the page's date range, and the synced product/stock list. Sync answers carry no figures; a finished sync fires 'shopee-synced'.
(() => {
  const panel = document.getElementById('shopee-api');
  const chip = document.getElementById('shopee-chip');
  const meta = document.getElementById('shopee-meta');
  const connect = document.getElementById('shopee-connect');
  const button = document.getElementById('shopee-sync-button');
  const status = document.getElementById('shopee-status');
  const shopSelect = document.getElementById('shopee-shop-select');
  const itemsBox = document.getElementById('shopee-items');
  const itemsMeta = document.getElementById('shopee-items-meta');
  const itemsQ = document.getElementById('shopee-items-q');
  const itemsBody = document.getElementById('shopee-items-body');
  const itemsState = document.getElementById('shopee-items-state');
  const start = document.getElementById('start');
  const end = document.getElementById('end');
  const MAX_DAYS = 92;
  const RESULTS = {
    connected: ['ready', 'เชื่อมต่อร้าน Shopee สำเร็จ กด "ดึงข้อมูลช่วงนี้" เพื่อดึงยอดขายและสินค้า'],
    'not-configured': ['error', 'ยังไม่ได้ใส่ SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY ใน .env ของเซิร์ฟเวอร์'],
    'no-dashboard-shop': ['error', 'ยังไม่มีร้านในระบบ กรุณาเพิ่มร้าน (เช่น "Shopee") ที่หน้า "อัปโหลดไฟล์ยอดขาย" › จัดการร้าน ก่อนกดเชื่อมต่อ'],
    'choose-shop': ['error', 'มีหลายร้านในระบบ กรุณาเลือกร้านก่อนกดเชื่อมต่อ'],
    expired: ['error', 'ลิงก์เชื่อมต่อหมดอายุหรือถูกใช้ไปแล้ว กรุณากดเชื่อมต่อใหม่'],
    denied: ['error', 'ไม่ได้รับอนุญาตจาก Shopee กรุณาลองใหม่'],
    'no-shop': ['error', 'Shopee ไม่ได้ส่งรหัสร้านกลับมา (รองรับเฉพาะการอนุญาตระดับร้าน)'],
    failed: ['error', 'เชื่อมต่อ Shopee ไม่สำเร็จ กรุณาลองใหม่'],
  };
  const when = iso => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const say = (state, text) => { status.dataset.state = state; status.textContent = text; };
  const offline = error => (error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message);
  const setChip = (state, text) => { chip.dataset.state = state; chip.textContent = text; };
  const num = (v, digits = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: digits, minimumFractionDigits: digits }));

  async function load() {
    try {
      const response = await fetch('/api/shopee/status', { cache: 'no-store' });
      if (response.status === 403) return; // no shopee_sync permission (Super Admin only by default): keep the widget hidden
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดสถานะ Shopee ไม่สำเร็จ');
      panel.hidden = false;
      const conns = data.connections || [];
      const sandbox = data.env === 'sandbox' ? ' (Sandbox)' : '';
      connect.hidden = !data.canConnect || !data.configured;
      connect.textContent = conns.length ? 'เชื่อมต่อใหม่' : 'เชื่อมต่อร้าน Shopee';
      if (!connect.hidden) loadShops();
      button.hidden = !conns.length || data.readOnly; // reviewer: badge, last sync and products only
      itemsBox.hidden = !conns.length;
      const failed = conns.find(c => c.lastSyncError);
      if (!data.configured) setChip('failed', 'ยังไม่ได้ตั้งค่า Shopee API');
      else if (!conns.length) setChip('', 'ยังไม่ได้เชื่อมต่อร้าน' + sandbox);
      else setChip(failed ? 'failed' : 'connected', `เชื่อมต่อแล้ว${sandbox} · ${conns.map(c => c.shopeeShop).join(', ')}`);
      const last = conns.map(c => c.lastSyncAt).filter(Boolean).sort().pop();
      meta.textContent = [last ? 'ดึงล่าสุด ' + when(last) : conns.length ? 'ยังไม่เคยดึงข้อมูล' : '',
        conns.length && data.autoSyncMinutes ? `อัตโนมัติทุก ${data.autoSyncMinutes} นาที` : ''].filter(Boolean).join(' · ');
      const lastItems = conns.map(c => c.lastItemSyncAt).filter(Boolean).sort().pop();
      itemsMeta.textContent = lastItems ? '· อัปเดต ' + when(lastItems) : '· ยังไม่เคยดึง';
      if (failed && !status.dataset.state) say('error', 'ครั้งล่าสุดผิดพลาด: ' + failed.lastSyncError);
      else if (!conns.length && data.configured && !data.canConnect && !status.dataset.state) say('', 'กรุณาให้ Super Admin เชื่อมต่อร้าน');
    } catch (error) {
      panel.hidden = false;
      setChip('failed', 'โหลดสถานะไม่สำเร็จ');
      say('error', offline(error));
    }
  }

  async function loadItems() {
    itemsState.dataset.state = 'loading';
    itemsState.textContent = 'กำลังโหลดสินค้า…';
    try {
      const response = await fetch('/api/shopee/items?q=' + encodeURIComponent(itemsQ.value.trim()), { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดสินค้าไม่สำเร็จ');
      itemsBody.replaceChildren(...data.items.map(it => {
        const tr = document.createElement('tr');
        const cells = [it.sku || '—', [it.name, it.modelName].filter(Boolean).join(' · '), num(it.price, 2), num(it.stock)];
        cells.forEach((text, i) => { const td = document.createElement('td'); td.textContent = text; if (i >= 2) td.className = 'num'; tr.append(td); });
        if (it.stock === null) tr.lastChild.title = 'Shopee ไม่ได้ส่งจำนวนสต็อก (ไม่ใช่ 0)';
        return tr;
      }));
      itemsState.dataset.state = data.items.length ? '' : 'empty';
      itemsState.textContent = !data.items.length ? (itemsQ.value ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้า กด "ดึงข้อมูลช่วงนี้"')
        : data.truncated ? 'แสดง 500 รายการแรก กรุณาค้นหาให้แคบลง' : `${data.items.length.toLocaleString('th-TH')} รายการ`;
    } catch (error) {
      itemsState.dataset.state = 'error';
      itemsState.textContent = offline(error);
    }
  }

  // Dashboard shop the Shopee orders are saved under; the picker only matters with several active shops.
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
    connect.href = '/api/shopee/connect' + (shop ? '?shop=' + encodeURIComponent(shop) : '');
  });
  itemsBox.addEventListener('toggle', () => { if (itemsBox.open) loadItems(); });
  let typing;
  itemsQ.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(loadItems, 300); });

  // Syncs the range chosen in the page filter, so what is pulled is what is shown.
  button.addEventListener('click', async () => {
    if (!start.value || !end.value || start.value > end.value) return say('error', 'กรุณาเลือกช่วงวันที่ให้ถูกต้อง');
    if ((Date.parse(end.value) - Date.parse(start.value)) / 86400000 >= MAX_DAYS) return say('error', `ดึงได้ครั้งละไม่เกิน ${MAX_DAYS} วัน กรุณาเลือกช่วงวันที่สั้นลง`);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    say('loading', 'กำลังดึงข้อมูลจาก Shopee… อาจใช้เวลาสักครู่');
    try {
      const response = await fetch('/api/shopee/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ start: start.value, end: end.value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'ดึงข้อมูลไม่สำเร็จ กรุณาลองใหม่');
      say('ready', data.message);
    } catch (error) {
      say('error', offline(error));
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      load();
      if (itemsBox.open) loadItems();
      window.dispatchEvent(new Event('shopee-synced')); // orders may be saved even when products failed
    }
  });

  const result = new URLSearchParams(location.search).get('shopee');
  if (RESULTS[result]) {
    say(...RESULTS[result]);
    history.replaceState(null, '', location.pathname);
  }
  load();
})();
