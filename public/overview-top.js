// Overview top: header state, date presets, the 4 KPI cards, comparison dialog, copy-to-clipboard and effects.
// All figures come from SML via the existing APIs: /api/dashboard (reports 4007 / 4014) and /api/sales-trend/daily.
(() => {
  const byId = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, "0");
  const toIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // Date inputs are read as local calendar days (never new Date("YYYY-MM-DD"), which is UTC).
  const fromIso = (text) => {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const shiftMonths = (text, months) => {
    const d = fromIso(text),
      first = new Date(d.getFullYear(), d.getMonth() + months, 1),
      lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return toIso(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay)));
  };
  const dayCount = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 864e5) + 1;
  // Working days: Monday–Saturday (Sunday closed).
  const workDaysIn = (a, b) => {
    let count = 0;
    for (let d = fromIso(a), last = fromIso(b); d <= last; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) count++;
    return count;
  };
  const thaiDate = (text, month = "long") => fromIso(text).toLocaleDateString("th-TH", { day: "numeric", month, year: "numeric" });
  const thaiRange = (a, b, month = "long") => (a === b ? thaiDate(a, month) : `${thaiDate(a, month)} – ${thaiDate(b, month)}`);
  // Compact range for card lines, e.g. "1–23 ส.ค. 69" or "30 ส.ค.–5 ก.ย. 69".
  const shortRange = (a, b) => {
    const x = fromIso(a),
      y = fromIso(b),
      mon = (d) => d.toLocaleDateString("th-TH", { month: "short" }),
      yy = (d) => String(d.getFullYear() + 543).slice(-2);
    if (a === b) return `${x.getDate()} ${mon(x)} ${yy(x)}`;
    if (x.getFullYear() !== y.getFullYear()) return `${x.getDate()} ${mon(x)} ${yy(x)}–${y.getDate()} ${mon(y)} ${yy(y)}`;
    if (x.getMonth() !== y.getMonth()) return `${x.getDate()} ${mon(x)}–${y.getDate()} ${mon(y)} ${yy(y)}`;
    return `${x.getDate()}–${y.getDate()} ${mon(y)} ${yy(y)}`;
  };
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const money2 = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
  const oneDecimal = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // Growth is only defined against a positive base; otherwise "–" (never Infinity / NaN).
  const growthOf = (current, base) => (Number.isFinite(current) && Number.isFinite(base) && base > 0 ? ((current - base) / base) * 100 : null);
  const pctText = (p, digits = 2) => (p == null || !Number.isFinite(p) ? "–" : `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(digits)}%`);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // ---------- presets ----------
  const PRESETS = {
    today: () => {
      const t = new Date();
      return [t, t];
    },
    yesterday: () => {
      const t = new Date();
      t.setDate(t.getDate() - 1);
      return [t, t];
    },
    "7d": () => {
      const end = new Date(),
        start = new Date();
      start.setDate(end.getDate() - 6);
      return [start, end];
    },
    month: () => {
      const end = new Date();
      return [new Date(end.getFullYear(), end.getMonth(), 1), end];
    },
    "prev-month": () => {
      const now = new Date();
      return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)];
    },
    year: () => {
      const end = new Date();
      return [new Date(end.getFullYear(), 0, 1), end];
    },
  };
  let activePreset = "month";
  function markPreset(key) {
    activePreset = key;
    document.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === key)));
  }
  function applyPreset(key) {
    const [s, e] = PRESETS[key]();
    byId("start").value = toIso(s);
    byId("end").value = toIso(e);
    markPreset(key);
  }
  const submitFilters = () => byId("filters").requestSubmit();
  document.querySelectorAll("[data-preset]").forEach((button) =>
    button.addEventListener("click", () => {
      applyPreset(button.dataset.preset);
      submitFilters();
    }),
  );
  ["start", "end"].forEach((id) =>
    byId(id).addEventListener("change", () => {
      markPreset(null);
      byId("status").textContent = "ช่วงวันที่เปลี่ยนแล้ว กดแสดงข้อมูลเพื่ออัปเดต";
    }),
  );
  byId("clear-day").addEventListener("click", () => {
    applyPreset("month");
    submitFilters();
  });
  applyPreset("month");

  // ---------- data: one function, easy to point at another SML API ----------
  async function fetchJSON(url, signal) {
    const response = await fetch(url, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
    return data;
  }
  async function totalFor(range, signal) {
    // Keep each request within the original daily API limit. Sum disjoint,
    // inclusive chunks so year comparisons retain the full selected period.
    let total = 0;
    for (let start = range.start; start <= range.end;) {
      signal?.throwIfAborted();
      const last = fromIso(start);
      last.setDate(last.getDate() + 61);
      const end = toIso(last) < range.end ? toIso(last) : range.end;
      const data = await fetchJSON(`/api/sales-trend/daily?${new URLSearchParams({ start, end })}`, signal);
      total += data.daily.reduce((sum, d) => sum + (Number(d.sales) || 0), 0);
      const next = fromIso(end);
      next.setDate(next.getDate() + 1);
      start = toIso(next);
    }
    return total;
  }
  /**
   * Everything the top cards need for one date range.
   * byDoc = report 4007 (document totals), byItem = report 4014 (item lines); both before returns.
   * mom / yoy compare byDoc with the same dates last month / last year (a missing day uses that month's last day).
   */
  async function loadRange(from, to, { dashboard, signal, compare = true } = {}) {
    const data = dashboard || (await fetchJSON(`/api/dashboard?${new URLSearchParams({ start: from, end: to })}`, signal)),
      today = toIso(new Date()),
      lastDay = to < today ? to : today,
      previous = { start: shiftMonths(from, -1), end: shiftMonths(to, -1) },
      lastYear = { start: shiftMonths(from, -12), end: shiftMonths(to, -12) },
      [previousTotal, lastYearTotal] = compare ? await Promise.all([previous, lastYear].map((range) => totalFor(range, signal).catch(() => null))) : [null, null],
      byDoc = Number(data.totalSales) || 0;
    return {
      from,
      to,
      byDoc,
      byItem: Number(data.itemSales) || 0,
      bills: Number(data.totalInvoices) || 0,
      workDays: lastDay < from ? 0 : workDaysIn(from, lastDay),
      daily: (data.daily || []).map((d) => ({ day: d.day, sales: Number(d.sales) || 0 })),
      mom: growthOf(byDoc, previousTotal),
      yoy: growthOf(byDoc, lastYearTotal),
      previous: { ...previous, byDoc: previousTotal },
      lastYear: { ...lastYear, byDoc: lastYearTotal },
      updatedAt: data.updatedAt,
    };
  }

  // ---------- number animation ----------
  function animateNumber(el, to, format, { from = 0, animate }) {
    const token = (el.countToken = (el.countToken || 0) + 1),
      paint = (v) => el.replaceChildren(...[format(v)].flat());
    if (!animate || reducedMotion() || !Number.isFinite(to)) return paint(to);
    const began = performance.now(),
      tick = (now) => {
        if (el.countToken !== token) return;
        const k = Math.min(1, (now - began) / 900);
        paint(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
    paint(from);
    requestAnimationFrame(tick);
  }
  function bump(el) {
    if (reducedMotion()) return;
    el.classList.remove("is-bump");
    void el.offsetWidth;
    el.classList.add("is-bump");
  }
  const moneyNodes = (v) => {
    const [whole2, dec] = money2.format(Math.abs(v)).split(".");
    return [`${v < 0 ? "−" : ""}฿${whole2}`, make("span", "ov-dec", "." + dec)];
  };

  // ---------- render ----------
  let latest = null,
    renderToken = 0,
    comparisonController;
  const setTone = (el, value, { warn = false } = {}) => {
    el.classList.remove("up", "down", "warn", "neutral");
    el.classList.add(warn ? "warn" : value == null ? "neutral" : value >= 0 ? "up" : "down");
  };
  function paintValue(id, to, format, previousValue, animate, copyText) {
    const el = byId(id);
    el.dataset.copyText = copyText;
    if (animate) animateNumber(el, to, format, { animate: true });
    else if (previousValue != null && previousValue !== to) {
      animateNumber(el, to, format, { from: previousValue, animate: true });
      bump(el);
    } else animateNumber(el, to, format, { animate: false });
  }
  function drawSpark(r) {
    const svg = byId("overview-spark"),
      today = toIso(new Date()),
      days = r.daily.filter((d) => d.day <= today);
    svg.replaceChildren();
    svg.classList.remove("up", "down", "neutral");
    svg.classList.add(r.mom == null ? "neutral" : r.mom >= 0 ? "up" : "down");
    if (!days.length) {
      svg.setAttribute("aria-label", "ไม่มียอดขายสะสมในช่วงที่เลือก");
      return;
    }
    let running = 0;
    const points = days.map((d) => (running += d.sales)),
      peak = Math.max(...points, 1),
      x = (i) => (points.length > 1 ? (i / (points.length - 1)) * 240 : 120),
      y = (v) => 37 - (v / peak) * 33,
      // One day: cumulative baseline to the daily total, without inventing
      // intermediate hourly values. Use the same line/area style as other ranges.
      line = points.length === 1
        ? `M0,${y(0).toFixed(1)}L240,${y(points[0]).toFixed(1)}`
        : points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""),
      ns = "http://www.w3.org/2000/svg",
      svgNode = (tag, attrs) => {
        const node = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        svg.append(node);
        return node;
      };
    const defs = svgNode("defs", {}),
      grad = document.createElementNS(ns, "linearGradient");
    grad.id = "ov-spark-fill";
    for (const [k, v] of Object.entries({ x1: 0, y1: 0, x2: 0, y2: 1 })) grad.setAttribute(k, v);
    for (const [offset, opacity] of [["0%", 0.32], ["100%", 0]]) {
      const stop = document.createElementNS(ns, "stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", "currentColor");
      stop.setAttribute("stop-opacity", opacity);
      grad.append(stop);
    }
    defs.append(grad);
    svgNode("path", { d: `${line}L240,40L0,40Z`, fill: "url(#ov-spark-fill)" });
    svgNode("path", { d: line, class: "ov-spark-line", "vector-effect": "non-scaling-stroke" });
    const label = `ยอดขายสะสม ${thaiRange(r.from, days.at(-1).day, "short")}: ฿${money2.format(points.at(-1))}` +
      (points.length === 1 ? " · ข้อมูล 1 วัน จากฐานศูนย์ถึงยอดรวม ไม่ใช่ยอดรายชั่วโมง" : "");
    svg.setAttribute("aria-label", label);
    svgNode("title", {}).textContent = label;
  }
  function renderCards(r, animate) {
    const prev = latest;
    // Card 1: document sales + MoM badge
    paintValue("total-sales", r.byDoc, moneyNodes, prev?.byDoc, animate, "฿" + money2.format(r.byDoc));
    byId("total-sales").dataset.amount = String(r.byDoc);
    const momBadge = byId("doc-mom");
    momBadge.hidden = false;
    momBadge.textContent = r.mom == null ? "– เทียบเดือนก่อน" : `${r.mom >= 0 ? "▲" : "▼"} ${pctText(r.mom)} เทียบเดือนก่อน`;
    setTone(momBadge, r.mom);
    // Card 2: item sales + difference against card 1
    paintValue("item-sales", r.byItem, moneyNodes, prev?.byItem, animate, "฿" + money2.format(r.byItem));
    byId("item-sales").dataset.amount = String(r.byItem);
    const diff = r.byItem - r.byDoc,
      diffBadge = byId("item-diff");
    diffBadge.hidden = false;
    if (Math.abs(diff) < 1) {
      diffBadge.textContent = "✓ ตรงกับยอดตามเอกสาร";
      setTone(diffBadge, 1);
    } else {
      diffBadge.textContent = `ต่างจากยอดเอกสาร ${diff > 0 ? "+" : "−"}฿${money2.format(Math.abs(diff))}`;
      setTone(diffBadge, 0, { warn: true });
    }
    byId("item-diff-pct").textContent = `ส่วนต่าง ${r.byDoc > 0 ? pctText((diff / r.byDoc) * 100, 3) : "–"} ของยอดตามเอกสาร`;
    // Card 3: bills
    paintValue("total-invoices", r.bills, (v) => [whole.format(Math.round(v)), " ", make("span", "ov-unit", "บิล")], prev?.bills, animate, whole.format(r.bills));
    byId("bills-avg").textContent = `เฉลี่ยต่อบิล ${r.bills > 0 ? "฿" + money2.format(r.byDoc / r.bills) : "–"}`;
    byId("bills-per-day").textContent = `บิลต่อวันทำการ ${r.workDays > 0 ? oneDecimal.format(r.bills / r.workDays) : "–"}${r.workDays > 0 ? ` · ${r.workDays} วัน` : ""}`;
    // Card 4: growth
    const momEl = byId("overview-mom");
    setTone(momEl, r.mom);
    if (r.mom == null) {
      momEl.countToken = (momEl.countToken || 0) + 1;
      momEl.textContent = "–";
      momEl.dataset.copyText = "–";
    } else paintValue("overview-mom", r.mom, (v) => `${r.mom >= 0 ? "↑" : "↓"} ${pctText(v)}`, prev?.mom ?? null, animate, pctText(r.mom));
    drawSpark(r);
    byId("overview-growth-mom").textContent = `MoM ${pctText(r.mom)} · เทียบ ${shortRange(r.previous.start, r.previous.end)}`;
    const yoy = byId("overview-yoy");
    yoy.textContent = `YoY ${pctText(r.yoy)} · เทียบ ${shortRange(r.lastYear.start, r.lastYear.end)}`;
    setTone(yoy, r.yoy);
    // Range line under the filters
    byId("display-period").textContent = thaiRange(r.from, r.to);
    const days = byId("range-days");
    days.hidden = false;
    days.textContent = `${whole.format(dayCount(r.from, r.to))} วัน`;
    const updated = byId("range-updated");
    updated.hidden = !r.updatedAt;
    if (r.updatedAt) {
      updated.textContent = `อัปเดต ${new Date(r.updatedAt).toLocaleTimeString("th-TH", { hour12: false })}`;
      updated.title = "รีเฟรชอัตโนมัติทุก 60 วินาที";
    }
    renderGrowthDialog(r);
    latest = r;
  }
  function renderGrowthDialog(r) {
    const details = byId("growth-details");
    details.replaceChildren(make("p", "growth-period", `ช่วงวันที่ ${thaiRange(r.from, r.to, "short")}`));
    const grid = make("div", "growth-comparison-grid");
    for (const [label, range, total, change] of [
      ["ยอดตามเอกสารช่วงนี้", r, r.byDoc, null],
      ["เทียบเดือนก่อน · MoM", r.previous, r.previous.byDoc, r.mom],
      ["เทียบปีก่อน · YoY", r.lastYear, r.lastYear.byDoc, r.yoy],
    ]) {
      const card = make("article"),
        current = range === r;
      const value = make("strong", "growth-comparison-value", current ? "฿" + money2.format(total) : change == null ? "–" : `${change >= 0 ? "↑" : "↓"} ${pctText(change)}`);
      if (!current) value.dataset.direction = change > 0 ? "up" : change < 0 ? "down" : "";
      card.append(
        make("p", "growth-comparison-label", label),
        make("p", "growth-comparison-dates", thaiRange(current ? r.from : range.start, current ? r.to : range.end, "short")),
        value,
        make("p", "growth-comparison-label", current ? "ช่วงวันที่เลือก" : total == null ? "โหลดยอดไม่สำเร็จ" : "฿" + money2.format(total)),
      );
      grid.append(card);
    }
    const note = make("section", "growth-caution");
    note.append(
      make("h3", "", "ข้อควรทราบ"),
      make("p", "", "เทียบวันที่เดียวกันของเดือนก่อนและปีก่อน ถ้าวันที่ไม่มีในเดือนนั้นจะใช้วันสุดท้ายของเดือน ไม่คำนวณ % เมื่อยอดฐานเป็นศูนย์"),
      make("p", "", "ใช้ยอดตามเอกสาร (รายงาน 4007) ก่อนหักรับคืน ตรงกับการ์ดใบแรก จึงอาจต่างจาก % ในหน้าสรุปผู้บริหารที่ใช้ยอดสุทธิหลังหักรับคืน"),
    );
    details.append(grid, make("h3", "", "อ่านตัวเลขเพื่อใช้งาน"), make("p", "", "การเติบโต = (ยอดช่วงนี้ − ยอดช่วงเปรียบเทียบ) ÷ ยอดช่วงเปรียบเทียบ × 100"), note);
  }
  function clearCards() {
    latest = null;
    for (const id of ["total-sales", "item-sales", "total-invoices", "overview-mom"]) {
      const el = byId(id);
      el.countToken = (el.countToken || 0) + 1;
      el.textContent = "—";
      el.dataset.copyText = "";
      delete el.dataset.amount;
    }
    for (const id of ["doc-mom", "item-diff", "range-days", "range-updated"]) byId(id).hidden = true;
    for (const id of ["item-diff-pct", "bills-avg", "bills-per-day", "overview-growth-mom", "overview-yoy"]) byId(id).textContent = "";
    byId("overview-spark").replaceChildren();
    byId("overview-spark").setAttribute("aria-label", "ยังไม่มีข้อมูลยอดขายสะสม");
    byId("growth-details").replaceChildren();
    byId("growth-link").disabled = true;
  }

  // ---------- interactions ----------
  let toastTimer;
  function toast(text) {
    const box = byId("copy-toast");
    box.textContent = text;
    box.hidden = false;
    box.classList.remove("is-shown");
    void box.offsetWidth;
    box.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.remove("is-shown");
      box.hidden = true;
    }, 1800);
  }
  document.querySelectorAll("[data-copy]").forEach((el) =>
    el.addEventListener("click", async () => {
      const text = el.dataset.copyText;
      if (!text || text === "–") return;
      try {
        await navigator.clipboard.writeText(text);
        toast(`คัดลอก ${text} แล้ว`);
      } catch {
        toast("คัดลอกไม่สำเร็จ");
      }
    }),
  );
  // Soft glow that follows the pointer.
  document.querySelectorAll(".ov-card").forEach((card) =>
    card.addEventListener("pointermove", (e) => {
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - box.left}px`);
      card.style.setProperty("--my", `${e.clientY - box.top}px`);
    }),
  );
  byId("doc-link").addEventListener("click", () => byId("invoice-card").click());
  byId("item-link").addEventListener("click", () => byId("products").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }));
  byId("growth-link").addEventListener("click", () => byId("growth-dialog").showModal());
  byId("growth-close").addEventListener("click", () => byId("growth-dialog").close());
  // Hover text for the (i) icons. insights-help.js later swaps the two report icons for buttons, so re-apply it afterwards.
  const tips = Object.fromEntries([...document.querySelectorAll(".ov-icon[data-tip]")].map((el) => [el.id, el.dataset.tip]));
  document.addEventListener("DOMContentLoaded", () => {
    for (const [id, tip] of Object.entries(tips)) byId(id)?.setAttribute("data-tip", tip);
  });
  const helpTopic = (title, tag, intro, formula, notes) => ({ title, tag, intro, formula, notes });
  byId("bills-help").addEventListener("click", (e) =>
    window.insightHelp?.show(
      helpTopic("จำนวนบิลทั้งหมด", "เอกสารขาย", "จำนวนเอกสารขายในช่วงวันที่เลือก", "เฉลี่ยต่อบิล = ยอดตามเอกสาร ÷ จำนวนบิล · บิลต่อวันทำการ = จำนวนบิล ÷ วันทำการ", [
        ["วันทำการ", "นับวันจันทร์–เสาร์ตั้งแต่วันเริ่มถึงวันนี้ (หรือวันสิ้นสุดถ้าเป็นช่วงในอดีต) ไม่นับวันอาทิตย์"],
        ["ยังไม่หักรับคืน", "ค่าเฉลี่ยใช้ยอดตามเอกสารก่อนหักรับคืน"],
      ]),
      e.currentTarget,
    ),
  );
  byId("growth-help").addEventListener("click", (e) =>
    window.insightHelp?.show(
      helpTopic("การเติบโต", "รายงาน 4007 · ก่อนหักรับคืน", "ยอดตามเอกสารของช่วงนี้ เทียบวันที่เดียวกันของเดือนก่อน (MoM) และปีก่อน (YoY)", "การเติบโต = (ยอดช่วงนี้ − ยอดช่วงเปรียบเทียบ) ÷ ยอดช่วงเปรียบเทียบ × 100", [
        ["วันที่ที่ไม่มีในเดือนก่อน", "เช่น 31 มี.ค. เทียบกับ 28 (หรือ 29) ก.พ. ใช้วันสุดท้ายของเดือนแทน"],
        ["เมื่อไม่มียอดเทียบ", "ถ้าช่วงที่ใช้เทียบไม่มียอดขาย จะแสดง – แทนตัวเลข"],
        ["ต่างจากหน้าสรุปผู้บริหาร", "หน้านี้ใช้ยอดก่อนหักรับคืน ส่วนหน้าสรุปผู้บริหารใช้ยอดสุทธิหลังหักรับคืน % จึงอาจต่างกัน"],
      ]),
      e.currentTarget,
    ),
  );
  // Cards rise in one by one on first paint only.
  if (!reducedMotion()) byId("overview-top").classList.add("ov-intro");

  // ---------- API for app.js ----------
  window.overviewTop = {
    loadRange,
    refreshPresetDates: () => activePreset && applyPreset(activePreset),
    setLoading: (on) => {
      if (on) {
        ++renderToken;
        comparisonController?.abort();
      }
      const cards = document.querySelector(".ov-kpis");
      cards.classList.toggle("is-loading", on);
      cards.setAttribute("aria-busy", String(on));
    },
    async show(dashboard, from, to, silent = false) {
      const token = ++renderToken;
      comparisonController?.abort();
      comparisonController = new AbortController();
      const { signal } = comparisonController;
      try {
        const initial = await loadRange(from, to, { dashboard, compare: false });
        if (token !== renderToken) return;
        renderCards(initial, !silent);
        byId("doc-mom").textContent = "กำลังโหลดข้อมูลเปรียบเทียบ…";
        byId("overview-growth-mom").textContent = "กำลังโหลดข้อมูลเปรียบเทียบ…";
        byId("overview-yoy").textContent = "";
        byId("growth-link").disabled = true;
        const r = await loadRange(from, to, { dashboard, signal });
        if (token === renderToken) {
          renderCards(r, false);
          byId("growth-link").disabled = false;
        }
      } catch {
        if (token === renderToken && !silent) clearCards();
      }
    },
    clear: () => {
      ++renderToken;
      comparisonController?.abort();
      clearCards();
    },
  };
})();
