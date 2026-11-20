// สิทธิ์จัดการออเดอร์ (Super Admin only — the server answers 403 to anyone else on the page and on /api/admin/order-permissions).
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const LEVEL = { none: 'ไม่เห็นเมนู', view: 'ดูออเดอร์อย่างเดียว', update: 'ดู + อัปเดตสถานะได้' };
  const thaiDateTime = iso => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.' : '—');

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { cache: 'no-store', ...options, headers: options.method ? { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' } : {} });
    } catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่'); }
    let data = null;
    try { data = await response.json(); } catch {}
    if (response.status === 403) throw new Error('เฉพาะ Super Admin เท่านั้นที่จัดการสิทธิ์นี้ได้');
    if (!response.ok) throw new Error(data?.error || 'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
    return data;
  }

  function renderUsers(users) {
    const state = $('users-state');
    if (!users.length) { state.hidden = false; state.textContent = 'ยังไม่มีผู้ใช้'; $('users-wrap').hidden = true; return; }
    state.hidden = true;
    $('users-body').replaceChildren(...users.map(renderRow));
    $('users-wrap').hidden = false;
  }

  function renderRow(u) {
    const tr = el('tr');
    tr.dataset.id = u.id;
    const who = el('td'); const box = el('div', 'oo-perm-user'); box.append(el('strong', '', u.fullName || u.username), el('small', '', '@' + u.username)); who.append(box);
    const role = el('td', '', u.roleName || u.role);
    const ctrl = el('td'); const wrap = el('div', 'oo-perm-ctrl');
    const locked = u.role === 'super_admin' || u.roleLevel !== 'none';
    const sw = el('label', 'oo-switch');
    const input = el('input'); input.type = 'checkbox'; input.checked = u.effective !== 'none'; input.disabled = locked;
    input.setAttribute('aria-label', `เห็นเมนูจัดการออเดอร์ — ${u.username}`);
    sw.append(input, el('span', 'oo-track'), el('span', '', input.checked ? 'เห็น' : 'ไม่เห็น'));
    const select = el('select', 'mp-input');
    select.setAttribute('aria-label', `ระดับสิทธิ์ออเดอร์ — ${u.username}`);
    for (const v of ['view', 'update']) { const op = el('option', '', LEVEL[v]); op.value = v; select.append(op); }
    select.value = u.effective === 'none' ? 'view' : u.effective;
    select.hidden = u.effective === 'none';
    select.disabled = locked && u.roleLevel === 'update';
    const msg = el('span', 'oo-perm-msg');
    wrap.append(sw, select, msg);
    if (u.role === 'super_admin') wrap.append(el('span', 'oo-perm-note', 'Super Admin มีสิทธิ์ทั้งหมดเสมอ'));
    else if (u.roleLevel !== 'none') wrap.append(el('span', 'oo-perm-note', `ได้จาก role (${LEVEL[u.roleLevel]})`));
    ctrl.append(wrap);
    const active = el('td', '', u.active ? 'ใช้งาน' : 'ปิดใช้งาน');
    if (!u.active) active.className = 'oo-perm-note';
    tr.append(who, role, ctrl, active);

    async function save(level) {
      const prev = u.userLevel;
      input.disabled = select.disabled = true;
      msg.removeAttribute('data-state'); msg.textContent = 'กำลังบันทึก…';
      try {
        const data = await api('/api/admin/order-permissions/' + u.id, { method: 'PUT', body: JSON.stringify({ level }) });
        renderLog(data.log);
        const row = renderRow(data.user);
        tr.replaceWith(row);
        const m = row.querySelector('.oo-perm-msg'); m.textContent = 'บันทึกแล้ว ✓';
        setTimeout(() => { m.textContent = ''; }, 2500);
      } catch (error) {
        msg.dataset.state = 'error'; msg.textContent = error.message;
        input.checked = prev !== 'none' || u.roleLevel !== 'none';
        input.disabled = locked; select.disabled = false;
      }
    }
    input.addEventListener('change', () => save(input.checked ? select.value : 'none'));
    select.addEventListener('change', () => save(select.value));
    return tr;
  }

  function renderLog(log) {
    const state = $('log-state');
    if (!log.length) { state.hidden = false; state.textContent = 'ยังไม่มีการเปลี่ยนสิทธิ์'; $('log-wrap').hidden = true; return; }
    state.hidden = true;
    $('log-body').replaceChildren(...log.map(r => {
      const tr = el('tr');
      tr.append(el('td', '', thaiDateTime(r.at)), el('td', '', r.actor), el('td', '', r.targetName ? `${r.targetName} (@${r.target})` : r.target), el('td', '', LEVEL[r.from] || r.from || '—'), el('td', '', LEVEL[r.to] || r.to || '—'));
      return tr;
    }));
    $('log-wrap').hidden = false;
  }

  api('/api/admin/order-permissions').then(data => { renderUsers(data.users); renderLog(data.log); }).catch(error => {
    const s = $('users-state'); s.hidden = false; s.dataset.state = 'error'; s.textContent = 'โหลดรายชื่อไม่สำเร็จ: ' + error.message;
  });
})();
