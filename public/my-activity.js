// My activity page: the signed-in user's own activity log (GET /api/me/activity), 100 rows per page.
(() => {
  const status = document.getElementById('activity-status');
  const wrap = document.getElementById('activity-wrap');
  const body = document.getElementById('activity-body');
  const more = document.getElementById('activity-more');
  const ACTIONS = { login: 'เข้าสู่ระบบ (Sign in)', logout: 'ออกจากระบบ (Sign out)' };
  // SQLite CURRENT_TIMESTAMP is UTC without a zone.
  const when = at => new Date(String(at).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? '' : 'Z')).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' });
  const cell = text => { const td = document.createElement('td'); td.textContent = text ?? '—'; return td; };
  let before = null;

  async function load() {
    more.disabled = true;
    try {
      const response = await fetch('/api/me/activity' + (before ? '?before=' + before : ''), { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'โหลดบันทึกไม่สำเร็จ');
      body.append(...data.rows.map(r => { const tr = document.createElement('tr'); tr.append(cell(when(r.at)), cell(ACTIONS[r.action] || r.action), cell(r.module), cell(r.ip)); return tr; }));
      wrap.hidden = !body.children.length;
      status.dataset.state = body.children.length ? 'ready' : 'empty';
      status.textContent = body.children.length ? '' : 'ยังไม่มีบันทึกการใช้งาน (No activity yet)';
      before = data.more;
      more.hidden = !before;
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error instanceof TypeError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' : error.message;
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener('click', load);
  load();
})();
