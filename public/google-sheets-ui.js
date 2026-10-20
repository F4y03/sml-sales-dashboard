// "Google Sheets" button on marketplace.html (Super Admin only): opens the sheet, exports now, shows the last export.
(() => {
  const box = document.getElementById('gsheets');
  const open = document.getElementById('gsheets-open');
  const button = document.getElementById('gsheets-export');
  const note = document.getElementById('gsheets-note');
  const when = iso => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const say = (state, text) => { note.dataset.state = state; note.textContent = text; };

  async function load() {
    try {
      const response = await fetch('/api/google-sheets/status', { cache: 'no-store' });
      if (!response.ok) return; // not Super Admin: keep hidden
      const data = await response.json();
      if (!data.configured) return;
      box.hidden = false;
      open.href = data.url;
      if (data.lastError) say('error', 'ส่งครั้งล่าสุดผิดพลาด: ' + data.lastError);
      else say('', data.lastExportAt ? `ส่งล่าสุด ${when(data.lastExportAt)} · อัตโนมัติทุก ${data.everyHours} ชั่วโมง` : 'ยังไม่เคยส่งข้อมูล');
    } catch { /* offline: the rest of the page shows the connection error */ }
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    say('loading', 'กำลังส่งข้อมูลไป Google Sheets…');
    try {
      const response = await fetch('/api/google-sheets/export', { method: 'POST', headers: { 'X-PRPlus-Request': '1' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'ส่งข้อมูลไม่สำเร็จ');
      await load();
    } catch (error) {
      say('error', error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message);
    } finally {
      button.disabled = false;
    }
  });
  load();
})();
