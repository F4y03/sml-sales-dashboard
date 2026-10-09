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
  let queue = [];
  let uploading = false;

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

  async function uploadOne(entry, selected) {
    entry.state = 'uploading';
    render();
    try {
      const response = await fetch('/api/marketplace/upload?platform=' + encodeURIComponent(selected), {
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
    const selected = platform();
    if (!selected) {
      formStatus.textContent = 'กรุณาเลือกแพลตฟอร์มก่อนอัปโหลด';
      form.querySelector('input[name=platform]').focus();
      return;
    }
    formStatus.textContent = '';
    uploading = true;
    render();
    for (const entry of queue.filter(item => item.state === 'ready')) await uploadOne(entry, selected);
    uploading = false;
    render();
    const failed = queue.filter(entry => entry.state === 'error').length;
    formStatus.textContent = failed ? `มีไฟล์ที่อัปโหลดไม่สำเร็จ กรุณาอ่านคำแนะนำใต้ชื่อไฟล์ (${PLATFORMS[selected]})` : '';
    loadHistory();
  });

  async function loadHistory() {
    historyStatus.textContent = 'กำลังโหลดประวัติ…';
    historyStatus.dataset.state = 'loading';
    try {
      const response = await fetch('/api/marketplace/uploads', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดประวัติไม่สำเร็จ');
      historyBody.replaceChildren(...data.uploads.map(upload => {
        const tr = document.createElement('tr');
        const cells = [dateText(upload.createdAt), upload.fileName, PLATFORMS[upload.platform] || upload.platform, upload.uploadedBy];
        ['วันเวลา', 'ชื่อไฟล์', 'แพลตฟอร์ม', 'ผู้อัปโหลด'].forEach((label, i) => {
          const td = document.createElement('td');
          td.dataset.label = label;
          if (i === 2) {
            const chip = document.createElement('span');
            chip.className = 'mp-chip';
            chip.dataset.platform = upload.platform;
            chip.textContent = cells[i];
            td.append(chip);
          } else td.textContent = cells[i];
          tr.append(td);
        });
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
  document.getElementById('refresh-history').addEventListener('click', loadHistory);
  render();
  loadHistory();
})();
