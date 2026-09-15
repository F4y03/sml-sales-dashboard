(() => {
  const card = document.createElement('button');
  card.type = 'button'; card.className = 'card kpi growth-card';
  card.setAttribute('aria-haspopup', 'dialog'); card.setAttribute('aria-controls', 'growth-dialog');
  card.innerHTML = '<div class="kpi-top"><span>การเติบโต ↗</span><span class="metric-icon">ⓘ</span></div><div class="metric" id="overview-mom">—</div><div class="kpi-foot" id="overview-yoy">กำลังโหลด…</div><div class="kpi-foot">ดูช่วงเวลาเปรียบเทียบ →</div>';
  document.querySelector('.overview-kpis').append(card);
  const dialog = document.getElementById('growth-dialog');
  const details = document.getElementById('growth-details');
  const metric = document.getElementById('overview-mom');
  const caption = document.getElementById('overview-yoy');
  const percent = n => n == null ? 'คำนวณไม่ได้' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
  const money = n => Number(n).toLocaleString('th-TH', { style:'currency', currency:'THB' });
  const date = s => new Date(s + 'T00:00:00').toLocaleDateString('th-TH', {day:'numeric',month:'short',year:'numeric'});
  const range = p => `${date(p.start)} – ${date(p.end)}`;
  let controller;
  window.resetOverviewGrowth = () => {
    controller?.abort(); card.disabled = true; metric.textContent = '—'; metric.dataset.direction = '';
    caption.textContent = 'ยังไม่มีข้อมูลการเติบโต'; dialog.close(); details.replaceChildren();
  };
  window.loadOverviewGrowth = async (start, end) => {
    controller?.abort(); const active = new AbortController(); controller = active;
    const timeout = setTimeout(() => active.abort(), 25000);
    caption.textContent = 'กำลังเปรียบเทียบยอดขายสุทธิ…';
    try {
      const response = await fetch('/api/executive?' + new URLSearchParams({start,end}), {cache:'no-store',signal:active.signal});
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json(); if (controller !== active) return;
      metric.textContent = data.mom == null ? '—' : `${data.mom > 0 ? '↑ ' : data.mom < 0 ? '↓ ' : ''}${percent(data.mom)}`;
      metric.dataset.direction = data.mom > 0 ? 'up' : data.mom < 0 ? 'down' : '';
      caption.textContent = `MoM เทียบเดือนก่อน · YoY ${percent(data.yoy)}`;
      details.replaceChildren();
      const node = (tag, text, className = '') => {
        const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
      };
      details.append(node('p', `ช่วงวันที่ ${range(data)}`, 'growth-period'));
      const metrics = node('div', '', 'growth-comparison-grid');
      for (const [label, net, change, isCurrent, period] of [
        ['ยอดขายสุทธิปัจจุบัน', data.net, null, true, data],
        ['เทียบเดือนก่อน · MoM', data.previousNet, data.mom, false, data.previous],
        ['เทียบปีก่อน · YoY', data.yearNet, data.yoy, false, data.year],
      ]) {
        const section = node('article', '');
        const value = node('strong', isCurrent ? money(net) : change == null ? '—' : `${change > 0 ? '↑ ' : change < 0 ? '↓ ' : ''}${percent(change)}`, 'growth-comparison-value');
        if (!isCurrent) value.dataset.direction = change > 0 ? 'up' : change < 0 ? 'down' : '';
        section.append(node('p', label, 'growth-comparison-label'), node('p', range(period), 'growth-comparison-dates'), value, node('p', isCurrent ? 'ช่วงวันที่เลือก' : money(net), 'growth-comparison-label'));
        metrics.append(section);
      }
      details.append(metrics, node('h3', 'อ่านตัวเลขเพื่อใช้งาน'), node('p', 'การเติบโต = (ยอดปัจจุบัน − ยอดช่วงเปรียบเทียบ) ÷ ยอดช่วงเปรียบเทียบ × 100 ใช้ MoM ดูแนวโน้มระยะสั้น และ YoY ประกอบการดูฤดูกาล'));
      const note = node('section', '', 'growth-caution');
      note.append(node('h3', 'ข้อควรทราบ'), node('p', 'เลื่อนวันที่ย้อนหลังตามเดือนและปี โดยปรับวันที่เกินสิ้นเดือนเป็นวันสุดท้ายของเดือน จำนวนวันอาจต่างกัน ไม่คำนวณ % เมื่อยอดฐานเป็นศูนย์หรือติดลบ'), node('p', 'ใช้ยอดขายสุทธิ = ขาย + เพิ่มหนี้ − รับคืน/ลดหนี้ ตามวันที่เอกสาร ต่างจากยอดขายก่อนหักคืนในการ์ดข้างเคียง'));
      details.append(note); card.disabled = false;
    } catch {
      if (controller === active) { metric.textContent = '—'; caption.textContent = 'โหลดการเติบโตไม่สำเร็จ'; }
    } finally { clearTimeout(timeout); }
  };
  card.onclick = () => dialog.showModal();
  document.getElementById('growth-close').onclick = () => dialog.close();
})();
