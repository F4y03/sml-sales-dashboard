// "รายงานบัญชี" on online-orders.html: same button and workbook layout as marketplace.html, for website orders.
// Hiding the button is only for tidiness; the API checks marketplace_accounting (and the order permission) itself.
(() => {
  const $ = id => document.getElementById(id);
  const button = $('accounting-export'), dialog = $('accounting-dialog'), note = $('accounting-note'), download = $('acc-download');
  const say = (state, text) => { note.dataset.state = state; note.textContent = text; };
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const presets = [...dialog.querySelectorAll('[data-acc]')];
  function range(name) {
    const t = new Date(), y = t.getFullYear(), m = t.getMonth();
    if (name === 'prev-month') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (name === 'year') return [iso(new Date(y, 0, 1)), iso(t)];
    return [iso(new Date(y, m, 1)), iso(t)];
  }
  function pick(name) {
    presets.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.acc === name)));
    [$('acc-start').value, $('acc-end').value] = range(name);
  }
  presets.forEach(b => b.addEventListener('click', () => pick(b.dataset.acc)));
  for (const id of ['acc-start', 'acc-end']) $(id).addEventListener('change', () => presets.forEach(b => b.setAttribute('aria-pressed', 'false')));

  window.prplusUser?.then(user => {
    if (user && (user.role === 'super_admin' || user.permissions?.includes('marketplace_accounting'))) button.hidden = false;
  });
  button.addEventListener('click', () => { if (!$('acc-start').value) pick('month'); say('', ''); dialog.showModal(); });
  for (const id of ['acc-close', 'acc-cancel']) $(id).addEventListener('click', () => dialog.close());

  $('accounting-form').addEventListener('submit', async event => {
    event.preventDefault();
    const start = $('acc-start').value, end = $('acc-end').value;
    if (!start || !end || start > end) return say('error', 'กรุณาเลือกช่วงวันที่ให้ถูกต้อง');
    download.disabled = true;
    say('loading', 'กำลังออกรายงานบัญชี… (ดึงออเดอร์จากเว็บไซต์ อาจใช้เวลาสักครู่)');
    try {
      const response = await fetch('/api/online-orders/accounting-report?' + new URLSearchParams({ start, end }), { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'ออกรายงานบัญชีไม่สำเร็จ');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      const dmy = d => d.split('-').reverse().join('-'); // YYYY-MM-DD -> DD-MM-YYYY (ค.ศ.), same as marketplace
      link.href = url;
      link.download = `รายงานบัญชียอดขายเว็บไซต์-${dmy(start)} ถึง ${dmy(end)}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('', 'ดาวน์โหลดรายงานแล้ว');
    } catch (error) {
      say('error', error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message);
    } finally {
      download.disabled = false;
    }
  });
})();
