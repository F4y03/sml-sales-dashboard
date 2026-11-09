// "รายงานบัญชี" button on marketplace.html: downloads the workbook for the filters shown on screen.
// Hiding the button is only for tidiness; the API checks marketplace_accounting itself.
(() => {
  const button = document.getElementById('accounting-export');
  const note = document.getElementById('accounting-note');
  let view = null;
  const say = (state, text) => { note.dataset.state = state; note.textContent = text; };

  document.addEventListener('marketplace:view', event => { view = event.detail; });

  window.prplusUser?.then(user => {
    if (user && (user.role === 'super_admin' || user.permissions?.includes('marketplace_accounting'))) button.hidden = false;
  });

  button.addEventListener('click', async () => {
    if (!view) return say('error', 'กรุณารอให้ข้อมูลโหลดเสร็จก่อน');
    button.disabled = true;
    say('loading', 'กำลังออกรายงานบัญชี…');
    try {
      const response = await fetch('/api/marketplace/accounting-report?' + new URLSearchParams(view), { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'ออกรายงานบัญชีไม่สำเร็จ');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `รายงานบัญชียอดขายออนไลน์-${view.platform}-${view.start}-${view.end}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('', 'ดาวน์โหลดรายงานแล้ว ตรงตามตัวกรองที่แสดงอยู่');
    } catch (error) {
      say('error', error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message);
    } finally {
      button.disabled = false;
    }
  });
})();
