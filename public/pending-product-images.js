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

1. เช็ค manifest ที่มีอยู่แล้วก่อน — ไฟล์ product-image-drive-output/drive-upload-manifest.json (คีย์ด้วย source_url) และตาราง product_images ใน data/access.sqlite (คอลัมน์ code, links_json) คือของที่อัปโหลดไปแล้ว
2. เทียบ URL รูปในไฟล์ Excel ใหม่กับ source_url ใน manifest เดิม:
   - ถ้า source_url ตรงกับที่มี drive_url อยู่แล้ว → ข้าม ไม่ต้องดาวน์โหลด/อัปโหลดซ้ำ ใช้ drive_url เดิมได้เลย
   - ถ้าเป็น URL ใหม่ที่ยังไม่มีใน manifest → ค่อยดาวน์โหลด+อัปโหลดเฉพาะตัวนั้น
3. เทียบ code (SKU) กับ product_images.links_json เดิมด้วย — ถ้าลิงก์ที่จะได้ (หลังแทนที่) เหมือนเดิมทุกอันสำหรับ code นั้น ให้ข้ามทั้งแถวไปเลย ไม่ต้องประมวลผลไฟล์รูปของแถวนั้นซ้ำ
4. สรุปผลให้ดูแค่: จำนวนรูปใหม่ที่อัปโหลดจริง, จำนวนที่ข้ามเพราะมีอยู่แล้ว, จำนวน code ที่มีการเปลี่ยนแปลง — ไม่ต้องดาวน์โหลด/print รายการที่ไม่เปลี่ยน
5. เมื่อ import เข้า product_images ให้เขียนเฉพาะ code ที่ใหม่จริงหรือมีลิงก์เปลี่ยนแปลงเท่านั้น (ตาม dry-run ก่อน apply ทุกครั้ง)

สรุปสั้นๆ: ก่อนโหลด/อัปโหลดรูปใหม่ ให้เช็ค manifest กับ product_images ก่อน เอาแค่รูปที่ยังไม่มีจริงๆมาทำเพิ่ม`;

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
    const header = ['รหัสสินค้า', 'ชื่อสินค้าในไฟล์นำเข้า', 'จำนวนรูป', 'แถวใน Excel', 'ลิงก์รูป'];
    const rows = lastProducts.map(item => [item.code, item.name || '', item.imageCount, item.sourceRow, (item.links || []).join(' | ')]);
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
        for (const value of [item.code, item.name || '—', String(item.imageCount), String(item.sourceRow)]) {
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
      status.textContent = data.products.length
        ? `ต้องเพิ่มใน SML ${data.products.length} รายการ` : 'ไม่มีสินค้าที่รอเพิ่มใน SML';
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
