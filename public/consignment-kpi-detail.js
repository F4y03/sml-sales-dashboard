// Detail window for the 4 consignment KPI cards. Display only: every figure arrives ready-made from
// kpiData() in consignment-ui.js (same filtered list and formulas as the cards). Text goes in as
// textContent, never HTML. Each open resets and replays the count-up, ring fill and bar animations.
import { detailThumb } from "./consignment-images.js?v=20260929-icons";

const fmt = (n) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(n);
const pct = (n) =>
  new Intl.NumberFormat("th-TH", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(n);
const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const DURATION = 1000,
  STAGGER = 60,
  RING_R = 34,
  RING_C = 2 * Math.PI * RING_R;

const ICONS = {
  products:
    '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10"/>',
  stock:
    '<path d="M4 7h16v13H4zM4 7l2-4h12l2 4M9 12h6"/>',
  flow: '<path d="M7 17V5m0 0-3 3m3-3 3 3M17 7v12m0 0 3-3m-3 3-3-3"/>',
  recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const SUBTITLES = {
  products: "จำนวนรหัสสินค้าที่ตรงคำค้นหาและตัวกรอง",
  stock: "รหัสที่ยังมียอดคงเหลือมากกว่า 0",
  flow: "เบิกออกสะสม เทียบคงเหลือล่าสุด",
  recent: "วันที่ทำรายการล่าสุดของสินค้าที่เลือก",
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// ---------- dialog shell ----------
const dialog = el("dialog", "kd");
dialog.id = "kpi-detail";
dialog.setAttribute("aria-labelledby", "kpi-detail-title");
const header = el("header", "kd-head"),
  icon = el("span", "kd-icon"),
  headText = el("div", "kd-head-text"),
  title = el("h2", "kd-title"),
  subtitle = el("p", "kd-subtitle"),
  closeButton = el("button", "kd-close", "×");
title.id = "kpi-detail-title";
icon.setAttribute("aria-hidden", "true");
closeButton.type = "button";
closeButton.setAttribute("aria-label", "ปิดรายละเอียด");
headText.append(title, subtitle);
header.append(icon, headText, closeButton);
const body = el("div", "kd-body");
dialog.append(header, body);
document.body.append(dialog);
closeButton.onclick = () => dialog.close();
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
let playToken = 0;
dialog.addEventListener("close", () => playToken++);

// ---------- animation helpers ----------
const ease = (t) => 1 - (1 - t) ** 3;
// Queued until the dialog is shown, then played together.
let pending = [];
function countUp(node, target, { format = fmt, delay = 0 } = {}) {
  node.textContent = format(reducedMotion() ? target : 0);
  if (reducedMotion() || !Number.isFinite(target)) return;
  pending.push((token) => {
    const start = performance.now() + delay,
      whole = Number.isInteger(target);
    const step = (now) => {
      if (token !== playToken) return;
      const t = Math.min(1, Math.max(0, (now - start) / DURATION)),
        v = target * ease(t);
      node.textContent = format(whole ? Math.round(v) : v);
      if (t < 1) requestAnimationFrame(step);
      else node.textContent = format(target);
    };
    requestAnimationFrame(step);
  });
}
// Width set to 0 now, to its share after the dialog paints (CSS transitions the change).
function grow(fill, share, delay = 0) {
  const width = Math.max(0, Math.min(1, share)) * 100 + "%";
  if (reducedMotion()) {
    fill.style.width = width;
    return;
  }
  fill.style.width = "0%";
  fill.style.transitionDelay = delay + "ms";
  pending.push(() => (fill.style.width = width));
}

// ---------- building blocks ----------
function ring(share, tone) {
  const svgNS = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(svgNS, "svg"),
    track = document.createElementNS(svgNS, "circle"),
    bar = document.createElementNS(svgNS, "circle");
  svg.setAttribute("viewBox", "0 0 80 80");
  svg.setAttribute("class", "kd-ring-svg");
  svg.setAttribute("aria-hidden", "true");
  for (const c of [track, bar]) {
    c.setAttribute("cx", "40");
    c.setAttribute("cy", "40");
    c.setAttribute("r", String(RING_R));
  }
  track.setAttribute("class", "kd-ring-track");
  bar.setAttribute("class", "kd-ring-bar kd-tone-" + tone);
  bar.style.strokeDasharray = String(RING_C);
  const offset = RING_C * (1 - Math.max(0, Math.min(1, share)));
  if (reducedMotion()) bar.style.strokeDashoffset = String(offset);
  else {
    bar.style.strokeDashoffset = String(RING_C);
    pending.push(() => (bar.style.strokeDashoffset = String(offset)));
  }
  svg.append(track, bar);
  return svg;
}
function hero({ label, value, format, unit, lines = [], share, shareText, tone = "red" }) {
  const box = el("section", "kd-hero"),
    left = el("div", "kd-hero-main");
  left.append(el("span", "kd-hero-label", label));
  const number = el("p", "kd-hero-value"),
    strong = el("strong");
  if (typeof value === "number") countUp(strong, value, { format });
  else strong.textContent = value;
  number.append(strong);
  if (unit) number.append(el("small", "", unit));
  left.append(number);
  for (const line of lines) left.append(line);
  box.append(left);
  if (share != null) {
    const wrap = el("div", "kd-ring");
    wrap.append(ring(share, tone));
    const center = el("span", "kd-ring-text");
    if (shareText != null) center.textContent = shareText;
    else countUp(center, Math.max(0, share), { format: pct });
    wrap.append(center);
    box.append(wrap);
  }
  return box;
}
const section = (heading) => {
  const box = el("section", "kd-section");
  box.append(el("h3", "kd-section-title", heading));
  return box;
};
function note(text, tone = "info") {
  const box = el("p", "kd-note kd-note-" + tone);
  box.append(el("span", "kd-note-icon", tone === "info" ? "💡" : "⚠"), el("span", "", text));
  return box;
}
function emptyState() {
  return el("p", "kd-empty", "ไม่พบสินค้าที่ตรงกับตัวกรอง");
}

// ---------- per-card content ----------
function renderProducts(k) {
  const out = [
    hero({
      label: "สินค้าที่แสดง",
      value: k.count,
      unit: "รหัส",
      lines: [el("span", "kd-hero-sub", `จากทั้งหมด ${fmt(k.total)} รหัส`)],
      share: k.share,
    }),
  ];
  if (k.empty) return [...out, emptyState()];
  const box = section("แยกตามภูมิภาค"),
    max = Math.max(1, ...k.regions.map((r) => r.value));
  k.regions.forEach((r, i) => {
    const row = el("div", "kd-row"),
      top = el("div", "kd-row-top"),
      value = el("strong");
    countUp(value, r.value, { delay: i * STAGGER });
    top.append(el("span", "", r.label), value);
    const bar = el("span", "kd-bar"),
      fill = el("i", r.unknown ? "kd-fill-muted" : "kd-fill-red");
    grow(fill, r.value / max, i * STAGGER);
    bar.append(fill);
    row.append(top, bar);
    box.append(row);
  });
  return [...out, box];
}
function renderStock(k) {
  const sub = el("span", "kd-hero-sub");
  sub.append("หมดแล้ว (= 0) ", el("b", "kd-red", fmt(k.zero)), " รหัส");
  const lines = [sub];
  if (k.negative) lines.push(el("span", "kd-hero-sub kd-amber", `คงเหลือติดลบ ${fmt(k.negative)} รหัส`));
  const out = [
    hero({ label: "มีสินค้าคงเหลือ (> 0)", value: k.inStock, unit: "รหัส", lines, share: k.share, tone: "green" }),
  ];
  if (k.empty) return [...out, emptyState()];
  const box = section("แยกตามภูมิภาค"),
    legend = el("div", "kd-legend");
  legend.append(el("span", "kd-key kd-key-green", "มีของ"), el("span", "kd-key kd-key-red", "หมดแล้ว"));
  box.append(legend);
  k.regions.forEach((r, i) => {
    const row = el("div", "kd-row"),
      top = el("div", "kd-row-top"),
      value = el("span", "kd-row-pair"),
      a = el("strong", "kd-green"),
      b = el("strong", "kd-red");
    countUp(a, r.inStock, { delay: i * STAGGER });
    countUp(b, r.zero, { delay: i * STAGGER });
    value.append(a, " / ", b);
    top.append(el("span", "", r.label), value);
    const total = r.inStock + r.zero,
      bar = el("span", "kd-bar kd-bar-split"),
      good = el("i", "kd-fill-green"),
      bad = el("i", "kd-fill-red");
    grow(good, total ? r.inStock / total : 0, i * STAGGER);
    grow(bad, total ? r.zero / total : 0, i * STAGGER);
    bar.append(good, bad);
    row.append(top, bar);
    box.append(row);
  });
  return [...out, box];
}
function renderFlow(k) {
  const unit = k.oneUnit ? " " + k.oneUnit : "";
  const out = [
    hero({
      label: "เบิกออกสะสม",
      value: k.outSum,
      unit: k.oneUnit,
      lines: [el("span", "kd-hero-sub", "วงแหวน = อัตราคงเหลือ")],
      share: k.ratio == null ? 0 : Math.min(1, k.ratio),
      shareText: k.ratio == null ? "–" : pct(k.ratio),
      tone: "green",
    }),
  ];
  const stats = el("div", "kd-stats");
  for (const [label, value, format] of [
    ["คงเหลือล่าสุด", k.balanceSum, (n) => fmt(n) + unit],
    ["อัตราคงเหลือ", k.ratio, pct],
    ["จำนวนหน่วย", k.units.length, fmt],
  ]) {
    const cell = el("div", "kd-stat"),
      strong = el("strong");
    if (value == null) strong.textContent = "–";
    else countUp(strong, value, { format });
    cell.append(el("span", "", label), strong);
    stats.append(cell);
  }
  out.push(stats);
  if (k.empty) return [...out, emptyState()];
  if (k.units.length > 1)
    out.push(note(`ยอดรวมปน ${fmt(k.units.length)} หน่วย · ดูตารางแยกหน่วยด้านล่าง`, "warn"));
  const box = section("แยกตามหน่วย"),
    legend = el("div", "kd-legend"),
    max = Math.max(1, ...k.units.flatMap((u) => [u.out, u.balance]));
  legend.append(el("span", "kd-key kd-key-red", "เบิกออก"), el("span", "kd-key kd-key-green", "คงเหลือ"));
  box.append(legend);
  k.units.forEach((u, i) => {
    const row = el("div", "kd-row"),
      top = el("div", "kd-row-top"),
      name = el("span");
    name.append(el("b", "", u.unit), el("small", "kd-muted", ` · ${fmt(u.count)} รหัส`));
    const value = el("span", "kd-row-pair"),
      a = el("strong", "kd-red"),
      b = el("strong", "kd-green");
    countUp(a, u.out, { delay: i * STAGGER });
    countUp(b, u.balance, { delay: i * STAGGER });
    value.append(a, " / ", b);
    top.append(name, value);
    const bars = el("div", "kd-bars");
    for (const [v, cls] of [[u.out, "kd-fill-red"], [u.balance, "kd-fill-green"]]) {
      const bar = el("span", "kd-bar kd-bar-thin"),
        fill = el("i", cls);
      grow(fill, v / max, i * STAGGER);
      bar.append(fill);
      bars.append(bar);
    }
    row.append(top, bars);
    box.append(row);
  });
  return [...out, box];
}
function renderRecent(k) {
  const out = [
    hero({
      label: "เคลื่อนไหวล่าสุด",
      value: k.lastDate,
      lines: k.ago ? [el("span", "kd-hero-sub", k.ago)] : [],
    }),
  ];
  if (k.empty) return [...out, emptyState()];
  const warn = el("p", "kd-note " + (k.stale ? "kd-note-warn" : "kd-note-ok")),
    text = el("span"),
    count = el("b");
  countUp(count, k.stale);
  text.append(count, ` รหัสไม่เคลื่อนไหวเกิน ${fmt(k.staleDays)} วัน`);
  if (k.stale) text.append(" · อาจเป็นสินค้าค้างสต็อก ควรตรวจสอบ");
  warn.append(el("span", "kd-note-icon", k.stale ? "⚠" : "✓"), text);
  out.push(warn);
  const box = section("5 รหัสที่เคลื่อนไหวล่าสุด"),
    list = el("ul", "kd-list");
  k.recent.forEach(({ product: p, date }, i) => {
    const item = el("li", "kd-item");
    item.style.setProperty("--d", i * STAGGER + "ms");
    const copy = el("div", "kd-item-copy"),
      value = el("div", "kd-item-value");
    copy.append(el("strong", "", p.product), el("small", "", `${p.code} · ${date}`));
    value.append(el("strong", "", fmt(p.balance)), el("small", "", p.unit));
    item.append(detailThumb(p), copy, value);
    list.append(item);
  });
  box.append(list);
  return [...out, box];
}
const RENDER = { products: renderProducts, stock: renderStock, flow: renderFlow, recent: renderRecent };

export function showKpiDetail(key, kpi, [heading, , example]) {
  playToken++;
  pending = [];
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[key]}</svg>`;
  title.textContent = heading;
  subtitle.textContent = SUBTITLES[key];
  const chip = el("p", "kd-chip");
  chip.append(el("span", "kd-chip-dot"), "ข้อมูลตอนนี้ · " + (kpi.filtered ? "ตามตัวกรองที่เลือก" : "ไม่ได้กรอง"));
  if (kpi.filterSummary) chip.title = kpi.filterSummary;
  const parts = [chip];
  if (kpi.filterSummary) parts.push(el("p", "kd-filters", kpi.filterSummary));
  parts.push(...RENDER[key](kpi), note(example));
  body.replaceChildren(...parts);
  body.scrollTop = 0;
  dialog.classList.toggle("kd-no-motion", reducedMotion());
  if (!dialog.open) dialog.showModal();
  const token = playToken,
    jobs = pending;
  pending = [];
  // Two frames: the 0-state paints first, so the transitions have something to run from.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => token === playToken && jobs.forEach((job) => job(token))),
  );
}
