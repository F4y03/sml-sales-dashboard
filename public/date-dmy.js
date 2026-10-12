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
      try {
        native.showPicker();
      } catch {
        native.focus();
        native.click();
      }
    });

    sync();
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
  `;
  document.head.appendChild(style);

  const run = () => document.querySelectorAll('input[type="date"]').forEach(enhance);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
