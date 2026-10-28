(() => {
  const PLATFORMS = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };
  const MAX_BYTES = 20 * 1024 * 1024;
  const form = document.getElementById('upload-form');
  const input = document.getElementById('file-input');
  const dropzone = document.getElementById('dropzone');
  const list = document.getElementById('file-list');
  const formStatus = document.getElementById('form-status');
  const uploadButton = document.getElementById('upload-button');
  const clearButton = document.getElementById('clear-files');
  const historyStatus = document.getElementById('history-status');
  const historyTable = document.getElementById('history-table');
  const historyBody = document.getElementById('history-body');
  const shopSelect = document.getElementById('shop-select');
  const shopAuto = document.getElementById('shop-auto');
  const shopManager = document.getElementById('shop-manager');
  const manageButton = document.getElementById('manage-shops');
  const shopList = document.getElementById('shop-list');
  const shopNameInput = document.getElementById('shop-name');
  const shopStatus = document.getElementById('shop-status');
  const SHOP_KEY = 'mp-upload-shop';
  let shops = null;
  let queue = [];
  let uploading = false;

  const activeShops = () => (shops || []).filter(shop => shop.active);
  // The shop to upload into: the only active one, or the one picked in the list.
  const selectedShop = () => {
    const active = activeShops();
    return active.length === 1 ? active[0] : active.find(shop => String(shop.id) === shopSelect.value) || null;
  };
  const remember = value => { try { localStorage.setItem(SHOP_KEY, value); } catch {} };
  const remembered = () => { try { return localStorage.getItem(SHOP_KEY) || ''; } catch { return ''; } };

  function renderShops() {
    const active = activeShops();
    const keep = shopSelect.value || remembered();
    shopAuto.hidden = active.length !== 1;
    shopSelect.hidden = active.length === 1;
    if (active.length === 1) shopAuto.textContent = `อัปโหลดเข้าร้าน ${active[0].name} (มีร้านเดียวที่เปิดอยู่)`;
    const options = active.length
      ? [new Option('— เลือกร้าน —', ''), ...active.map(shop => new Option(shop.name, String(shop.id)))]
      : [new Option(shops ? 'ยังไม่มีร้าน กด "จัดการร้าน" เพื่อเพิ่ม' : 'กำลังโหลดรายชื่อร้าน…', '')];
    shopSelect.replaceChildren(...options);
    shopSelect.disabled = !active.length || uploading;
    if (active.some(shop => String(shop.id) === keep)) shopSelect.value = keep;
    if (shops && !shops.length) toggleManager(true);
    shopList.replaceChildren(...(shops || []).map(shop => {
      const li = document.createElement('li');
      li.className = 'mp-shop-item';
      li.dataset.active = shop.active ? '1' : '0';
      const name = document.createElement('span');
      name.textContent = shop.name + (shop.active ? '' : ' (ปิดแล้ว)');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mp-btn mp-btn-ghost mp-btn-sm';
      toggle.textContent = shop.active ? 'ปิดร้าน' : 'เปิดใช้อีกครั้ง';
      toggle.addEventListener('click', () => saveShop('/api/marketplace/shops/' + shop.id, 'PATCH', { active: !shop.active }, toggle));
      li.append(name, toggle);
      return li;
    }));
  }
  function toggleManager(open = shopManager.hidden) {
    shopManager.hidden = !open;
    manageButton.setAttribute('aria-expanded', String(open));
  }
  async function loadShops() {
    try {
      const response = await fetch('/api/marketplace/shops', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดรายชื่อร้านไม่สำเร็จ');
      shops = data.shops;
      renderShops();
    } catch (error) {
      shopSelect.replaceChildren(new Option('โหลดรายชื่อร้านไม่สำเร็จ', ''));
      shopStatus.dataset.state = 'error';
      shopStatus.textContent = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message;
    }
  }
  async function saveShop(path, method, body, button) {
    button.disabled = true;
    shopStatus.dataset.state = 'loading';
    shopStatus.textContent = 'กำลังบันทึก…';
    try {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
      shops = data.shops;
      shopStatus.dataset.state = 'ready';
      shopStatus.textContent = 'บันทึกแล้ว';
      renderShops();
      return true;
    } catch (error) {
      shopStatus.dataset.state = 'error';
      shopStatus.textContent = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message;
      return false;
    } finally {
      button.disabled = false;
    }
  }
  manageButton.addEventListener('click', () => toggleManager());
  shopSelect.addEventListener('change', () => {
    remember(shopSelect.value);
    formStatus.textContent = '';
    // A new shop choice gives files that failed a shop check another try.
    for (const entry of queue) if (entry.state === 'error' && !localCheck(entry.file)) { entry.state = 'ready'; entry.message = ''; }
    render();
  });
  const addShop = async () => {
    const name = shopNameInput.value.trim();
    if (!name) { shopNameInput.focus(); return; }
    if (await saveShop('/api/marketplace/shops', 'POST', { name }, document.getElementById('add-shop'))) shopNameInput.value = '';
  };
  document.getElementById('add-shop').addEventListener('click', addShop);
  shopNameInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addShop(); } });

  const platform = () => form.elements.platform.value;
  const sizeText = bytes => (bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');
  const dateText = iso => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  };

  function localCheck(file) {
    if (!/\.(xlsx|csv)$/i.test(file.name)) return /\.xls$/i.test(file.name)
      ? 'ไฟล์ .xls รุ่นเก่ายังไม่รองรับ กรุณาบันทึกเป็น .xlsx หรือ .csv'
      : 'รองรับเฉพาะไฟล์ .xlsx หรือ .csv';
    if (!file.size) return 'ไฟล์ว่างเปล่า กรุณาเลือกไฟล์ใหม่';
    if (file.size > MAX_BYTES) return 'ไฟล์ใหญ่เกิน 20 MB กรุณาแบ่ง export เป็นช่วงวันที่สั้นลง';
    return '';
  }

  function render() {
    list.replaceChildren(...queue.map(entry => {
      const li = document.createElement('li');
      li.className = 'mp-file';
      li.dataset.state = entry.state;
      const name = document.createElement('div');
      name.className = 'mp-file-name';
      const strong = document.createElement('strong');
      strong.textContent = entry.file.name;
      const small = document.createElement('small');
      small.textContent = sizeText(entry.file.size);
      name.append(strong, small);
      const state = document.createElement('p');
      state.className = 'mp-file-state';
      state.textContent = { ready: 'พร้อมอัปโหลด', uploading: 'กำลังตรวจไฟล์และอัปโหลด…', done: 'อัปโหลดสำเร็จ', error: entry.message }[entry.state];
      if (entry.state === 'done' && entry.message) {
        const note = document.createElement('small');
        note.textContent = entry.message;
        state.append(document.createElement('br'), note);
      }
      li.append(name, state);
      if (!uploading && entry.state !== 'uploading') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mp-file-remove';
        remove.setAttribute('aria-label', 'เอาไฟล์ ' + entry.file.name + ' ออก');
        remove.textContent = '×';
        remove.addEventListener('click', () => { queue = queue.filter(item => item !== entry); render(); });
        li.append(remove);
      }
      return li;
    }));
    const pending = queue.some(entry => entry.state === 'ready');
    uploadButton.disabled = uploading || !pending;
    clearButton.disabled = uploading || !queue.length;
    input.disabled = uploading;
  }

  function addFiles(files) {
    formStatus.textContent = '';
    for (const file of files) {
      if (queue.some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.state === 'ready')) continue;
      const error = localCheck(file);
      queue.push({ file, state: error ? 'error' : 'ready', message: error });
    }
    render();
  }

  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
  for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, event => { event.preventDefault(); if (!uploading) dropzone.classList.add('is-over'); });
  for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', event => { event.preventDefault(); if (!uploading) addFiles([...(event.dataTransfer?.files || [])]); });
  clearButton.addEventListener('click', () => { queue = []; formStatus.textContent = ''; render(); });
  form.addEventListener('change', event => {
    if (event.target.name !== 'platform') return;
    formStatus.textContent = '';
    // A new platform choice gives files that failed a platform check another try.
    for (const entry of queue) if (entry.state === 'error' && !localCheck(entry.file)) { entry.state = 'ready'; entry.message = ''; }
    render();
  });

  async function uploadOne(entry, selected, shop) {
    entry.state = 'uploading';
    render();
    try {
      const response = await fetch('/api/marketplace/upload?platform=' + encodeURIComponent(selected) + '&shop=' + encodeURIComponent(shop.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(entry.file.name), 'X-PRPlus-Request': '1' },
        body: entry.file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่');
      entry.state = 'done';
      entry.message = data.duplicate ? 'ไฟล์นี้เคยอัปโหลดแล้ว ระบบอัปเดตข้อมูลโดยไม่นับออเดอร์ซ้ำ' : '';
    } catch (error) {
      entry.state = 'error';
      entry.message = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่' : error.message;
    }
    render();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const selected = platform(), shop = selectedShop();
    if (!shop) {
      formStatus.textContent = activeShops().length ? 'กรุณาเลือกร้านก่อนอัปโหลด' : 'ยังไม่มีร้าน กรุณาเพิ่มร้านที่ "จัดการร้าน" ก่อนอัปโหลด';
      (activeShops().length ? shopSelect : manageButton).focus();
      return;
    }
    if (!selected) {
      formStatus.textContent = 'กรุณาเลือกแพลตฟอร์มก่อนอัปโหลด';
      form.querySelector('input[name=platform]').focus();
      return;
    }
    formStatus.textContent = '';
    uploading = true;
    shopSelect.disabled = true;
    render();
    for (const entry of queue.filter(item => item.state === 'ready')) await uploadOne(entry, selected, shop);
    uploading = false;
    renderShops();
    render();
    const failed = queue.filter(entry => entry.state === 'error').length;
    formStatus.textContent = failed ? `มีไฟล์ที่อัปโหลดไม่สำเร็จ กรุณาอ่านคำแนะนำใต้ชื่อไฟล์ (${shop.name} · ${PLATFORMS[selected]})` : '';
    loadHistory();
  });

  async function loadHistory() {
    historyStatus.textContent = 'กำลังโหลดประวัติ…';
    historyStatus.dataset.state = 'loading';
    try {
      const response = await fetch('/api/marketplace/uploads?source=' + document.getElementById('history-source').value, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดประวัติไม่สำเร็จ');
      historyBody.replaceChildren(...data.uploads.map(upload => {
        const tr = document.createElement('tr');
        const cells = [dateText(upload.createdAt), upload.fileName, upload.shop || 'ไม่ระบุร้าน', PLATFORMS[upload.platform] || upload.platform, upload.uploadedBy];
        ['วันเวลา', 'ชื่อไฟล์', 'ร้าน', 'แพลตฟอร์ม', 'ผู้อัปโหลด'].forEach((label, i) => {
          const td = document.createElement('td');
          td.dataset.label = label;
          if (i === 3) {
            const chip = document.createElement('span');
            chip.className = 'mp-chip';
            chip.dataset.platform = upload.platform;
            chip.textContent = cells[i];
            td.append(chip);
          } else td.textContent = cells[i];
          tr.append(td);
        });
        const action = document.createElement('td');
        action.className = 'mp-history-action';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mp-btn mp-btn-ghost mp-btn-sm mp-btn-danger';
        remove.textContent = 'ลบ';
        remove.setAttribute('aria-label', 'ลบไฟล์ ' + upload.fileName);
        remove.addEventListener('click', () => deleteUpload(upload, remove));
        action.append(remove);
        tr.append(action);
        return tr;
      }));
      historyTable.hidden = !data.uploads.length;
      historyStatus.dataset.state = data.uploads.length ? 'ready' : 'empty';
      historyStatus.textContent = data.uploads.length ? `แสดง ${data.uploads.length} รายการล่าสุด` : 'ยังไม่มีประวัติการอัปโหลด';
    } catch (error) {
      historyTable.hidden = true;
      historyStatus.dataset.state = 'error';
      historyStatus.textContent = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message;
    }
  }
  async function deleteUpload(upload, button) {
    const ok = window.confirm('ลบไฟล์ "' + upload.fileName + '" (' + (PLATFORMS[upload.platform] || upload.platform) + ') ?\n\n'
      +'ออเดอร์และข้อมูลการเงินที่มาจากไฟล์นี้จะถูกลบออกจากรายงาน ถ้าภายหลังอัปไฟล์อื่นทับออเดอร์เดียวกันไว้แล้ว ข้อมูลนั้นจะยังอยู่');
    if (!ok) return;
    button.disabled = true;
    historyStatus.dataset.state = 'loading';
    historyStatus.textContent = 'กำลังลบ…';
    try {
      const response = await fetch('/api/marketplace/uploads/' + encodeURIComponent(upload.id), { method: 'DELETE', headers: { 'X-PRPlus-Request': '1' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      await loadHistory();
    } catch (error) {
      button.disabled = false;
      historyStatus.dataset.state = 'error';
      historyStatus.textContent = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message;
    }
  }
  document.getElementById('refresh-history').addEventListener('click', loadHistory);
  document.getElementById('history-source').addEventListener('change', loadHistory);
  render();
  loadShops();
  loadHistory();
})();
