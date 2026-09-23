// Sales trend card: daily line, monthly bars and year-over-year comparison, drawn as plain SVG.
// Data: sales documents (trans_flag 44) by document date, before returns (report 4007 definition).
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const RED = "#ff3b30",
    RED_DEEP = "#9e0b0f",
    GREY = "#8a8a94";
  let uid = 0;

  // ---------- helpers ----------
  const svgEl = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (parent) parent.append(e);
    return e;
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const money = (v, digits = 2) =>
    "฿" + Number(v).toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const trimZeros = (s) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
  const short = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return trimZeros((v / 1e6).toFixed(2)) + "M";
    if (a >= 1e3) return trimZeros((v / 1e3).toFixed(a >= 1e5 ? 0 : 1)) + "K";
    return String(Math.round(v));
  };
  const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  const pctText = (p) => (p > 0 ? "+" : p < 0 ? "−" : "±") + Math.abs(p).toFixed(1) + "%";
  const tone = (p) => (p == null ? "" : p >= 0 ? "up" : "down");
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => new Date(s + "T00:00:00");
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r1 = (v) => Math.round(v * 10) / 10;
  const beYear = (y) => y + 543;
  const rangeLabel = (a, b) => {
    const x = parse(a),
      y = parse(b);
    return x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear()
      ? `${x.getDate()}–${y.getDate()} ${MONTHS[y.getMonth()]}`
      : `${x.getDate()} ${MONTHS[x.getMonth()]}–${y.getDate()} ${MONTHS[y.getMonth()]}`;
  };
  const shiftMonth = (s, by) => {
    const d = parse(s),
      first = new Date(d.getFullYear(), d.getMonth() + by, 1),
      last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return iso(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last)));
  };
  const now = () => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, today: iso(d) };
  };

  const running = {};
  function animate(key, ms, draw, enabled) {
    running[key]?.();
    delete running[key];
    if (!enabled || still()) return draw(1);
    const begin = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - begin) / ms);
      draw(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
      else delete running[key];
    };
    draw(0);
    raf = requestAnimationFrame(tick);
    running[key] = () => cancelAnimationFrame(raf);
  }

  // Round steps (1 / 2 / 2.5 / 5 × 10ⁿ, e.g. 250K) for about `parts` divisions up to `max`.
  function niceScale(max, parts = 4) {
    if (!(max > 0)) return { top: 1000, ticks: [0, 250, 500, 750, 1000] };
    const raw = max / parts,
      mag = 10 ** Math.floor(Math.log10(raw)),
      f = raw / mag,
      step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag,
      top = Math.ceil(max / step) * step,
      ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    return { top, ticks };
  }

  const barPath = (x, y, w, h, r = 4) => {
    if (h <= 0.2) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };

  // ---------- shared frame / tooltip ----------
  const widths = {};
  function frame(box, svg, { left = 44, bottom = 28, tall = false } = {}) {
    const W = Math.floor(box.clientWidth);
    widths[box.id] = W;
    svg.replaceChildren();
    if (!W) return null;
    const H = tall ? (W < 520 ? 290 : 370) : W < 520 ? 236 : 284;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    return { W, H, b: { l: left, t: 14, w: W - left - 68, h: H - 14 - bottom } };
  }
  function yAxis(svg, b, scale) {
    const g = svgEl("g", { class: "tg-grid" }, svg);
    for (const v of scale.ticks) {
      const y = r1(b.t + b.h - (v / scale.top) * b.h);
      svgEl("line", { x1: b.l, x2: b.l + b.w, y1: y, y2: y }, g);
      svgEl("text", { x: b.l - 10, y: y + 4, "text-anchor": "end", class: "tg-tick" }, g).textContent = short(v);
    }
  }
  function monthAxis(svg, b, cx) {
    const g = svgEl("g", { class: "tg-xaxis" }, svg),
      every = b.w / 12 < 30 ? 2 : 1;
    MONTHS.forEach((m, i) => {
      if (i % every) return;
      svgEl("text", { x: r1(cx(i)), y: b.t + b.h + 18, "text-anchor": "middle", class: "tg-tick" }, g).textContent = m;
    });
  }
  function avgMarker(svg, b, y, label) {
    const g = svgEl("g", { class: "tg-avg" }, svg);
    svgEl("line", { x1: b.l, x2: b.l + b.w, y1: r1(y), y2: r1(y) }, g);
    const pill = svgEl("rect", { class: "tg-avg-pill", rx: 4, height: 17 }, g),
      text = svgEl("text", { x: b.l + b.w + 10, y: r1(y) + 3.5, class: "tg-avg-label" }, g);
    text.textContent = label;
    const w = text.getComputedTextLength?.() || label.length * 5.5;
    pill.setAttribute("x", b.l + b.w + 5);
    pill.setAttribute("y", r1(y) - 8.5);
    pill.setAttribute("width", r1(w + 10));
    return g;
  }
  function placeholder(svg, W, H, text) {
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "tg-empty" }, svg).textContent = text;
  }
  function tipOf(box) {
    let tip = box.querySelector(".trend-tip");
    if (!tip) {
      tip = el("div", "trend-tip");
      tip.hidden = true;
      tip.setAttribute("role", "status");
      box.append(tip);
    }
    return tip;
  }
  function showTip(box, x, y, rows) {
    const tip = tipOf(box);
    tip.replaceChildren(...rows);
    tip.hidden = false;
    // Keep the box inside the plot (and so inside the card) on every side.
    const bw = box.clientWidth,
      bh = box.clientHeight,
      tw = tip.offsetWidth,
      th = tip.offsetHeight;
    let left = x + 14;
    if (left + tw > bw - 4) left = x - tw - 14;
    let top = y - th - 12;
    if (top < 4) top = y + 14;
    left = clamp(left, 4, Math.max(4, bw - tw - 4));
    top = clamp(top, 4, Math.max(4, bh - th - 4));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  const tipTitle = (t) => el("span", "tip-title", t);
  const tipValue = (t) => el("strong", "tip-value", t);
  const tipNote = (t, cls = "") => el("span", `tip-note ${cls}`.trim(), t);
  const tipSeries = (color, label, value) => {
    const row = el("span", "tip-series"),
      dot = el("i");
    dot.style.background = color;
    row.append(dot, el("span", "", label), el("b", "", value));
    return row;
  };
  const hiders = {};
  function interactive(box, key, count, show, hide) {
    let active = null;
    const set = (i) => {
      active = i;
      if (i == null) hide();
      else show(i);
    };
    hiders[key] = () => set(null);
    box.onkeydown = (e) => {
      if (!count) return;
      const next = {
        ArrowRight: (active ?? -1) + 1,
        ArrowLeft: (active ?? count) - 1,
        Home: 0,
        End: count - 1,
      }[e.key];
      if (e.key === "Escape") return set(null);
      if (next == null) return;
      e.preventDefault();
      set(clamp(next, 0, count - 1));
    };
    box.onblur = () => set(null);
    return set;
  }
  document.addEventListener("pointerdown", (e) => {
    for (const [key, hide] of Object.entries(hiders)) {
      const box = { daily: $("daily-trend-wrap"), monthly: $("monthly-trend-wrap"), compare: $("compare-plot") }[key];
      if (box && !box.contains(e.target)) hide();
    }
  });

  // ---------- state ----------
  const state = {
    mode: "daily",
    daily: null,
    dailyError: "",
    prev: null,
    years: null,
    monthly: null,
    monthlyError: false,
    prevYear: null,
  };

  function prepDaily(raw) {
    const { today } = now(),
      days = raw.daily.map((r) => r.day),
      values = raw.daily.map((r) => Number(r.sales) || 0),
      // Average uses closed working days only: no Sundays (closed) and not today (still open).
      working = days.map((s, i) => i).filter((i) => parse(days[i]).getDay() !== 0 && days[i] < today),
      avg = working.length ? working.reduce((a, i) => a + values[i], 0) / working.length : null;
    let best = null;
    values.forEach((v, i) => {
      if (v > 0 && (best == null || v > values[best])) best = i;
    });
    return {
      start: raw.start,
      end: raw.end,
      days,
      values,
      avg,
      working,
      workingDays: working.length,
      below: avg == null ? null : working.filter((i) => values[i] < avg).length,
      best,
      total: values.reduce((a, b) => a + b, 0),
    };
  }

  // Monthly figures. "Closed" months are months that have fully ended; zero months count as no data.
  function monthlyStats(data, prev) {
    const { year: cy, month: cm } = now(),
      year = Number(data.year),
      vals = data.months.map((r) => Number(r.sales) || 0),
      closed = (i) => year < cy || (year === cy && i + 1 < cm),
      closedIdx = vals.map((_, i) => i).filter((i) => closed(i) && vals[i] !== 0),
      avg = closedIdx.length ? closedIdx.reduce((a, i) => a + vals[i], 0) / closedIdx.length : null;
    let best = null,
      worst = null;
    for (const i of closedIdx) {
      if (best == null || vals[i] > vals[best]) best = i;
      if (worst == null || vals[i] < vals[worst]) worst = i;
    }
    const pvals = prev ? prev.months.map((r) => Number(r.sales) || 0) : null;
    return {
      year,
      vals,
      pvals,
      avg,
      closedIdx,
      closedCount: closedIdx.length,
      best,
      worst,
      total: vals.reduce((a, b) => a + b, 0),
      range: pvals ? sameMonthRange(year, vals, year - 1, pvals) : 0,
      isCurrent: (i) => year === cy && i + 1 === cm,
      isFuture: (i) => year > cy || (year === cy && i + 1 > cm),
    };
  }
  // Last month to compare, inclusive: the shorter of the two years. The current year stops at this month,
  // so advance-dated documents in later months don't get compared against full months of the other year.
  function sameMonthRange(yearA, a, yearB, b) {
    const { year: cy, month: cm } = now();
    const end = (y, v) => {
      if (y === cy) return cm;
      let last = 0;
      v.forEach((x, i) => {
        if (x !== 0) last = i + 1;
      });
      return last;
    };
    return Math.min(end(yearA, a), end(yearB, b));
  }
  const sumTo = (v, m) => v.slice(0, m).reduce((a, b) => a + b, 0);

  // ---------- KPIs (click a card for its explanation) ----------
  const dayName = (s) => {
    const x = parse(s);
    return `${WEEKDAYS[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]}`;
  };
  const signedMoney = (v) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
  const NOT_NET = ["ยังไม่หักรับคืน", "ยอดนี้ยังไม่หักเอกสารรับคืน / ลดหนี้ ตรงกับการ์ด \"ยอดขายตามเอกสาร\" ด้านบน"];
  function kpi(label, value, sub = "", cls = "", title = "", explain = null) {
    const box = el(explain ? "button" : "div", "trend-kpi");
    const v = el("strong", "", value);
    if (title) v.title = title;
    box.append(el("span", "", label), v, el("small", cls, sub));
    if (explain) {
      box.type = "button";
      box.setAttribute("aria-haspopup", "dialog");
      box.setAttribute("aria-label", `${label} ${value} ${sub} · กดเพื่อดูคำอธิบาย`);
      const info = el("i", "trend-kpi-info", "ⓘ");
      info.setAttribute("aria-hidden", "true");
      box.append(info);
      box.addEventListener("click", () => window.insightHelp?.show({ ...explain(), current: value }, box));
    }
    return box;
  }
  function dailyKpis(d) {
    const p = state.prev,
      { year, month, today } = now(),
      label1 = d.start === `${year}-${String(month).padStart(2, "0")}-01` && d.end === today ? "ยอดขายเดือนนี้" : "ยอดขายช่วงที่เลือก",
      range = rangeLabel(d.start, d.end);
    let sub = "",
      cls = "";
    if (p?.skip) sub = "เทียบเดือนก่อนได้เมื่อช่วงไม่เกิน 31 วัน";
    else if (!p || p.loading) sub = "กำลังเทียบกับเดือนก่อน…";
    else if (p.error) sub = "เทียบเดือนก่อนไม่สำเร็จ · จะลองใหม่อัตโนมัติ";
    else {
      const c = pct(d.total, p.total);
      sub = c == null ? `เดือนก่อนไม่มียอด (${rangeLabel(p.start, p.end)})` : `${pctText(c)} เทียบ ${rangeLabel(p.start, p.end)}`;
      cls = tone(c);
    }
    const sundays = d.days.map((_, i) => i).filter((i) => parse(d.days[i]).getDay() === 0),
      workSum = d.working.reduce((a, i) => a + d.values[i], 0),
      below = d.avg == null ? [] : d.working.filter((i) => d.values[i] < d.avg),
      best = d.best == null ? null : parse(d.days[d.best]);
    return [
      kpi(label1, money(d.total, 0), sub, cls, money(d.total), () => {
        const rows = [[`ช่วงนี้ · ${range}`, money(d.total)]],
          notes = [
            ["เทียบกับช่วงไหน", "ใช้วันที่เดียวกันของเดือนก่อน เช่น 1–23 ก.ย. เทียบกับ 1–23 ส.ค. ถ้าเดือนก่อนไม่มีวันที่นั้น (เช่น วันที่ 31) จะใช้วันสุดท้ายของเดือนแทน"],
            ["ถ้าช่วงนี้รวมวันนี้", "ยอดของวันนี้ยังเพิ่มได้จนปิดวัน ขณะที่วันเดียวกันของเดือนก่อนปิดยอดครบแล้ว % ระหว่างวันจึงอาจต่ำกว่าผลจริงเล็กน้อย"],
            NOT_NET,
          ];
        if (p?.total != null) {
          const c = pct(d.total, p.total);
          rows.push([`เดือนก่อน · ${rangeLabel(p.start, p.end)}`, money(p.total)], ["ส่วนต่าง", signedMoney(d.total - p.total) + (c == null ? "" : ` (${pctText(c)})`)]);
        } else if (p?.skip || p?.error)
          notes.unshift([
            "ทำไมยังไม่มี % เทียบ",
            p.skip
              ? "เทียบได้เฉพาะช่วงไม่เกิน 31 วัน ช่วงที่ยาวกว่านี้จะซ้อนทับกับเดือนก่อน"
              : "โหลดยอดเดือนก่อนไม่สำเร็จ ระบบจะลองใหม่เองเมื่อรีเฟรชข้อมูล (ทุก 60 วินาที) หรือกดแสดงข้อมูลอีกครั้ง",
          ]);
        return {
          title: label1,
          tag: "รายงาน 4007 · ก่อนหักรับคืน",
          intro: `รวมยอดเงินระดับเอกสารขายทุกใบตามวันที่เอกสาร ช่วง ${range} ${beYear(parse(d.end).getFullYear())}`,
          formula: "% เทียบ = (ยอดช่วงนี้ − ยอดวันเดียวกันของเดือนก่อน) ÷ ยอดเดือนก่อน × 100",
          rows,
          notes,
        };
      }),
      kpi(
        "เฉลี่ยต่อวันทำการ",
        d.avg == null ? "—" : money(d.avg, 0),
        d.avg == null ? "ยังไม่มีวันทำการที่ปิดยอดแล้ว" : `${d.workingDays} วัน · ไม่รวมอาทิตย์และวันนี้`,
        "",
        d.avg == null ? "" : money(d.avg),
        () => ({
          title: "เฉลี่ยต่อวันทำการ",
          tag: "ยอดเอกสาร · วันทำการ",
          intro: "ยอดขายเฉลี่ยของวันทำการที่ปิดยอดแล้วในช่วงที่เลือก ใช้เป็นเกณฑ์ดูว่าแต่ละวันขายได้สูงหรือต่ำกว่าปกติ",
          formula: "ยอดรวมของวันทำการที่ปิดยอดแล้ว ÷ จำนวนวันทำการที่ปิดยอดแล้ว",
          rows: [
            ["ยอดรวมวันทำการที่ปิดยอดแล้ว", money(workSum)],
            ["จำนวนวันทำการ", `${d.workingDays} วัน`],
            ["ค่าเฉลี่ยต่อวัน", d.avg == null ? "—" : money(d.avg)],
            ["วันอาทิตย์ในช่วงนี้ (ไม่นับ)", `${sundays.length} วัน · ${money(sundays.reduce((a, i) => a + d.values[i], 0))}`],
          ],
          notes: [
            ["วันทำการคืออะไร", "วันจันทร์–เสาร์ วันอาทิตย์เป็นวันปิดทำการ (แถบสีเทาในกราฟ) จึงไม่นำมาคิดค่าเฉลี่ย ถ้ามียอดวันอาทิตย์ ยอดนั้นยังรวมอยู่ในยอดขายของช่วงนี้"],
            ["ทำไมไม่นับวันนี้", "วันนี้ยังขายอยู่ ยอดยังไม่ครบวัน ถ้านับจะทำให้ค่าเฉลี่ยต่ำกว่าความจริง"],
            ["ดูในกราฟ", "เส้นประในกราฟรายวันคือค่าเฉลี่ยนี้ ชี้ที่แต่ละวันเพื่อดูว่าสูงหรือต่ำกว่าค่าเฉลี่ยกี่ %"],
          ],
        }),
      ),
      kpi(
        "วันที่ขายดีที่สุด",
        best ? money(d.values[d.best], 0) : "—",
        best ? dayName(d.days[d.best]) : "ยังไม่มียอดขาย",
        "",
        best ? money(d.values[d.best]) : "",
        best
          ? () => {
              const top = d.days
                .map((_, i) => i)
                .filter((i) => d.values[i] > 0)
                .sort((a, b) => d.values[b] - d.values[a])
                .slice(0, 3);
              const rows = top.map((i, k) => [`อันดับ ${k + 1} · ${dayName(d.days[i])}`, money(d.values[i])]);
              if (d.avg) rows.push(["สูงกว่าค่าเฉลี่ยวันทำการ", pctText(pct(d.values[d.best], d.avg))]);
              return {
                title: "วันที่ขายดีที่สุด",
                tag: "ยอดเอกสาร · รายวัน",
                intro: `วันที่มียอดเอกสารขายรวมสูงสุดในช่วง ${range}`,
                formula: "เรียงยอดขายรายวันจากมากไปน้อย แล้วเลือกวันแรก",
                rows,
                notes: [
                  ["นับวันไหนบ้าง", "ทุกวันในช่วงที่เลือก รวมวันอาทิตย์และวันนี้"],
                  ["ใช้ตัวเลขนี้อย่างไร", "ถ้าวันเดียวสูงกว่าวันอื่นมาก มักมาจากบิลใหญ่หรือโปรโมชัน ควรเปิดดูบิลของวันนั้นก่อนสรุป"],
                  NOT_NET,
                ],
              };
            }
          : null,
      ),
      kpi(
        "วันต่ำกว่าค่าเฉลี่ย",
        d.below == null ? "—" : `${d.below} วัน`,
        d.below == null ? "ยังไม่มีค่าเฉลี่ย" : `จาก ${d.workingDays} วันทำการ`,
        d.below ? "down" : "",
        "",
        d.below == null
          ? null
          : () => {
              const rows = below.slice(0, 10).map((i) => [dayName(d.days[i]), `${money(d.values[i], 0)} (${pctText(pct(d.values[i], d.avg))})`]);
              if (below.length > 10) rows.push(["และอีก", `${below.length - 10} วัน`]);
              return {
                title: "วันต่ำกว่าค่าเฉลี่ย",
                tag: "ยอดเอกสาร · วันทำการ",
                intro: `จำนวนวันทำการที่ยอดขายต่ำกว่าค่าเฉลี่ย ${money(d.avg)} ต่อวัน`,
                formula: "นับวันทำการที่ปิดยอดแล้ว ซึ่งยอดขายของวันนั้นน้อยกว่าเฉลี่ยต่อวันทำการ",
                rows,
                notes: [
                  ["อ่านค่านี้อย่างไร", "ค่าเฉลี่ยมักถูกดึงขึ้นด้วยวันที่มีบิลใหญ่ไม่กี่วัน วันต่ำกว่าเฉลี่ยจึงมักมีเกินครึ่ง ถ้ามากเกือบทุกวัน แปลว่ายอดกระจุกอยู่ไม่กี่วัน"],
                  ["ไม่นับวันไหน", "วันอาทิตย์ (ปิดทำการ) และวันนี้ (ยังไม่ปิดยอด)"],
                ],
              };
            },
      ),
    ];
  }
  function monthlyKpis(m) {
    const s = monthlyStats(m, state.prevYear),
      be = beYear(s.year),
      { year: cy, month: cm } = now(),
      span = s.range === 1 ? MONTHS[0] : `ม.ค.–${MONTHS[s.range - 1]}`,
      canCompare = s.pvals && s.range,
      sa = canCompare ? sumTo(s.vals, s.range) : 0,
      sb = canCompare ? sumTo(s.pvals, s.range) : 0,
      c = canCompare ? pct(sa, sb) : null,
      advance = s.year === cy ? s.vals.map((v, i) => i).filter((i) => i + 1 > cm && s.vals[i] !== 0) : [],
      none = "ยังไม่มีเดือนที่ปิดแล้ว",
      ranked = (dir) => [...s.closedIdx].sort((a, b) => dir * (s.vals[b] - s.vals[a])).slice(0, 3);
    const sub = !canCompare ? "ไม่มีข้อมูลปีก่อนให้เทียบ" : c == null ? `ปี ${beYear(s.year - 1)} ไม่มียอดช่วง ${span}` : `${pctText(c)} เทียบ ${span} ${beYear(s.year - 1)}`;
    const rankTopic = (title, dir, word) => () => ({
      title,
      tag: `ปี ${be} · เดือนที่ปิดแล้ว`,
      intro: `เดือนที่ยอดเอกสารขายรวม${word}ที่สุดของปี ${be} เลือกจากเดือนที่ปิดแล้วเท่านั้น`,
      formula: `เรียงยอดรายเดือนของเดือนที่ปิดแล้ว แล้วเลือกเดือนที่ยอด${word}ที่สุด`,
      rows: [
        ...ranked(dir).map((i, k) => [`อันดับ ${k + 1} · ${MONTHS[i]} ${be}`, money(s.vals[i])]),
        ["ค่าเฉลี่ยต่อเดือน", money(s.avg)],
      ],
      notes: [
        ["นับเดือนไหนบ้าง", "เฉพาะเดือนที่จบแล้วและมียอด เดือนปัจจุบันยังไม่ครบเดือนจึงไม่นำมาจัดอันดับ"],
        ["ใช้ตัวเลขนี้อย่างไร", "เทียบกับค่าเฉลี่ยต่อเดือน และชี้ที่แท่งในกราฟเพื่อดู % เทียบเดือนเดียวกันของปีก่อน"],
        NOT_NET,
      ],
    });
    return [
      kpi(`ยอดรวมปี ${be}`, money(s.total, 0), sub, tone(c), money(s.total), () => {
        const rows = [[`รวมทั้งปี ${be}`, money(s.total)]];
        if (advance.length) rows.push([`ในนั้นเป็นยอดลงวันที่ล่วงหน้า (${advance.map((i) => MONTHS[i]).join(", ")})`, money(advance.reduce((a, i) => a + s.vals[i], 0))]);
        if (canCompare) rows.push([`${span} ${be}`, money(sa)], [`${span} ${beYear(s.year - 1)}`, money(sb)], ["ส่วนต่าง", signedMoney(sa - sb) + (c == null ? "" : ` (${pctText(c)})`)]);
        return {
          title: `ยอดรวมปี ${be}`,
          tag: "รายงาน 4007 · ก่อนหักรับคืน",
          intro: `รวมยอดเงินระดับเอกสารขายทุกเดือนของปี ${be} รวมเอกสารที่ลงวันที่ล่วงหน้า`,
          formula: "% เทียบ = (ยอดช่วงเดือนเดียวกันปีนี้ − ปีก่อน) ÷ ปีก่อน × 100",
          rows,
          notes: [
            ["เทียบช่วงไหน", canCompare ? `เทียบเฉพาะ ${span} ของทั้งสองปี ไม่ได้เทียบกับยอดทั้งปีของปีก่อน` : "ปีก่อนไม่มีข้อมูล จึงยังไม่มี % เทียบ"],
            ["เดือนปัจจุบัน", "เดือนนี้ยังไม่ครบเดือน (แท่งลายทแยงในกราฟ) ยอดเทียบจึงยังเพิ่มได้จนสิ้นเดือน"],
            ["ยอดลงวันที่ล่วงหน้า", "เอกสารที่ลงวันที่เดือนถัดไปรวมอยู่ในยอดทั้งปี แต่ไม่นำไปเทียบกับปีก่อน"],
            NOT_NET,
          ],
        };
      }),
      kpi(
        "เฉลี่ยต่อเดือน",
        s.avg == null ? "—" : money(s.avg, 0),
        s.avg == null ? none : `จาก ${s.closedCount} เดือนที่ปิดแล้ว`,
        "",
        s.avg == null ? "" : money(s.avg),
        s.avg == null
          ? null
          : () => ({
              title: "เฉลี่ยต่อเดือน",
              tag: `ปี ${be} · เดือนที่ปิดแล้ว`,
              intro: `ยอดขายเฉลี่ยต่อเดือนของปี ${be} คิดจากเดือนที่จบแล้วเท่านั้น`,
              formula: "ยอดรวมของเดือนที่ปิดแล้ว ÷ จำนวนเดือนที่ปิดแล้ว",
              rows: [
                [`ยอดรวม ${s.closedCount} เดือนที่ปิดแล้ว`, money(s.closedIdx.reduce((a, i) => a + s.vals[i], 0))],
                ["เดือนที่นับ", s.closedIdx.map((i) => MONTHS[i]).join(", ")],
                ["ค่าเฉลี่ยต่อเดือน", money(s.avg)],
              ],
              notes: [
                ["เดือนที่ปิดแล้ว", "เดือนที่จบไปแล้วทั้งเดือน ปีปัจจุบันจึงไม่นับเดือนนี้และเดือนที่มียอดล่วงหน้า"],
                ["เดือนที่ไม่มียอด", "ไม่นำมาคิด เพราะอาจเป็นช่วงที่ยังไม่มีข้อมูลในระบบ"],
                ["ดูในกราฟ", "เส้นประในกราฟรายเดือนคือค่าเฉลี่ยนี้"],
              ],
            }),
      ),
      ...[
        ["เดือนที่ขายดีที่สุด", s.best, 1, "สูง"],
        ["เดือนที่ขายน้อยที่สุด", s.worst, -1, "ต่ำ"],
      ].map(([label, i, dir, word]) =>
        kpi(label, i == null ? "—" : money(s.vals[i], 0), i == null ? none : `${MONTHS[i]} ${be}`, "", i == null ? "" : money(s.vals[i]), i == null ? null : rankTopic(label, dir, word)),
      ),
    ];
  }
  function renderKpis() {
    const box = $("trend-kpis"),
      daily = state.mode === "daily",
      data = daily ? state.daily : state.monthly;
    if (data) return box.replaceChildren(...(daily ? dailyKpis(data) : monthlyKpis(data)));
    const blank = (daily ? state.dailyError : state.monthlyError) ? "—" : "…",
      labels = daily
        ? ["ยอดขายเดือนนี้", "เฉลี่ยต่อวันทำการ", "วันที่ขายดีที่สุด", "วันต่ำกว่าค่าเฉลี่ย"]
        : ["ยอดรวมปี", "เฉลี่ยต่อเดือน", "เดือนที่ขายดีที่สุด", "เดือนที่ขายน้อยที่สุด"];
    box.replaceChildren(...labels.map((l) => kpi(l, blank)));
  }

  // ---------- daily line ----------
  function renderDaily(animateIt = false) {
    const box = $("daily-trend-wrap"),
      svg = $("daily-chart");
    if (box.hidden) return;
    hiders.daily?.();
    const f = frame(box, svg, { left: 62, bottom: 32, tall: true });
    if (!f) return;
    const { W, H, b } = f,
      d = state.daily;
    if (!d || !d.days.length) {
      placeholder(svg, W, H, !d ? state.dailyError || "กำลังโหลดข้อมูล…" : "ไม่มีข้อมูลในช่วงที่เลือก");
      svg.setAttribute("aria-label", "กราฟเส้นยอดขายรายวัน · ยังไม่มีข้อมูล");
      return;
    }
    const n = d.days.length,
      step = n > 1 ? b.w / (n - 1) : 0,
      X = (i) => r1(n > 1 ? b.l + i * step : b.l + b.w / 2),
      scale = niceScale(Math.max(...d.values, d.avg || 0), 8),
      Y = (v) => r1(b.t + b.h - (Math.max(0, v) / scale.top) * b.h),
      { today } = now(),
      sunday = (i) => parse(d.days[i]).getDay() === 0,
      id = `tg${++uid}`,
      defs = svgEl("defs", {}, svg),
      grad = svgEl("linearGradient", { id: id + "a", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svgEl("stop", { offset: "0%", "stop-color": RED, "stop-opacity": 0.35 }, grad);
    svgEl("stop", { offset: "100%", "stop-color": RED, "stop-opacity": 0 }, grad);
    const clipRect = svgEl("rect", { x: b.l - 8, y: 0, width: 0, height: H }, svgEl("clipPath", { id: id + "c" }, defs));
    // Sundays: grey band = closed.
    const band = n > 1 ? step : Math.min(48, b.w),
      bands = svgEl("g", { class: "tg-sundays" }, svg);
    d.days.forEach((s, i) => {
      if (!sunday(i)) return;
      const x0 = Math.max(b.l, X(i) - band / 2),
        x1 = Math.min(b.l + b.w, X(i) + band / 2);
      svgEl("rect", { x: r1(x0), y: b.t, width: r1(Math.max(2, x1 - x0)), height: b.h, class: "tg-sunday" }, bands);
    });
    yAxis(svg, b, scale);
    // Straight segments between days; a dot on every day (grey on Sundays).
    const pts = d.values.map((v, i) => [X(i), Y(v)]),
      line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(""),
      g = svgEl("g", { "clip-path": `url(#${id}c)` }, svg);
    if (n > 1) svgEl("path", { d: `${line}L${X(n - 1)},${b.t + b.h}L${X(0)},${b.t + b.h}Z`, fill: `url(#${id}a)`, class: "tg-area" }, g);
    svgEl("path", { d: line, class: "tg-line" }, g);
    const radius = step && step < 9 ? 2.5 : 4;
    pts.forEach(([x, y], i) => svgEl("circle", { cx: x, cy: y, r: radius, class: sunday(i) ? "tg-point sunday" : "tg-point" }, g));
    if (d.avg != null) avgMarker(svg, b, Y(d.avg), "เฉลี่ย " + short(d.avg));
    // X labels: "d MMM" spaced by the available width so they never collide.
    const xg = svgEl("g", { class: "tg-xaxis" }, svg),
      every = Math.ceil(n / Math.max(2, Math.floor(b.w / 62)));
    for (let i = 0; i < n; i += every) {
      const s = parse(d.days[i]);
      svgEl("text", { x: X(i), y: b.t + b.h + 22, "text-anchor": "middle", class: "tg-tick" }, xg).textContent = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
    }
    const cross = svgEl("line", { class: "tg-cross", y1: b.t, y2: b.t + b.h, visibility: "hidden" }, svg),
      dot = svgEl("circle", { class: "tg-dot", r: 6, visibility: "hidden" }, svg),
      hit = svgEl("rect", { x: b.l - Math.max(step / 2, 8), y: b.t, width: b.w + Math.max(step, 16), height: b.h, class: "tg-hit" }, svg);
    const show = (i) => {
      const x = X(i),
        y = Y(d.values[i]),
        s = parse(d.days[i]),
        rows = [tipTitle(`${WEEKDAYS[s.getDay()]} ${s.getDate()} ${MONTHS[s.getMonth()]} ${beYear(s.getFullYear())}`), tipValue(money(d.values[i]))];
      for (const node of [cross, dot]) node.setAttribute("visibility", "visible");
      cross.setAttribute("x1", x);
      cross.setAttribute("x2", x);
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
      dot.classList.toggle("sunday", sunday(i));
      if (sunday(i)) rows.push(tipNote("ปิดทำการ", "closed"));
      else if (d.days[i] > today) rows.push(tipNote("ยังไม่ถึงวันนี้"));
      else if (d.avg != null) {
        const c = pct(d.values[i], d.avg);
        rows.push(tipNote(`${pctText(c)} จากค่าเฉลี่ย`, tone(c)));
      }
      if (d.days[i] === today) rows.push(tipNote("วันนี้ · ยังไม่ปิดยอด"));
      showTip(box, x * (box.clientWidth / W), y, rows);
    };
    const set = interactive(box, "daily", n, show, () => {
      for (const node of [cross, dot]) node.setAttribute("visibility", "hidden");
      tipOf(box).hidden = true;
    });
    const indexAt = (e) => {
      const r = svg.getBoundingClientRect(),
        px = ((e.clientX - r.left) * W) / r.width;
      return n > 1 ? clamp(Math.round((px - b.l) / step), 0, n - 1) : 0;
    };
    hit.addEventListener("pointermove", (e) => set(indexAt(e)));
    hit.addEventListener("pointerdown", (e) => set(indexAt(e)));
    hit.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") set(null);
    });
    svg.setAttribute(
      "aria-label",
      `กราฟเส้นยอดขายรายวัน ${rangeLabel(d.start, d.end)} รวม ${money(d.total)}` +
        (d.avg != null ? ` เฉลี่ยวันทำการ ${money(d.avg)}` : "") +
        " · ใช้ลูกศรซ้ายขวาเพื่อดูรายวัน",
    );
    animate("daily", 1300, (p) => clipRect.setAttribute("width", r1((b.w + 16) * p)), animateIt);
  }

  // ---------- monthly bars ----------
  function barDefs(svg, id, from, to) {
    const defs = svgEl("defs", {}, svg),
      grad = svgEl("linearGradient", { id: id + "g", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svgEl("stop", { offset: "0%", "stop-color": from }, grad);
    svgEl("stop", { offset: "100%", "stop-color": to }, grad);
    const hatch = svgEl("pattern", { id: id + "h", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    svgEl("rect", { width: 6, height: 6, fill: RED_DEEP, "fill-opacity": 0.35 }, hatch);
    svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: RED, "stroke-width": 3 }, hatch);
    return defs;
  }
  function renderMonthly(animateIt = false) {
    const box = $("monthly-trend-wrap"),
      svg = $("monthly-chart");
    if (box.hidden) return;
    hiders.monthly?.();
    const f = frame(box, svg);
    if (!f) return;
    const { W, H, b } = f;
    if (!state.monthly) {
      placeholder(svg, W, H, state.monthlyError ? "โหลดยอดขายรายเดือนไม่สำเร็จ" : "กำลังโหลดยอดขายรายเดือน…");
      return;
    }
    const s = monthlyStats(state.monthly, state.prevYear),
      step = b.w / 12,
      bw = Math.min(40, step * 0.58),
      cx = (i) => b.l + step * (i + 0.5),
      scale = niceScale(Math.max(...s.vals, s.avg || 0)),
      base = b.t + b.h,
      hgt = (v) => (Math.max(0, v) / scale.top) * b.h,
      id = `tg${++uid}`;
    barDefs(svg, id, RED, RED_DEEP);
    const hl = svgEl("rect", { class: "tg-col-hl", y: b.t, height: b.h, width: r1(step), visibility: "hidden" }, svg);
    yAxis(svg, b, scale);
    const bars = [],
      bg = svgEl("g", { class: "tg-bars" }, svg);
    s.vals.forEach((v, i) => {
      if (v === 0) return; // no data → no bar
      const current = s.isCurrent(i),
        path = svgEl("path", { fill: current ? `url(#${id}h)` : `url(#${id}g)`, class: current ? "tg-bar current" : "tg-bar" }, bg);
      bars.push({ i, v, path });
    });
    const withData = bars.map((x) => x.i),
      line = svgEl("polyline", { class: "tg-mline" }, svg),
      dots = withData.map(() => svgEl("circle", { r: 3.5, class: "tg-mdot" }, svg));
    if (s.avg != null) avgMarker(svg, b, base - hgt(s.avg), "เฉลี่ย " + short(s.avg));
    monthAxis(svg, b, cx);
    const show = (i) => {
      hl.setAttribute("x", r1(b.l + step * i));
      hl.setAttribute("visibility", "visible");
      const v = s.vals[i],
        rows = [tipTitle(`${MONTHS[i]} ${beYear(s.year)}`)];
      if (v === 0) rows.push(tipNote(s.isFuture(i) ? "ยังไม่ถึงเดือนนี้" : "ไม่มีข้อมูล"));
      else {
        rows.push(tipValue(money(v)));
        const pv = s.pvals?.[i],
          c = pv ? pct(v, pv) : null;
        rows.push(tipNote(c == null ? `ไม่มียอด ${MONTHS[i]} ${beYear(s.year - 1)}` : `${pctText(c)} เทียบ ${MONTHS[i]} ${beYear(s.year - 1)}`, tone(c)));
        if (s.isCurrent(i)) rows.push(tipNote("เดือนปัจจุบัน · ยังไม่ครบเดือน"));
        else if (s.isFuture(i)) rows.push(tipNote("ยอดเอกสารลงวันที่ล่วงหน้า"));
      }
      showTip(box, cx(i) * (box.clientWidth / W), base - hgt(Math.max(v, 0)), rows);
    };
    const set = interactive(box, "monthly", 12, show, () => {
      hl.setAttribute("visibility", "hidden");
      tipOf(box).hidden = true;
    });
    for (let i = 0; i < 12; i++) {
      const hit = svgEl("rect", { x: r1(b.l + step * i), y: b.t, width: r1(step), height: b.h + 24, class: "tg-hit" }, svg);
      hit.addEventListener("pointerenter", () => set(i));
      hit.addEventListener("pointerdown", () => set(i));
      hit.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") set(null);
      });
    }
    svg.setAttribute(
      "aria-label",
      `กราฟยอดขายรายเดือน ปี ${beYear(s.year)}: ` +
        s.vals.map((v, i) => `${MONTHS[i]} ${v ? money(v) : s.isFuture(i) ? "ยังไม่ถึงเดือนนี้" : "ไม่มีข้อมูล"}`).join(", "),
    );
    animate(
      "monthly",
      900,
      (p) => {
        for (const x of bars) {
          const h = hgt(x.v) * p;
          x.path.setAttribute("d", barPath(r1(cx(x.i) - bw / 2), r1(base - h), r1(bw), r1(h)));
        }
        const pts = withData.map((i) => [r1(cx(i)), r1(base - hgt(s.vals[i]) * p)]);
        line.setAttribute("points", pts.map((q) => q.join(",")).join(" "));
        pts.forEach((q, k) => {
          dots[k].setAttribute("cx", q[0]);
          dots[k].setAttribute("cy", q[1]);
        });
        line.style.opacity = dots.length ? Math.min(1, p * 1.4) : 0;
        dots.forEach((dt) => (dt.style.opacity = line.style.opacity));
      },
      animateIt,
    );
  }

  // ---------- data loading ----------
  let version = 0,
    controller;
  async function fetchJSON(url, signal) {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "โหลดข้อมูลไม่สำเร็จ");
    return j;
  }
  async function loadYears(signal) {
    if (!state.years) state.years = (await fetchJSON("/api/sales-trend/years", signal)).years;
    return state.years;
  }
  function fillYearSelect(select, years, preferred) {
    select.replaceChildren(...years.map((y) => new Option(String(beYear(y)), String(y))));
    select.value = String(years.includes(preferred) ? preferred : years[0]);
  }
  async function loadMonthly(silent = false) {
    silent = silent === true;
    const id = ++version;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal,
      status = $("monthly-status"),
      retry = $("monthly-retry"),
      select = $("trend-year");
    if (!silent) {
      state.monthly = null;
      state.monthlyError = false;
      state.prevYear = null;
      renderMonthly();
      renderKpis();
      status.textContent = "กำลังโหลดยอดขายรายเดือน…";
    }
    status.hidden = false;
    status.classList.remove("error");
    retry.hidden = true;
    try {
      const years = await loadYears(signal);
      if (id !== version) return;
      if (!years.length) {
        select.disabled = true;
        status.textContent = "ยังไม่มีข้อมูลยอดขาย";
        return;
      }
      if (!select.options.length) fillYearSelect(select, years, now().year);
      select.disabled = false;
      const year = Number(select.value),
        [main, prev] = await Promise.all([
          fetchJSON(`/api/sales-trend?year=${year}`, signal),
          year > 1900 ? fetchJSON(`/api/sales-trend?year=${year - 1}`, signal).catch(() => null) : null,
        ]);
      if (id !== version) return;
      const changed =
        !state.monthly || state.monthly.year !== main.year || JSON.stringify(state.monthly.months) !== JSON.stringify(main.months);
      state.monthly = main;
      state.prevYear = prev;
      state.monthlyError = false;
      if (!silent || changed) renderMonthly(!silent);
      renderKpis();
      const total = main.months.reduce((a, r) => a + (Number(r.sales) || 0), 0);
      status.textContent = `รวมปี ${beYear(year)}: ${money(total)} · อัปเดต ${new Date(main.updatedAt).toLocaleTimeString("th-TH", { hour12: false })}`;
    } catch {
      if (id !== version) return;
      status.textContent = "โหลดยอดขายรายเดือนไม่สำเร็จ กรุณาลองใหม่";
      status.classList.add("error");
      retry.hidden = false;
      if (silent && state.monthly) return;
      state.monthly = null;
      state.monthlyError = true;
      renderMonthly();
      renderKpis();
    }
  }
  async function loadPrevDaily(d) {
    if ((parse(d.end) - parse(d.start)) / 864e5 > 30) {
      state.prev = { skip: true };
      return renderKpis();
    }
    const start = shiftMonth(d.start, -1),
      end = shiftMonth(d.end, -1),
      key = start + end;
    if (state.prev?.key === key && (state.prev.total != null || state.prev.loading)) return renderKpis();
    state.prev = { key, start, end, loading: true };
    renderKpis();
    try {
      const j = await fetchJSON(`/api/sales-trend/daily?${new URLSearchParams({ start, end })}`, new AbortController().signal);
      if (state.prev?.key !== key) return;
      state.prev = { key, start, end, total: j.daily.reduce((a, x) => a + (Number(x.sales) || 0), 0) };
    } catch {
      if (state.prev?.key === key) state.prev = { key, start, end, error: true };
    }
    renderKpis();
  }

  // ---------- mode switch ----------
  const TEXT = {
    daily: ["แนวโน้มยอดขายรายวัน", "Daily sales trend · by document date, before returns", "ยอดขายรวมตามวันที่เอกสาร ก่อนหักรับคืน"],
    monthly: ["แนวโน้มยอดขายรายเดือน", "Monthly sales trend · bars and line show the same sales", "ยอดขายตามเดือนของเอกสาร รวมวันที่ล่วงหน้า · ยังไม่หักรับคืน · แท่งลายทแยง = เดือนปัจจุบัน ยังไม่ครบเดือน · เส้นประ = เฉลี่ยเดือนที่ปิดแล้ว"],
  };
  function setMode(mode) {
    state.mode = mode;
    const monthly = mode === "monthly";
    document.querySelectorAll("[data-trend-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.trendMode === mode)));
    $("daily-trend-wrap").hidden = monthly;
    $("daily-legend").hidden = monthly;
    $("monthly-trend-wrap").hidden = !monthly;
    $("trend-year-label").hidden = !monthly;
    $("monthly-status").hidden = !monthly;
    $("monthly-retry").hidden = true;
    [$("trend-title").textContent, $("trend-subtitle").textContent, $("trend-note").textContent] = TEXT[mode];
    renderKpis();
    if (monthly) loadMonthly();
    else {
      ++version;
      controller?.abort();
      renderDaily(true);
    }
  }
  document.querySelectorAll("[data-trend-mode]").forEach((b) => b.addEventListener("click", () => state.mode !== b.dataset.trendMode && setMode(b.dataset.trendMode)));
  $("trend-year").addEventListener("change", () => loadMonthly());
  $("monthly-retry").addEventListener("click", () => loadMonthly());
  setInterval(() => {
    if (state.mode === "monthly" && !document.hidden) loadMonthly(true);
  }, 60000);

  // ---------- year-over-year comparison ----------
  const cmp = { root: null, data: null, version: 0, controller: null };
  function buildCompare() {
    const root = el("details", "trend-comparison");
    root.innerHTML =
      '<summary>เปรียบเทียบยอดขายรายปี</summary>' +
      '<div class="compare-fields"><label>ปีหลัก<select name="yearA"></select></label><span class="compare-vs" aria-hidden="true">VS</span><label>เทียบกับปี<select name="yearB"></select></label></div>' +
      '<p class="compare-status" role="status"></p><div class="compare-cards"></div>' +
      '<div class="compare-legend" aria-hidden="true"></div>' +
      '<div class="trend-plot" id="compare-plot" tabindex="0" hidden><svg id="compare-chart" role="img"></svg></div>' +
      '<p class="compare-note"></p>';
    $("trend-note").closest(".chart-note").after(root);
    cmp.root = root;
    const [a, bSel] = root.querySelectorAll("select");
    root.addEventListener("toggle", async () => {
      if (!root.open) return hiders.compare?.();
      if (a.options.length) return renderCompare(false);
      const status = root.querySelector(".compare-status");
      status.textContent = "กำลังโหลดปีที่มีข้อมูล…";
      try {
        const years = await loadYears(new AbortController().signal);
        if (years.length < 2) {
          status.textContent = "ต้องมีข้อมูลอย่างน้อย 2 ปีจึงจะเปรียบเทียบได้";
          return;
        }
        fillYearSelect(a, years, now().year);
        fillYearSelect(bSel, years, Number(a.value) - 1);
        if (bSel.value === a.value) bSel.value = String(years.find((y) => String(y) !== a.value));
        loadCompare();
      } catch {
        status.textContent = "โหลดปีไม่สำเร็จ ปิดแล้วเปิดส่วนนี้เพื่อลองใหม่";
      }
    });
    a.addEventListener("change", () => loadCompare());
    bSel.addEventListener("change", () => loadCompare());
    setInterval(() => {
      if (root.open && !document.hidden && cmp.data) loadCompare(true);
    }, 60000);
  }
  async function loadCompare(silent = false) {
    const root = cmp.root,
      [a, bSel] = root.querySelectorAll("select"),
      status = root.querySelector(".compare-status"),
      yearA = Number(a.value),
      yearB = Number(bSel.value),
      id = ++cmp.version;
    cmp.controller?.abort();
    cmp.controller = new AbortController();
    if (yearA === yearB) {
      cmp.data = null;
      status.textContent = "กรุณาเลือกคนละปีเพื่อเปรียบเทียบ";
      root.querySelector(".compare-cards").replaceChildren();
      root.querySelector(".compare-legend").replaceChildren();
      root.querySelector(".compare-note").textContent = "";
      $("compare-plot").hidden = true;
      return;
    }
    if (!silent) status.textContent = "กำลังโหลดข้อมูลเปรียบเทียบ…";
    try {
      const [A, B] = await Promise.all([yearA, yearB].map((y) => fetchJSON(`/api/sales-trend?year=${y}`, cmp.controller.signal)));
      if (id !== cmp.version) return;
      const changed = !cmp.data || JSON.stringify([cmp.data.A, cmp.data.B]) !== JSON.stringify([A, B].map((x) => x.months));
      cmp.data = {
        yearA,
        yearB,
        A: A.months.map((r) => Number(r.sales) || 0),
        B: B.months.map((r) => Number(r.sales) || 0),
      };
      status.textContent = "";
      renderCompareSummary();
      $("compare-plot").hidden = false;
      if (!silent || changed) renderCompare(!silent);
    } catch {
      if (id === cmp.version && !silent) status.textContent = "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่";
    }
  }
  function renderCompareSummary() {
    const root = cmp.root,
      { yearA, yearB, A, B } = cmp.data,
      m = sameMonthRange(yearA, A, yearB, B),
      span = m ? (m === 1 ? MONTHS[0] : `ม.ค.–${MONTHS[m - 1]}`) : "",
      sa = sumTo(A, m),
      sb = sumTo(B, m),
      diff = sa - sb,
      c = pct(sa, sb),
      rangeNote = [
        "ทำไมเทียบเฉพาะช่วงนี้",
        `ปีปัจจุบันยังไม่จบปี ถ้าเทียบกับยอดทั้งปีของอีกปีจะดูเหมือนลดลงมากเกินจริง จึงเทียบเฉพาะ ${span || "เดือนเดียวกัน"} ของทั้งสองปี`,
      ],
      card = (label, value, sub, cls, explain) => {
        const x = el(explain ? "button" : "div", "compare-card " + cls);
        x.append(el("span", "", label), el("strong", "", value), el("small", "", sub));
        if (explain) {
          x.type = "button";
          x.setAttribute("aria-haspopup", "dialog");
          x.setAttribute("aria-label", `${label} ${value} ${sub} · กดเพื่อดูคำอธิบาย`);
          const info = el("i", "trend-kpi-info", "ⓘ");
          info.setAttribute("aria-hidden", "true");
          x.append(info);
          x.addEventListener("click", () => window.insightHelp?.show({ ...explain(), current: value }, x));
        }
        return x;
      },
      yearTopic = (year, v, sum, role) => () => {
        const outside = m < 12 ? sumTo(v, 12) - sum : 0,
          rows = [
            [`รวมทั้งปี ${beYear(year)}`, money(sumTo(v, 12))],
            [`${span} ${beYear(year)} (ช่วงที่ใช้เทียบ)`, money(sum)],
          ];
        if (m < 12) rows.push([`${MONTHS[m]}–ธ.ค. (ไม่นำมาเทียบ)`, money(outside)]);
        return {
          title: `${role} · ปี ${beYear(year)}`,
          tag: "รายงาน 4007 · ก่อนหักรับคืน",
          intro: `ยอดเงินระดับเอกสารขายของปี ${beYear(year)} ตามเดือนของวันที่เอกสาร ตัวเลขใหญ่คือยอดทั้งปี ตัวเลขเล็กคือยอดช่วงที่ใช้เทียบ`,
          formula: `ยอดช่วงเทียบ = ผลรวมยอดขาย ${span || "—"} ของปี ${beYear(year)}`,
          rows,
          notes: [
            rangeNote,
            ["ยอดทั้งปีกับยอดช่วงเทียบต่างกันอย่างไร", m < 12 ? `ยอดทั้งปีรวมทุกเดือนที่มีข้อมูล รวมเอกสารที่ลงวันที่ล่วงหน้า ส่วนยอดช่วงเทียบนับเฉพาะ ${span}` : "ช่วงเทียบครอบคลุมทั้ง 12 เดือน จึงเท่ากับยอดทั้งปี"],
            NOT_NET,
          ],
        };
      };
    root.querySelector(".compare-cards").replaceChildren(
      card(`ปีหลัก · ${beYear(yearA)}`, money(sumTo(A, 12), 0), m ? `${span}: ${money(sa, 0)}` : "ยังไม่มีข้อมูล", "main", m ? yearTopic(yearA, A, sa, "ปีหลัก") : null),
      card(`ปีเทียบ · ${beYear(yearB)}`, money(sumTo(B, 12), 0), m ? `${span}: ${money(sb, 0)}` : "ยังไม่มีข้อมูล", "other", m ? yearTopic(yearB, B, sb, "ปีเทียบ") : null),
      card(
        m ? `ส่วนต่าง ${span}` : "ส่วนต่าง",
        m ? `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff), 0)}` : "—",
        !m ? "ไม่มีช่วงเดือนที่เทียบได้" : c == null ? `ปี ${beYear(yearB)} ไม่มียอดช่วงนี้` : pctText(c),
        "diff " + (m ? tone(c ?? diff) : ""),
        m
          ? () => {
              const months = Array.from({ length: m }, (_, i) => i)
                .sort((i, j) => Math.abs(A[j] - B[j]) - Math.abs(A[i] - B[i]))
                .slice(0, 3);
              return {
                title: `ส่วนต่าง ${span}`,
                tag: `ปี ${beYear(yearA)} เทียบ ${beYear(yearB)}`,
                intro: `ยอดขาย ${span} ของปี ${beYear(yearA)} ต่างจากช่วงเดียวกันของปี ${beYear(yearB)} เท่าไร`,
                formula: `ส่วนต่าง = ยอด ${span} ปี ${beYear(yearA)} − ปี ${beYear(yearB)} · % = ส่วนต่าง ÷ ยอดปี ${beYear(yearB)} × 100`,
                rows: [
                  [`${span} ปี ${beYear(yearA)}`, money(sa)],
                  [`${span} ปี ${beYear(yearB)}`, money(sb)],
                  ["ส่วนต่าง", signedMoney(diff) + (c == null ? "" : ` (${pctText(c)})`)],
                  ...months.map((i) => [`เดือนที่ต่างมาก · ${MONTHS[i]}`, `${signedMoney(A[i] - B[i])}${pct(A[i], B[i]) == null ? "" : ` (${pctText(pct(A[i], B[i]))})`}`]),
                ],
                notes: [
                  rangeNote,
                  ["ค่าบวก / ค่าลบ", `ค่าบวก (สีเขียว) แปลว่าปี ${beYear(yearA)} ขายได้มากกว่า ค่าลบ (สีแดง) แปลว่าขายได้น้อยกว่าในช่วงเดียวกัน`],
                  ["เดือนที่ยังไม่จบ", "ถ้าช่วงเทียบรวมเดือนปัจจุบัน ยอดของเดือนนี้ยังเพิ่มได้จนสิ้นเดือน ส่วนต่างจึงอาจเปลี่ยน"],
                  ["ดูรายเดือน", "ชี้ที่คู่แท่งในกราฟด้านล่างเพื่อดูยอดและ % ส่วนต่างของแต่ละเดือน"],
                ],
              };
            }
          : null,
      ),
    );
    const legend = root.querySelector(".compare-legend");
    legend.replaceChildren();
    for (const [cls, y] of [
      ["main", yearA],
      ["other", yearB],
    ]) {
      const item = el("span", cls);
      item.append(el("i"), `ปี ${beYear(y)}`);
      legend.append(item);
    }
    root.querySelector(".compare-note").textContent =
      `ยอดขายตามเอกสาร ก่อนหักรับคืน · ส่วนต่างเทียบเฉพาะ ${span || "เดือนเดียวกัน"} ของทั้งสองปี · เดือนที่ยังไม่จบเป็นยอดบางส่วน`;
  }
  function renderCompare(animateIt = false) {
    const box = $("compare-plot"),
      svg = $("compare-chart");
    if (!cmp.data || box.hidden || !cmp.root.open) return;
    hiders.compare?.();
    const f = frame(box, svg);
    if (!f) return;
    const { W, b } = f,
      { yearA, yearB, A, B } = cmp.data,
      step = b.w / 12,
      bw = Math.max(3, Math.min(16, step * 0.3)),
      cx = (i) => b.l + step * (i + 0.5),
      scale = niceScale(Math.max(...A, ...B)),
      base = b.t + b.h,
      hgt = (v) => (Math.max(0, v) / scale.top) * b.h,
      id = `tg${++uid}`;
    barDefs(svg, id, RED, RED_DEEP);
    const hl = svgEl("rect", { class: "tg-col-hl", y: b.t, height: b.h, width: r1(step), visibility: "hidden" }, svg);
    yAxis(svg, b, scale);
    const bars = [];
    for (let i = 0; i < 12; i++) {
      if (A[i]) bars.push({ v: A[i], x: cx(i) - bw - 1, path: svgEl("path", { fill: `url(#${id}g)`, class: "tg-bar" }, svg) });
      if (B[i]) bars.push({ v: B[i], x: cx(i) + 1, path: svgEl("path", { fill: GREY, class: "tg-bar other" }, svg) });
    }
    monthAxis(svg, b, cx);
    const show = (i) => {
      hl.setAttribute("x", r1(b.l + step * i));
      hl.setAttribute("visibility", "visible");
      const c = pct(A[i], B[i]),
        rows = [
          tipTitle(MONTHS[i]),
          tipSeries(RED, `ปี ${beYear(yearA)}`, A[i] ? money(A[i]) : "ไม่มีข้อมูล"),
          tipSeries(GREY, `ปี ${beYear(yearB)}`, B[i] ? money(B[i]) : "ไม่มีข้อมูล"),
          tipNote(c == null ? "เทียบไม่ได้ (ปีเทียบไม่มียอด)" : `ส่วนต่าง ${pctText(c)}`, tone(c)),
        ];
      showTip(box, cx(i) * (box.clientWidth / W), base - hgt(Math.max(A[i], B[i])), rows);
    };
    const set = interactive(box, "compare", 12, show, () => {
      hl.setAttribute("visibility", "hidden");
      tipOf(box).hidden = true;
    });
    for (let i = 0; i < 12; i++) {
      const hit = svgEl("rect", { x: r1(b.l + step * i), y: b.t, width: r1(step), height: b.h + 24, class: "tg-hit" }, svg);
      hit.addEventListener("pointerenter", () => set(i));
      hit.addEventListener("pointerdown", () => set(i));
      hit.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") set(null);
      });
    }
    svg.setAttribute("aria-label", `กราฟเปรียบเทียบยอดขายรายเดือน ปี ${beYear(yearA)} กับ ${beYear(yearB)}`);
    animate(
      "compare",
      900,
      (p) => {
        for (const x of bars) {
          const h = hgt(x.v) * p;
          x.path.setAttribute("d", barPath(r1(x.x), r1(base - h), r1(bw), r1(h), 3));
        }
      },
      animateIt,
    );
  }
  buildCompare();

  // ---------- redraw on resize / theme ----------
  const redraw = {
    "daily-trend-wrap": () => renderDaily(false),
    "monthly-trend-wrap": () => renderMonthly(false),
    "compare-plot": () => renderCompare(false),
  };
  const observer = new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = Math.floor(e.contentRect.width);
      if (!w || widths[e.target.id] === w) continue;
      widths[e.target.id] = w;
      requestAnimationFrame(() => redraw[e.target.id]());
    }
  });
  Object.keys(redraw).forEach((idKey) => observer.observe($(idKey)));
  window.addEventListener("dashboard-theme-change", () => Object.values(redraw).forEach((fn) => fn()));

  // ---------- API used by app.js and tests ----------
  window.salesTrend = {
    setDaily(raw, silent = false) {
      const next = prepDaily(raw),
        old = state.daily,
        changed = !old || old.start !== next.start || old.end !== next.end || JSON.stringify(old.values) !== JSON.stringify(next.values);
      state.daily = next;
      state.dailyError = "";
      if (state.mode === "daily" && (!silent || changed)) renderDaily(!silent);
      renderKpis();
      loadPrevDaily(next);
    },
    clearDaily(message = "ยังไม่มีข้อมูลล่าสุด") {
      state.daily = null;
      state.dailyError = message;
      state.prev = null;
      renderDaily(false);
      renderKpis();
    },
    debug: () => ({
      mode: state.mode,
      daily: state.daily && { days: state.daily.days, values: state.daily.values, avg: state.daily.avg },
      monthly:
        state.monthly &&
        (() => {
          const s = monthlyStats(state.monthly, state.prevYear);
          return { year: s.year, values: s.vals.map((v, i) => (s.isFuture(i) && v === 0 ? null : v)), bars: s.vals.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), avg: s.avg };
        })(),
      compare: cmp.data,
    }),
  };
  renderKpis();
  renderDaily(false);
})();
