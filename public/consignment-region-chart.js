// "เบิกออกและคงเหลือ แยกตามภาค": paired horizontal bars per region, drawn as plain SVG.
const SVG_NS = "http://www.w3.org/2000/svg";
const OUT_FILL = "#ef3b2f",
  BALANCE_FILL = "#2fa3ad";
const qtyFormat = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const fmtQty = (n) => qtyFormat.format(n);
let regionArgs = { products: [], unit: "", loaded: false },
  regionRows = [],
  regionUnitText = "",
  regionAnimated = false,
  regionStopAnimation = null,
  regionWidth = 0;

const svgNode = (tag, attrs = {}, host) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (host) host.append(node);
  return node;
};
const htmlNode = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Text measurement for label widths (region names are truncated with "…" to fit).
const measureCanvas = document.createElement("canvas").getContext("2d");
function textWidth(text, font) {
  measureCanvas.font = font;
  return measureCanvas.measureText(text).width;
}
function fitText(text, maxWidth, font) {
  if (textWidth(text, font) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(cut + "…", font) > maxWidth) cut = cut.slice(0, -1);
  return cut.trimEnd() + "…";
}

// Round tick step (1 / 2 / 2.5 / 5 × 10ⁿ, e.g. every 50,000) for about `parts` divisions.
function roundStep(range, parts) {
  const raw = range / parts,
    mag = 10 ** Math.floor(Math.log10(raw)),
    f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

export function renderRegionalChart(products, unit, loaded) {
  regionArgs = { products, unit, loaded };
  const groups = new Map();
  for (const p of products) {
    if (!groups.has(p.region)) groups.set(p.region, { out: 0, balance: 0 });
    const g = groups.get(p.region);
    g.out += p.out;
    g.balance += p.balance;
  }
  regionRows = [...groups].sort((a, b) => b[1].out - a[1].out).map(([region, g]) => ({ region, ...g }));
  const units = new Set(products.map((p) => p.unit));
  regionUnitText = unit || (units.size === 1 ? [...units][0] : "รวมจำนวนต่างหน่วย");
  document.getElementById("regional-note").textContent = !loaded
    ? "กำลังรอข้อมูลจาก SML"
    : !products.length
      ? "ไม่พบข้อมูลที่ตรงตัวกรอง"
      : `หน่วย: ${regionUnitText}` + (units.size > 1 ? " · เลือกตัวกรองหน่วยด้านบนเพื่อเปรียบเทียบหน่วยเดียวกัน" : "");
  renderRegionTable();
  // Bars grow in once, when the first data arrives; later filter changes redraw instantly.
  const animate = loaded && regionRows.length > 0 && !regionAnimated;
  if (animate) regionAnimated = true;
  drawRegionChart(animate);
}

function renderRegionTable() {
  const body = document.getElementById("regional-values"),
    foot = document.getElementById("regional-total");
  body.replaceChildren();
  foot.replaceChildren();
  const row = (cells, header = false) => {
    const tr = document.createElement("tr");
    cells.forEach((text, i) => tr.append(htmlNode(header && i === 0 ? "th" : "td", "", text)));
    return tr;
  };
  for (const r of regionRows) body.append(row([r.region, fmtQty(r.out), fmtQty(r.balance)]));
  if (regionRows.length)
    foot.append(
      row(
        ["รวม", fmtQty(regionRows.reduce((a, r) => a + r.out, 0)), fmtQty(regionRows.reduce((a, r) => a + r.balance, 0))],
        true,
      ),
    );
}

function drawRegionChart(animate = false) {
  const plot = document.getElementById("regional-plot"),
    svg = document.getElementById("regional-chart"),
    tip = document.getElementById("regional-tip"),
    W = Math.floor(plot.clientWidth);
  regionWidth = W;
  regionStopAnimation?.();
  regionStopAnimation = null;
  tip.hidden = true;
  svg.replaceChildren();
  if (!W) return;
  const family = getComputedStyle(plot).fontFamily,
    nameFont = `600 13px ${family}`,
    valueFont = `700 12px ${family}`,
    tickFont = `700 13px ${family}`;
  if (!regionArgs.loaded || !regionRows.length) {
    const H = 120;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svgNode("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "rg-empty" }, svg).textContent = !regionArgs.loaded
      ? "กำลังรอข้อมูลจาก SML"
      : "ไม่พบข้อมูลที่ตรงตัวกรอง";
    plot.onkeydown = null;
    return;
  }
  const narrow = W < 520,
    nameMax = narrow ? Math.min(96, W * 0.28) : Math.min(170, W * 0.24),
    nameWidth = Math.min(nameMax, Math.max(...regionRows.map((r) => textWidth(r.region, nameFont)))),
    values = regionRows.flatMap((r) => [r.out, r.balance]),
    valueWidth = Math.max(...values.map((v) => textWidth(fmtQty(v), valueFont))),
    left = Math.ceil(nameWidth) + 16,
    right = Math.ceil(valueWidth) + 14,
    plotW = Math.max(60, W - left - right);
  // Axis: round steps, fewer of them on narrow screens so the numbers never touch.
  let lo = Math.min(0, ...values),
    hi = Math.max(0, ...values);
  if (lo === hi) hi = lo + 1;
  const tickLabel = textWidth(fmtQty(Math.max(Math.abs(lo), Math.abs(hi))), tickFont) + 22,
    parts = clampNum(Math.floor(plotW / tickLabel), 2, 6),
    step = roundStep(hi - lo, parts),
    dLo = Math.floor(lo / step) * step,
    dHi = Math.ceil(hi / step) * step,
    X = (v) => left + ((v - dLo) / (dHi - dLo)) * plotW,
    rowH = 52,
    barH = 16,
    barGap = 4,
    padTop = 6,
    H = padTop + regionRows.length * rowH + 30;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  const plotBottom = padTop + regionRows.length * rowH,
    highlight = svgNode("rect", { class: "rg-row-hl", x: 0, width: W, height: rowH, visibility: "hidden", rx: 8 }, svg),
    grid = svgNode("g", { class: "rg-grid" }, svg);
  for (let v = dLo; v <= dHi + step / 2; v += step) {
    const x = Math.round(X(v)) + 0.5;
    svgNode("line", { x1: x, x2: x, y1: padTop, y2: plotBottom, class: v === 0 ? "zero" : "" }, grid);
    svgNode("text", { x, y: plotBottom + 21, "text-anchor": "middle", class: "rg-tick" }, grid).textContent = fmtQty(v);
  }
  const bars = [];
  regionRows.forEach((r, i) => {
    const rowTop = padTop + i * rowH,
      barTop = rowTop + (rowH - (barH * 2 + barGap)) / 2,
      label = svgNode("text", { x: left - 12, y: rowTop + rowH / 2 + 4.5, "text-anchor": "end", class: "rg-name" }, svg);
    label.textContent = fitText(r.region, nameWidth, nameFont);
    if (label.textContent !== r.region) svgNode("title", {}, label).textContent = r.region;
    [
      ["out", r.out, barTop],
      ["balance", r.balance, barTop + barH + barGap],
    ].forEach(([kind, v, y]) => {
      const rect = svgNode("rect", { y, height: barH, rx: 3.5, fill: kind === "out" ? OUT_FILL : BALANCE_FILL, class: `rg-bar ${kind}` }, svg),
        text = svgNode("text", { y: y + barH / 2 + 4.2, class: `rg-value ${kind}` }, svg);
      text.textContent = fmtQty(v);
      bars.push({ v, rect, text });
    });
  });
  const place = (p) => {
    for (const { v, rect, text } of bars) {
      const end = X(v * p),
        zero = X(0),
        x0 = Math.min(zero, end),
        width = Math.abs(end - zero);
      rect.setAttribute("x", x0);
      rect.setAttribute("width", width > 0.5 ? width : 0);
      // Values sit after the bar end; negatives show to the right of the zero line so they never hit the names.
      text.setAttribute("x", v >= 0 ? end + 6 : zero + 6);
      text.style.opacity = p;
    }
  };
  // Hover / tap / keyboard: highlight the whole row and show the region's figures.
  let activeIndex = null;
  const show = (i) => {
    const r = regionRows[i],
      rowTop = padTop + i * rowH,
      share = r.out > 0 ? `${fmtQty((r.balance / r.out) * 100)}%` : "—";
    highlight.setAttribute("y", rowTop);
    highlight.setAttribute("visibility", "visible");
    tip.replaceChildren(htmlNode("strong", "rg-tip-title", r.region));
    for (const [cls, label, value] of [
      ["out", "เบิกออกสะสม", fmtQty(r.out)],
      ["balance", "คงเหลือล่าสุด", fmtQty(r.balance)],
      ["ratio", "คงเหลือ ÷ เบิกออก", share],
    ]) {
      const line = htmlNode("span", `rg-tip-row ${cls}`);
      line.append(htmlNode("i"), htmlNode("span", "", label), htmlNode("b", "", value));
      tip.append(line);
    }
    tip.append(htmlNode("small", "rg-tip-unit", `หน่วย: ${regionUnitText}`));
    tip.hidden = false;
    const scale = plot.clientWidth / W,
      tw = tip.offsetWidth,
      th = tip.offsetHeight,
      anchorX = Math.max(...[r.out, r.balance].map((v) => X(Math.max(v, 0)))) * scale;
    let tx = anchorX + 16;
    if (tx + tw > plot.clientWidth - 4) tx = anchorX - tw - 16;
    let ty = (rowTop + rowH / 2) * scale - th / 2;
    tx = clampNum(tx, 4, Math.max(4, plot.clientWidth - tw - 4));
    ty = clampNum(ty, 4, Math.max(4, plot.clientHeight - th - 4));
    tip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
    activeIndex = i;
  };
  const hide = () => {
    highlight.setAttribute("visibility", "hidden");
    tip.hidden = true;
    activeIndex = null;
  };
  regionRows.forEach((_, i) => {
    const hit = svgNode("rect", { x: 0, y: padTop + i * rowH, width: W, height: rowH, class: "rg-hit" }, svg);
    hit.addEventListener("pointerenter", (e) => e.pointerType !== "touch" && show(i));
    hit.addEventListener("pointerdown", () => show(i));
    hit.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && hide());
  });
  plot.onkeydown = (e) => {
    const last = regionRows.length - 1,
      next = { ArrowDown: (activeIndex ?? -1) + 1, ArrowUp: (activeIndex ?? last + 1) - 1, Home: 0, End: last }[e.key];
    if (e.key === "Escape") return hide();
    if (next == null) return;
    e.preventDefault();
    show(clampNum(next, 0, last));
  };
  plot.onblur = hide;
  svg.setAttribute(
    "aria-label",
    "กราฟเบิกออกและคงเหลือแยกตามภาค: " +
      regionRows.map((r) => `${r.region} เบิกออก ${fmtQty(r.out)} คงเหลือ ${fmtQty(r.balance)}`).join(", ") +
      ` (หน่วย: ${regionUnitText}) · ใช้ลูกศรขึ้นลงเพื่อดูรายภาค`,
  );
  if (!animate || reducedMotion()) return place(1);
  const began = performance.now();
  let frameId;
  const tick = (now) => {
    const t = Math.min(1, (now - began) / 850);
    place(1 - Math.pow(1 - t, 3));
    if (t < 1) frameId = requestAnimationFrame(tick);
  };
  place(0);
  frameId = requestAnimationFrame(tick);
  regionStopAnimation = () => cancelAnimationFrame(frameId);
}

document.addEventListener("pointerdown", (e) => {
  const plot = document.getElementById("regional-plot");
  if (plot && !plot.contains(e.target)) {
    document.getElementById("regional-tip").hidden = true;
    plot.querySelector(".rg-row-hl")?.setAttribute("visibility", "hidden");
  }
});
new ResizeObserver(() => {
  const plot = document.getElementById("regional-plot");
  if (plot && Math.floor(plot.clientWidth) !== regionWidth) requestAnimationFrame(() => drawRegionChart(false));
}).observe(document.getElementById("regional-plot"));
window.addEventListener("dashboard-theme-change", () => drawRegionChart(false));
