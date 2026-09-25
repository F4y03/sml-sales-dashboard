(() => {
  const panel = document.getElementById('pending-product-images');
  const status = document.getElementById('pending-product-images-status');
  const table = document.getElementById('pending-product-images-table');
  const body = document.getElementById('pending-product-images-body');
  const refresh = document.getElementById('refresh-pending-product-images');
  const download = document.getElementById('download-pending-product-images');
  const downloadPrompt = document.getElementById('download-codex-prompt');
  const denied = document.getElementById('pending-product-images-denied');
  let request = 0;
  let lastProducts = [];

  const CODEX_PROMPT = `คำสั่งสำหรับ Codex — อัปโหลดรูปสินค้าจาก Excel ขึ้น Google Drive (รอบใหม่)

ทำ pipeline เดิม (ดึงลิงก์รูปจาก Excel → ดาวน์โหลด → อัปโหลดขึ้น Google Drive → แทนที่ลิงก์ในไฟล์ Excel) แต่ก่อนดาวน์โหลด/อัปโหลดรูปใดๆ ให้เช็คซ้ำก่อนเสมอ เพื่อไม่ให้เปลือง token กับรูปที่มีอยู่แล้ว:

1. จับคู่ชื่อ/รหัสสินค้าในไฟล์ Excel กับทะเบียน SML ก่อนเสมอ — ใช้ SELECT แบบ parameterized เท่านั้น (เช่น SELECT code, name FROM ic_inventory WHERE ...) ห้าม INSERT/UPDATE/DELETE ใดๆ กับ SML เพราะเป็น read-only ตัวที่ match ไม่ชัดเจนหรือไม่เจอเลย ให้แยกไว้เป็น "unmatched" ห้ามเดาเอง และห้ามเดินหน้าไปดึง/อัปโหลดรูปของแถวนั้น
2. สำหรับ code ที่ match ได้แล้ว ให้เช็คก่อนว่ามีรูปอยู่แล้วหรือยัง — SELECT links_json FROM product_images WHERE code=? (parameterized) จาก data/access.sqlite ถ้ามีรูปอยู่แล้ว (links_json ไม่ว่าง) ให้ข้ามทั้งแถวไปเลย ไม่ต้องประมวลผลไฟล์รูปของแถวนั้นซ้ำ
3. เช็ค manifest ที่มีอยู่แล้วก่อน — ไฟล์ product-image-drive-output/drive-upload-manifest.json (คีย์ด้วย source_url) คือของที่อัปโหลดไปแล้ว
4. เทียบ URL รูปในไฟล์ Excel ใหม่กับ source_url ใน manifest เดิม (เฉพาะแถวที่ผ่านข้อ 1-2 แล้ว):
   - ถ้า source_url ตรงกับที่มี drive_url อยู่แล้ว → ข้าม ไม่ต้องดาวน์โหลด/อัปโหลดซ้ำ ใช้ drive_url เดิมได้เลย
   - ถ้าเป็น URL ใหม่ที่ยังไม่มีใน manifest → ค่อยดาวน์โหลด+อัปโหลดเฉพาะตัวนั้น
5. สรุปผลให้ดูแค่: จำนวนที่จับคู่ code กับ SML ได้/unmatched, จำนวนที่ข้ามเพราะมีรูปอยู่แล้วใน product_images, จำนวนรูปใหม่ที่อัปโหลดจริง, จำนวนที่ข้ามเพราะมีอยู่แล้วใน manifest, จำนวน code ที่มีการเปลี่ยนแปลงจริง — ไม่ต้องดาวน์โหลด/print รายการที่ไม่เปลี่ยน
6. เมื่อ import เข้า product_images ให้เขียนเฉพาะ code ที่ใหม่จริงหรือมีลิงก์เปลี่ยนแปลงเท่านั้น (ตาม dry-run ก่อน apply ทุกครั้ง)

สรุปสั้นๆ: จับคู่กับ SML และเช็คว่ามีรูปแล้วหรือยังก่อน จากนั้นค่อยเช็ค manifest แล้วเอาแค่รูปที่ยังไม่มีจริงๆมาทำเพิ่ม`;

  function downloadCodexPrompt() {
    const blob = new Blob(['﻿' + CODEX_PROMPT], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codex-prompt-product-images.txt';
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function downloadCsv() {
    if (!lastProducts.length) return;
    const header = ['รหัสสินค้า / อ้างอิง', 'ชื่อสินค้า', 'จำนวนรูป', 'แหล่งข้อมูล / แถว', 'สถานะ', 'ลิงก์รูป'];
    const rows = lastProducts.map(item => [item.code || item.reference, item.name || '', item.imageCount, item.sourceUrl || item.sourceRow, stateLabel(item), (item.links || []).join(' | ')]);
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pending-product-images-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function stateLabel(item) {
    if (item.status === 'unmatched_no_images') return 'รอจับคู่รหัส SML · ยังไม่มีรูปที่ตรวจได้';
    if (item.status === 'unmatched') return 'รอจับคู่รหัส SML';
    return 'รอเพิ่มใน SML';
  }

  async function load() {
    const current = ++request;
    status.textContent = 'กำลังตรวจรายการ…';
    table.hidden = true;
    refresh.disabled = true;
    try {
      const response = await fetch('/api/products/images/pending', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('โหลดรายการไม่สำเร็จ');
      const data = await response.json();
      if (current !== request || panel.hidden) return;
      lastProducts = data.products;
      download.disabled = !data.products.length;
      body.replaceChildren();
      for (const item of data.products) {
        const row = document.createElement('tr');
        for (const value of [item.code || item.reference, item.name || '—', String(item.imageCount), item.sourceRow ? `Excel แถว ${item.sourceRow}` : (item.source || '—'), stateLabel(item)]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        const linksCell = document.createElement('td');
        for (const link of item.links || []) {
          const a = document.createElement('a');
          a.href = link;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = 'เปิดรูป ↗';
          if (linksCell.childElementCount) linksCell.append(' ');
          linksCell.append(a);
        }
        row.append(linksCell);
        body.append(row);
      }
      table.hidden = !data.products.length;
      const unmatched = data.products.filter(item => item.status?.startsWith('unmatched')).length;
      status.textContent = data.products.length
        ? `รอเพิ่มใน SML ${data.products.length - unmatched} รายการ · รอจับคู่รหัส SML ${unmatched} รายการ` : 'ไม่มีรายการค้าง';
    } catch {
      if (current === request && !panel.hidden) {
        status.textContent = 'ตรวจรายการไม่สำเร็จ กรุณากดตรวจอีกครั้ง';
        lastProducts = [];
        download.disabled = true;
      }
    } finally {
      if (current === request) refresh.disabled = false;
    }
  }

  window.addEventListener('prplus-access', event => {
    const role = event.detail?.role;
    const allowed = role === 'super_admin';
    panel.hidden = !allowed;
    if (denied) denied.hidden = allowed;
    if (allowed) load();
    else { request++; body.replaceChildren(); table.hidden = true; lastProducts = []; download.disabled = true; }
  });
  refresh.addEventListener('click', load);
  download.addEventListener('click', downloadCsv);
  downloadPrompt.addEventListener('click', downloadCodexPrompt);
})();
