// แสดงช่องวันที่เป็น DD/MM/YYYY ทุก browser โดยยังเก็บค่า YYYY-MM-DD ใน input[type=date] เดิม
(function () {
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  const toDmy = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  };

  const toIso = (text) => {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(text).trim());
    if (!m) return null;
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };

  function enhance(native) {
    if (native.dataset.dmy) return;
    native.dataset.dmy = "1";

    const wrap = document.createElement("span");
    wrap.className = "date-dmy";
    native.parentNode.insertBefore(wrap, native);

    const text = document.createElement("input");
    text.type = "text";
    text.className = "date-dmy-text";
    text.placeholder = "DD/MM/YYYY";
    text.inputMode = "numeric";
    text.autocomplete = "off";
    text.maxLength = 10;
    if (native.required) text.required = true;
    if (native.getAttribute("aria-label")) text.setAttribute("aria-label", native.getAttribute("aria-label"));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-dmy-btn";
    button.setAttribute("aria-label", "เลือกจากปฏิทิน");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

    native.tabIndex = -1;
    native.setAttribute("aria-hidden", "true");
    native.classList.add("date-dmy-native");
    wrap.append(text, native, button);

    const sync = () => {
      text.value = toDmy(valueDesc.get.call(native));
      text.setCustomValidity("");
    };

    // ให้โค้ดเดิมที่ตั้ง input.value = "YYYY-MM-DD" อัปเดตช่องที่แสดงด้วย
    Object.defineProperty(native, "value", {
      configurable: true,
      get() {
        return valueDesc.get.call(this);
      },
      set(v) {
        valueDesc.set.call(this, v);
        sync();
      },
    });

    native.addEventListener("input", sync);
    native.addEventListener("change", sync);

    text.addEventListener("input", () => {
      // ใส่ / ให้อัตโนมัติขณะพิมพ์ตัวเลข
      const digits = text.value.replace(/\D/g, "").slice(0, 8);
      if (/^[\d/]*$/.test(text.value)) {
        let out = digits.slice(0, 2);
        if (digits.length > 2) out += "/" + digits.slice(2, 4);
        if (digits.length > 4) out += "/" + digits.slice(4);
        text.value = out;
      }
      text.setCustomValidity("");
    });

    const commit = () => {
      if (!text.value.trim()) {
        if (valueDesc.get.call(native) !== "") {
          valueDesc.set.call(native, "");
          native.dispatchEvent(new Event("input", { bubbles: true }));
          native.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      const iso = toIso(text.value);
      if (!iso) {
        text.setCustomValidity("กรุณากรอกวันที่เป็น DD/MM/YYYY");
        text.reportValidity();
        return;
      }
      text.setCustomValidity("");
      if (iso !== valueDesc.get.call(native)) {
        valueDesc.set.call(native, iso);
        native.dispatchEvent(new Event("input", { bubbles: true }));
        native.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sync();
    };
    text.addEventListener("change", commit);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
    });

    button.addEventListener("click", () => {
      if (native.dmyRangeOpen) return native.dmyRangeOpen(); // .ov-dates pair: one range calendar
      try {
        native.showPicker();
      } catch {
        native.focus();
        native.click();
      }
    });

    sync();
  }

  // One calendar for a from/to pair (.ov-dates with two date inputs): two months side by side, click the first day
  // then the last day (hover previews the range). Writes YYYY-MM-DD into both inputs and fires input/change like typing.
  const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const todayIso = () => { const t = new Date(); return isoOf(t.getFullYear(), t.getMonth(), t.getDate()); };

  // to === null: single-date mode (same calendar, one click picks the day). Opt-in via data-dmy-calendar.
  function enhanceRange(box, from, to) {
    if (!from || from.dmyRangeOpen) return;
    const single = !to;
    const pop = document.createElement("div");
    pop.className = "date-range-pop";
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", single ? "เลือกวันที่" : "เลือกช่วงวันที่");
    document.body.appendChild(pop);
    let view, start, end, hover;

    const setValue = (input, iso) => {
      if (input.value === iso) return;
      input.value = iso;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const owner = box || from.closest(".date-dmy") || from;
    const outside = (e) => { if (!pop.contains(e.target) && !owner.contains(e.target)) close(); };
    const place = () => {
      const r = (from.closest(".date-dmy") || from).getBoundingClientRect();
      const w = pop.offsetWidth, h = pop.offsetHeight;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      pop.style.left = Math.max(16, Math.min(r.left, window.innerWidth - w - 16)) + "px";
      pop.style.top = Math.max(8, top) + "px";
    };
    const esc = (e) => { if (e.key === "Escape") close(); };
    function close() { pop.hidden = true; document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc); window.removeEventListener("resize", close); window.removeEventListener("scroll", place, true); }

    function month(y, m) {
      const wrap = document.createElement("div");
      wrap.className = "drp-month";
      const title = document.createElement("div");
      title.className = "drp-title";
      title.textContent = `${MONTHS[m]} ${y}`;
      const grid = document.createElement("div");
      grid.className = "drp-grid";
      for (const d of DAYS) { const h = document.createElement("span"); h.className = "drp-dow"; h.textContent = d; grid.appendChild(h); }
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < first; i++) grid.appendChild(document.createElement("span"));
      const hi = end || (start && hover ? hover : null);
      const [a, b] = start && hi && hi < start ? [hi, start] : [start, hi];
      const today = todayIso();
      for (let d = 1; d <= days; d++) {
        const iso = isoOf(y, m, d), cell = document.createElement("button");
        cell.type = "button";
        cell.className = "drp-day";
        cell.textContent = d;
        cell.dataset.iso = iso;
        if (iso === today) cell.classList.add("is-today");
        if (a && b && iso > a && iso < b) cell.classList.add("in-range");
        if (iso === a || iso === b) cell.classList.add("is-edge");
        grid.appendChild(cell);
      }
      wrap.append(title, grid);
      return wrap;
    }

    function render() {
      const next = new Date(view.y, view.m + 1, 1);
      pop.textContent = "";
      const nav = document.createElement("div");
      nav.className = "drp-nav";
      const arrow = (step, label, text) => { const b = document.createElement("button"); b.type = "button"; b.className = "drp-arrow"; b.dataset.step = step; b.setAttribute("aria-label", label); b.textContent = text; return b; };
      const hint = document.createElement("span");
      hint.className = "drp-hint";
      hint.textContent = single ? "เลือกวันที่" : start && !end ? "เลือกวันสิ้นสุด" : "เลือกวันเริ่มต้น";
      nav.append(arrow(-1, "เดือนก่อน", "‹"), hint, arrow(1, "เดือนถัดไป", "›"));
      const months = document.createElement("div");
      months.className = "drp-months";
      months.append(month(view.y, view.m), month(next.getFullYear(), next.getMonth()));
      const foot = document.createElement("div");
      foot.className = "drp-foot";
      const link = (act, text) => { const b = document.createElement("button"); b.type = "button"; b.className = "drp-link"; b.dataset.act = act; b.textContent = text; return b; };
      foot.append(link("today", "วันนี้"), link("close", "ปิด"));
      pop.append(nav, months, foot);
    }

    pop.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.step) { const d = new Date(view.y, view.m + Number(t.dataset.step), 1); view = { y: d.getFullYear(), m: d.getMonth() }; return render(); }
      if (t.dataset.act === "close") return close();
      if (t.dataset.act === "today") { const iso = todayIso(); setValue(from, iso); if (!single) setValue(to, iso); return close(); }
      const iso = t.dataset.iso;
      if (!iso) return;
      if (single) { setValue(from, iso); return close(); }
      if (!start || end) { start = iso; end = null; hover = null; return render(); }
      [start, end] = iso < start ? [iso, start] : [start, iso];
      setValue(from, start);
      setValue(to, end);
      close();
    });
    pop.addEventListener("pointerover", (e) => {
      if (single) return;
      const iso = e.target.dataset && e.target.dataset.iso;
      if (iso && start && !end && iso !== hover) { hover = iso; render(); }
    });

    const open = () => {
      if (!pop.hidden) return close();
      start = from.value || null; end = single ? start : to.value || null; hover = null;
      const anchor = start ? new Date(start + "T00:00:00") : new Date();
      view = { y: anchor.getFullYear(), m: anchor.getMonth() };
      render();
      pop.hidden = false;
      place();
      window.addEventListener("resize", close);
      window.addEventListener("scroll", place, true);
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", esc);
    };
    from.dmyRangeOpen = open;
    if (!single) to.dmyRangeOpen = open;
  }

  const style = document.createElement("style");
  style.textContent = `
    .date-dmy { position: relative; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
    .date-dmy-text { width: 92px; min-width: 0; flex: 1 1 auto; background: transparent; border: 0; padding: 0;
      font: inherit; font-size: 12px; color: inherit; outline: none; }
    .date-dmy-text:focus-visible { box-shadow: 0 1px 0 currentColor; }
    .date-dmy-btn { display: inline-grid; place-items: center; flex: none; padding: 2px; margin: 0;
      background: transparent; border: 0; color: inherit; opacity: .75; cursor: pointer; }
    .date-dmy-btn:hover { opacity: 1; }
    input.date-dmy-native { position: absolute !important; left: 0; bottom: 0; width: 100% !important;
      height: 1px !important; min-width: 0 !important; padding: 0 !important; border: 0 !important;
      opacity: 0 !important; pointer-events: none; }
    .date-range-pop { position: fixed; z-index: 1000; padding: 12px;
      border: 1px solid var(--line, #ccc); border-radius: 12px; background: var(--surface, #fff); color: var(--ink, #222);
      box-shadow: 0 16px 40px rgba(0,0,0,.28); font-size: 13px; width: max-content; max-width: calc(100vw - 32px); }
    .date-range-pop[hidden] { display: none; }
    .drp-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .drp-hint { color: var(--muted, #888); font-size: 12px; }
    /* Page button styles (e.g. #overview-top button) must not leak into the calendar. */
    .date-range-pop button { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; }
    /* Theme rules (html[data-theme] button …) out-rank plain classes, so the calendar states use !important. */
    .date-range-pop button { background: transparent !important; color: inherit !important; border: 0 !important; box-shadow: none !important; }
    .date-range-pop button:focus-visible { outline: 2px solid #ff3b30; outline-offset: 1px; }
    .date-range-pop .drp-arrow, .date-range-pop .drp-link { padding: 4px 10px; border-radius: 8px; }
    .date-range-pop .drp-arrow { font-size: 20px; line-height: 1; }
    .date-range-pop .drp-arrow:hover, .date-range-pop .drp-link:hover { background: color-mix(in srgb, currentColor 10%, transparent) !important; }
    .drp-months { display: flex; gap: 18px; }
    .drp-title { text-align: center; font-weight: 700; margin-bottom: 6px; }
    .drp-grid { display: grid; grid-template-columns: repeat(7, 34px); row-gap: 2px; }
    .drp-dow { text-align: center; color: var(--muted, #888); font-size: 11px; padding: 4px 0; }
    .date-range-pop .drp-day { height: 32px; line-height: 32px; border-radius: 8px; }
    .date-range-pop .drp-day:hover { background: color-mix(in srgb, currentColor 12%, transparent) !important; }
    .date-range-pop .drp-day.is-today { box-shadow: inset 0 0 0 1px var(--muted, #888) !important; }
    .date-range-pop .drp-day.in-range { background: color-mix(in srgb, #ff3b30 22%, transparent) !important; border-radius: 0; }
    .date-range-pop .drp-day.is-edge { background: #ff3b30 !important; color: #fff !important; font-weight: 700; }
    .drp-foot { display: flex; justify-content: space-between; margin-top: 8px; }
    .date-range-pop .drp-link { color: #ff3b30 !important; font-weight: 600; }
    @media (max-width: 640px) { .drp-months > .drp-month + .drp-month { display: none; } .drp-grid { grid-template-columns: repeat(7, 38px); } }
  `;
  document.head.appendChild(style);

  const run = () => {
    document.querySelectorAll('input[type="date"]').forEach(enhance);
    // จับคู่ช่อง จาก/ถึง ที่อยู่ในกล่องเดียวกัน (.ov-dates, form ตัวกรอง ฯลฯ) ให้ใช้ปฏิทินช่วงวันที่ร่วมกัน
    const inputs = [...document.querySelectorAll('input[type="date"]')];
    for (let i = 0; i + 1 < inputs.length; i++) {
      const box = (inputs[i].closest("label") || inputs[i]).parentElement;
      if (box && box.contains(inputs[i + 1]) && box.querySelectorAll('input[type="date"]').length === 2) {
        enhanceRange(box, inputs[i], inputs[i + 1]);
        i++;
      }
    }
    // Lone date fields that ask for the same calendar (pages set data-dmy-calendar).
    for (const input of document.querySelectorAll('input[type="date"][data-dmy-calendar]')) enhanceRange(null, input, null);
  };
  // Pages that build date inputs later (e.g. reports.html conditions) call this after adding them.
  window.DateDmy = { refresh: run };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
