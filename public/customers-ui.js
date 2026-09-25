const el = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dates = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const money = (value) => `฿${currency.format(value)}`;
const dateLabel = (value) =>
  value ? dates.format(new Date(`${value}T12:00:00`)) : "ไม่มีบิลขายในช่วงนี้";
const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const palette = [
  "#ff3b30",
  "#ff8a7a",
  "#b3261e",
  "#9a9aa3",
  "#5f5f68",
  "#d9d9de",
  "#7a1a16",
];
const customerPageSize = 10;
const cbx = { query: "", cat: null, sort: "amount", colors: new Map(), searchTimer: 0, toastTimer: 0, hover: null };
let customers = [],
  filtered = [],
  selectedCode = null,
  detail = null,
  period = null;
let customerPage = 0,
  masterController,
  detailController,
  masterRequest = 0,
  detailRequest = 0;
let filterTimer,
  masterUpdatedAt,
  detailOpener,
  backdropPointerDown = false;
let activeInsightsView = "customers";
let nonBuyers = [],
  filteredNonBuyers = [],
  nonBuyerPage = 0,
  nonBuyerController,
  nonBuyerRequest = 0,
  nonBuyerTimer;
let nonBuyerSortDirection = "desc";
const nonBuyerSortHeader = document
  .querySelector("#non-buyer-rows")
  ?.closest("table")
  ?.querySelector("thead th:last-child");
if (nonBuyerSortHeader) {
  const button = document.createElement("button"),
    icon = document.createElement("span");
  button.type = "button";
  button.className = "customer-sort";
  icon.className = "customer-sort-icon";
  icon.textContent = "↕";
  icon.setAttribute("aria-hidden", "true");
  button.append(document.createTextNode(nonBuyerSortHeader.textContent), icon);
  nonBuyerSortHeader.replaceChildren(button);
  nonBuyerSortHeader.setAttribute("aria-sort", "none");
  button.onclick = () => {
    nonBuyerSortDirection = nonBuyerSortDirection === "asc" ? "desc" : "asc";
    applyNonBuyerSearch();
  };
}
function updateNonBuyerSortHeader() {
  if (!nonBuyerSortHeader) return;
  nonBuyerSortHeader.setAttribute(
    "aria-sort",
    nonBuyerSortDirection === "asc" ? "ascending" : "descending",
  );
  nonBuyerSortHeader.querySelector(".customer-sort-icon").textContent =
    nonBuyerSortDirection === "asc" ? "▲" : "▼";
}

function renderNonBuyers() {
  const body = el("non-buyer-rows");
  body.replaceChildren();
  nonBuyerPage = Math.min(
    nonBuyerPage,
    Math.max(0, Math.ceil(filteredNonBuyers.length / customerPageSize) - 1),
  );
  for (const customer of filteredNonBuyers.slice(
    nonBuyerPage * customerPageSize,
    (nonBuyerPage + 1) * customerPageSize,
  )) {
    const row = node("tr");
    const lastPurchased = customer.lastPurchased
      ? dateLabel(customer.lastPurchased)
      : "ไม่เคยมีบิลขาย";
    const days = Number.isInteger(customer.daysSincePurchase)
      ? `${number.format(customer.daysSincePurchase)} วัน`
      : "—";
    row.append(
      node("td", customer.code),
      node("td", customer.name),
      node("td", lastPurchased),
      node("td", days, "numeric"),
    );
    body.append(row);
  }
  if (!filteredNonBuyers.length)
    emptyRow(body, 4, "ไม่พบลูกค้าที่ไม่ได้ซื้อตามเงื่อนไขที่เลือก");
  el("non-buyer-count").textContent =
    `${number.format(filteredNonBuyers.length)} ราย`;
  pagination(
    "non-buyer",
    nonBuyerPage,
    customerPageSize,
    filteredNonBuyers.length,
    "ราย",
  );
}

function validateNonBuyerDates() {
  const start = el("non-buyer-start"),
    end = el("non-buyer-end");
  end.setCustomValidity("");
  if (
    start.value &&
    end.value &&
    (start.value > end.value ||
      (Date.parse(end.value) - Date.parse(start.value)) / 86400000 > 365)
  ) {
    end.setCustomValidity(
      "กรุณาเลือกวันสิ้นสุดตั้งแต่วันเริ่มต้น และช่วงเวลาไม่เกิน 366 วัน",
    );
  }
  return el("non-buyer-filters").checkValidity();
}

function syncNonBuyerPeriodToMaster() {
  el("non-buyer-start").value = el("start").value;
  el("non-buyer-end").value = el("end").value;
}

function applyNonBuyerSearch() {
  const query = el("non-buyer-search").value.trim().toLocaleLowerCase("th-TH");
  filteredNonBuyers = nonBuyers.filter((customer) =>
    `${customer.code}\n${customer.name}`
      .toLocaleLowerCase("th-TH")
      .includes(query),
  );
  filteredNonBuyers.sort((a, b) => {
    const av = Number.isInteger(a.daysSincePurchase) ? a.daysSincePurchase : -1;
    const bv = Number.isInteger(b.daysSincePurchase) ? b.daysSincePurchase : -1;
    return (
      (nonBuyerSortDirection === "asc" ? av - bv : bv - av) ||
      String(a.code).localeCompare(String(b.code))
    );
  });
  updateNonBuyerSortHeader();
  nonBuyerPage = 0;
  renderNonBuyers();
}

async function loadNonBuyers() {
  if (window.prplusAccess && !window.prplusAccess.customer) return;
  clearTimeout(nonBuyerTimer);
  if (!validateNonBuyerDates()) {
    el("non-buyer-status").textContent =
      "กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน";
    return;
  }
  nonBuyerController?.abort();
  const request = ++nonBuyerRequest,
    controller = new AbortController();
  nonBuyerController = controller;
  const selectedPeriod = {
    start: el("non-buyer-start").value,
    end: el("non-buyer-end").value,
  };
  el("non-buyer-refresh").disabled = true;
  el("non-buyer-status").textContent = "กำลังโหลดรายชื่อลูกค้าที่ไม่ได้ซื้อ…";
  try {
    const data = await requestJSON(
      `/api/customer-insights/non-buyers?${new URLSearchParams(selectedPeriod)}`,
      controller.signal,
    );
    if (request !== nonBuyerRequest) return;
    nonBuyers = data.nonBuyers;
    applyNonBuyerSearch();
    el("non-buyer-status").textContent =
      `${dateLabel(selectedPeriod.start)} – ${dateLabel(selectedPeriod.end)} · พบ ${number.format(nonBuyers.length)} ราย`;
  } catch (error) {
    if (controller.signal.aborted || request !== nonBuyerRequest) return;
    el("non-buyer-status").textContent =
      error.message === "Failed to fetch"
        ? "เชื่อมต่อ SML ไม่สำเร็จ กรุณาลองใหม่"
        : error.message;
  } finally {
    if (request === nonBuyerRequest) {
      nonBuyerController = null;
      el("non-buyer-refresh").disabled = false;
    }
  }
}

function productViewEvent(type, silent = false) {
  document.dispatchEvent(
    new CustomEvent(type, {
      detail: {
        silent,
        view: activeInsightsView,
        start: el("start").value,
        end: el("end").value,
        valid: validateDates(),
      },
    }),
  );
}

function switchInsightsView(view) {
  if (
    window.prplusAccess &&
    !(view === "customers"
      ? window.prplusAccess.customer
      : window.prplusAccess.product)
  )
    return;
  if (view === activeInsightsView) return;
  activeInsightsView = view;
  clearTimeout(filterTimer);
  invalidateMaster();
  el("customers-view-button").setAttribute(
    "aria-pressed",
    String(view === "customers"),
  );
  el("products-view-button").setAttribute(
    "aria-pressed",
    String(view === "products"),
  );
  el("customer-search").closest("label").hidden = view !== "customers";
  el("performance-search-field").hidden = view !== "products";
  el("status").hidden = view !== "customers";
  productViewEvent("insights-view-change");
  if (view === "customers") loadCustomers();
}

function node(tag, text = "", className = "") {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}

function message(text, error = false) {
  el("status").textContent = text;
  el("status").classList.toggle("error", error);
}

async function requestJSON(url, signal) {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    throw new Error(
      response.status === 404
        ? "ไม่พบ API ลูกค้า กรุณารีสตาร์ตเซิร์ฟเวอร์ Dashboard แล้วลองใหม่"
        : "เซิร์ฟเวอร์ส่งข้อมูลผิดรูปแบบ กรุณาเปิดหน้านี้ผ่านเซิร์ฟเวอร์ Dashboard แล้วลองใหม่",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(
      "ข้อมูลจากเซิร์ฟเวอร์ไม่สมบูรณ์ กรุณากดอัปเดตข้อมูลเพื่อลองใหม่",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่",
    );
  return data;
}

function clearDetail(
  text = "เลือกลูกค้าเพื่อดูรายการสินค้าและสัดส่วนหมวดหมู่",
) {
  detailController?.abort();
  detailController = null;
  detailRequest++;
  detail = null;
  cbx.query = "";
  cbx.cat = null;
  cbx.sort = "amount";
  el("cbx-search").value = "";
  syncSortButtons();
  el("detail-content").hidden = true;
  el("cbx-foot").hidden = true;
  el("detail-retry").hidden = true;
  el("detail-status").hidden = false;
  el("detail-status").textContent = text;
  el("customer-detail").setAttribute("aria-busy", "false");
  el("product-rows").replaceChildren();
  el("category-legend").replaceChildren();
  el("category-chart").replaceChildren();
}

function closeCustomerDetail() {
  const dialog = el("customer-detail");
  if (dialog.open) dialog.close();
  document.body.classList.remove("customer-dialog-open");
  backdropPointerDown = false;
  clearDetail();
  if (detailOpener?.isConnected) detailOpener.focus({ preventScroll: true });
  detailOpener = null;
}

function openCustomerDetail(code, trigger, revealInTable = false) {
  if (!period || !filtered.some((customer) => customer.code === code)) return;
  detailOpener = trigger;
  // Open immediately so loading and retry feedback stay inside the popup.
  selectCustomer(code, revealInTable);
  const dialog = el("customer-detail");
  if (!dialog.open) dialog.showModal();
  document.body.classList.add("customer-dialog-open");
  dialog.scrollTop = 0;
}

function updateSelectedHeading(customer) {
  el("detail-title").textContent = customer?.name || "ยังไม่ได้เลือกลูกค้า";
  el("detail-period").textContent = period
    ? `${shortDate(period.start)} – ${shortDate(period.end)}`
    : "";
  el("selected-code").hidden = !customer;
  el("selected-code").textContent = customer
    ? customer.code || "ไม่ระบุรหัสลูกค้า"
    : "";
}

const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function localDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  return match ? new Date(+match[1], +match[2] - 1, +match[3]) : null;
}
function shortDate(value) {
  const date = localDate(value);
  if (!date) return "—";
  return `${date.getDate()} ${thMonths[date.getMonth()]} ${String((date.getFullYear() + 543) % 100).padStart(2, "0")}`;
}
function daysAgo(value) {
  const date = localDate(value);
  if (!date) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - date) / 86400000);
}
const safeNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

function syncSortButtons() {
  for (const button of el("cbx-sort").querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.sort === cbx.sort));
}

function cbxToast(text) {
  const box = el("cbx-toast");
  box.textContent = text;
  box.hidden = false;
  box.classList.remove("is-shown");
  void box.offsetWidth;
  box.classList.add("is-shown");
  clearTimeout(cbx.toastTimer);
  cbx.toastTimer = setTimeout(() => {
    box.classList.remove("is-shown");
    box.hidden = true;
  }, 1800);
}
async function cbxCopy(text, label) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    cbxToast(`คัดลอก${label} ${text} แล้ว`);
  } catch {
    cbxToast("คัดลอกไม่สำเร็จ กรุณาคัดลอกเอง");
  }
}

function countUp(target, value, delay, format) {
  const end = safeNum(value);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    target.textContent = format(end);
    return;
  }
  target.textContent = format(0);
  const started = performance.now() + delay;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - started) / 700));
    target.textContent = format(t >= 1 ? end : end * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderSummary() {
  const customer = detail.customer;
  const bills = safeNum(customer.invoiceCount);
  const net = safeNum(customer.net);
  const lastDates = detail.products.map((p) => p.lastPurchased).filter(Boolean).sort();
  const catCount = new Set(detail.products.map((p) => p.category)).size;
  countUp(el("cbx-net"), net, 0, money);
  el("cbx-net-sub").textContent = `ตามเอกสารขาย · เฉลี่ย ${bills > 0 ? money(net / bills) : "฿0.00"} / บิล`;
  countUp(el("cbx-bills"), bills, 120, (v) => number.format(Math.round(v)));
  el("cbx-bills-sub").textContent = lastDates.length ? `ซื้อล่าสุด ${shortDate(lastDates.at(-1))}` : "ไม่มีบิลขายในช่วงนี้";
  countUp(el("cbx-items"), detail.products.length, 240, (v) => number.format(Math.round(v)));
  el("cbx-items-sub").textContent = `${number.format(catCount)} หมวดหมู่`;
}

function visibleProducts() {
  const query = cbx.query.trim().toLowerCase();
  const list = detail.products.filter(
    (p) =>
      (!cbx.cat || p.category === cbx.cat) &&
      (!query || `${p.name || ""} ${p.code || ""}`.toLowerCase().includes(query)),
  );
  const by = {
    amount: (a, b) => safeNum(b.total) - safeNum(a.total),
    qty: (a, b) => safeNum(b.quantity) - safeNum(a.quantity),
    recent: (a, b) => String(b.lastPurchased || "").localeCompare(String(a.lastPurchased || "")) || safeNum(b.total) - safeNum(a.total),
  };
  return list.sort(by[cbx.sort]);
}

function updateSelection() {
  document.querySelectorAll("[data-customer-code]").forEach((item) => {
    const selected = item.dataset.customerCode === selectedCode;
    if (item.tagName === "TR") item.classList.toggle("selected", selected);
    else item.setAttribute("aria-pressed", String(selected));
  });
}

function emptyRow(body, columns, text) {
  const row = node("tr"),
    cell = node("td", text, "empty-state empty-cell");
  cell.colSpan = columns;
  row.append(cell);
  body.append(row);
}

function renderChart() {
  const chart = el("customer-chart");
  chart.replaceChildren();
  const top = filtered.slice(0, 10);
  if (!top.length) {
    chart.append(
      node(
        "p",
        "ไม่พบลูกค้าตามเงื่อนไขที่เลือก\nลองเปลี่ยนช่วงวันที่หรือคำค้นหา",
        "empty-state",
      ),
    );
    return;
  }
  const positive = Math.max(0, ...top.map((customer) => customer.net));
  const negative = Math.max(0, ...top.map((customer) => -customer.net));
  const domain = positive + negative || 1;
  const zero = (negative / domain) * 100;
  top.forEach((customer, index) => {
    const button = node("button", "", "bar-row");
    button.type = "button";
    button.dataset.customerCode = customer.code;
    button.setAttribute("aria-controls", "customer-detail");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute(
      "aria-label",
      `${index + 1}. ${customer.name} (${customer.code || "ไม่ระบุรหัส"}) ยอดซื้อสุทธิ ${money(customer.net)} ดูรายการสินค้า`,
    );
    button.title = `${customer.name} · ${customer.code || "ไม่ระบุรหัส"} · ${money(customer.net)}`;
    const main = node("span", "", "bar-main"),
      track = node("span", "", "bar-track");
    const bar = node(
      "span",
      "",
      `bar-fill${customer.net < 0 ? " negative" : ""}`,
    );
    bar.style.left = `${customer.net < 0 ? zero - (Math.abs(customer.net) / domain) * 100 : zero}%`;
    bar.style.width = `${(Math.abs(customer.net) / domain) * 100}%`;
    if (customer.net === 0) bar.style.display = "none";
    track.setAttribute("aria-hidden", "true");
    track.append(bar);
    if (negative > 0) {
      const axis = node("span", "", "bar-axis");
      axis.style.left = `${Math.min(99.8, zero)}%`;
      track.append(axis);
    }
    main.append(node("span", customer.name, "bar-name"), track);
    button.append(
      node("span", String(index + 1).padStart(2, "0"), "bar-rank"),
      main,
      node(
        "span",
        money(customer.net),
        `bar-value${customer.net < 0 ? " negative" : ""}`,
      ),
    );
    button.addEventListener("click", () =>
      openCustomerDetail(customer.code, button, true),
    );
    chart.append(button);
  });
}

function pagination(prefix, page, size, count, unit) {
  el(`${prefix}-page-info`).textContent = count
    ? `${number.format(page * size + 1)}–${number.format(Math.min((page + 1) * size, count))} จาก ${number.format(count)} ${unit}`
    : `0 ${unit}`;
  el(`${prefix}-prev`).disabled = page === 0;
  el(`${prefix}-next`).disabled = (page + 1) * size >= count;
}

function renderCustomers() {
  const body = el("customer-rows");
  body.replaceChildren();
  filtered
    .slice(
      customerPage * customerPageSize,
      (customerPage + 1) * customerPageSize,
    )
    .forEach((customer) => {
      const row = node("tr"),
        nameCell = node("td"),
        button = node("button", customer.name, "customer-name");
      row.dataset.customerCode = customer.code;
      button.type = "button";
      button.dataset.customerCode = customer.code;
      button.title = customer.name;
      button.setAttribute("aria-controls", "customer-detail");
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute(
        "aria-label",
        `ดูรายการสินค้าของ ${customer.name} (${customer.code || "ไม่ระบุรหัส"})`,
      );
      nameCell.append(button);
      row.append(
        node("td", customer.code || "ไม่ระบุ"),
        nameCell,
        node("td", number.format(customer.invoiceCount), "numeric"),
        node(
          "td",
          money(customer.net),
          `numeric${customer.net < 0 ? " negative" : ""}`,
        ),
      );
      // A native button supports keyboard activation; the entire row also accepts clicks.
      row.addEventListener("click", () =>
        openCustomerDetail(customer.code, button),
      );
      body.append(row);
    });
  if (!filtered.length) emptyRow(body, 4, "ไม่พบลูกค้าตามเงื่อนไขที่เลือก");
  pagination(
    "customer",
    customerPage,
    customerPageSize,
    filtered.length,
    "ราย",
  );
  updateSelection();
}

function summarySvg(tag, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, value);
  element.textContent = text;
  return element;
}

// Animated summary ring: segments are shares out of 100 drawn with a small gap;
// hovering/focusing a segment thickens it, fades the rest and shows its details in the centre.
let animateSummary = false;
const RING_GAP = 0.9;
// focusable: false when the ring sits inside another control (e.g. a card button), so slices don't nest focus targets.
function summaryRing({ className, centerClass, box, r, ariaLabel, segments, center, animate, focusable = true }) {
  const ring = node(focusable ? "div" : "span", "", `${className} summary-ring`),
    mid = box / 2,
    svg = summarySvg(
      "svg",
      focusable
        ? { viewBox: `0 0 ${box} ${box}`, role: "group", "aria-label": ariaLabel }
        : { viewBox: `0 0 ${box} ${box}`, "aria-hidden": "true" },
    ),
    arcs = [];
  svg.append(summarySvg("circle", { cx: mid, cy: mid, r, class: "ring-track" }));
  let start = 0;
  segments.forEach((segment, index) => {
    const share = Math.max(0, segment.share),
      arc = summarySvg("circle", {
        cx: mid,
        cy: mid,
        r,
        pathLength: 100,
        stroke: segment.color,
        "stroke-dasharray": "0 100",
        "stroke-dashoffset": -start,
        transform: `rotate(-90 ${mid} ${mid})`,
        class: "ring-arc",
        ...(focusable ? { tabindex: 0, role: "img", "aria-label": segment.aria } : {}),
      });
    if (focusable) arc.append(summarySvg("title", {}, segment.aria));
    arcs.push({ arc, start, length: share > RING_GAP * 2 ? share - RING_GAP : share });
    start += share;
    svg.append(arc);
    for (const [type, active] of [
      ["pointerenter", true],
      ["pointerleave", false],
      ["focus", true],
      ["blur", false],
    ])
      arc.addEventListener(type, () => activate(active ? index : null));
  });
  const middle = node(focusable ? "div" : "span", "", centerClass),
    value = node("b"),
    label = node("span"),
    sub = node("small");
  middle.append(value, label, sub);
  ring.append(svg, middle);
  const showCenter = (v, l, s = "") => {
    value.textContent = v;
    label.textContent = l;
    sub.textContent = s;
    sub.hidden = !s;
  };
  function activate(index) {
    ring.querySelectorAll(".ring-arc.is-active").forEach((arc) => arc.classList.remove("is-active"));
    if (index == null || !segments[index]) {
      delete ring.dataset.active;
      showCenter(center.text(center.value), center.label);
    } else {
      ring.dataset.active = index;
      arcs[index].arc.classList.add("is-active");
      const s = segments[index];
      showCenter(s.value, s.label, s.sub);
    }
    ring.dispatchEvent(new CustomEvent("ring-activate", { detail: index }));
  }
  const paint = (progress) => {
    const sweep = progress * 100;
    for (const { arc, start: from, length } of arcs)
      arc.setAttribute(
        "stroke-dasharray",
        `${Math.max(0, Math.min(length, sweep - from))} 100`,
      );
  };
  const still = !animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) {
    paint(1);
    activate(null);
  } else {
    const began = performance.now(),
      ease = (t) => 1 - Math.pow(1 - t, 3);
    showCenter(center.text(0), center.label);
    const frame = (now) => {
      const t = Math.min(1, (now - began) / 1000),
        p = ease(t);
      paint(p);
      if (ring.dataset.active == null) showCenter(center.text(center.value * p), center.label);
      if (t < 1 && ring.isConnected !== false) requestAnimationFrame(frame);
    };
    paint(0);
    requestAnimationFrame(frame);
  }
  return { ring, activate };
}
function linkLegend(legend, activate) {
  [...legend.children].forEach((row, index) => {
    row.tabIndex = 0;
    row.addEventListener("pointerenter", () => activate(index));
    row.addEventListener("pointerleave", () => activate(null));
    row.addEventListener("focus", () => activate(index));
    row.addEventListener("blur", () => activate(null));
  });
}

function renderSummaryCharts() {
  const animate = animateSummary;
  animateSummary = false;
  const positive = filtered.reduce(
    (sum, item) => sum + Math.max(0, item.net),
    0,
  );
  const negative = filtered.reduce(
    (sum, item) => sum + Math.min(0, item.net),
    0,
  );
  const singles = filtered.filter((item) => item.invoiceCount === 1).length;
  const repeat = filtered.filter((item) => item.invoiceCount > 1).length;
  const invoices = filtered.reduce((sum, item) => sum + item.invoiceCount, 0);
  const topInvoices = [...filtered]
    .sort((a, b) => b.invoiceCount - a.invoiceCount)
    .slice(0, 5)
    .reduce((sum, item) => sum + item.invoiceCount, 0);
  const charts = [
    [
      "net-summary-chart",
      "องค์ประกอบยอดสุทธิ · รวมตามลูกค้า",
      [
        ["ลูกค้าที่มียอดสุทธิบวก", positive, money(positive)],
        ["ลูกค้าที่มียอดสุทธิติดลบ", negative, money(negative)],
        ["ยอดสุทธิรวม", positive + negative, money(positive + negative)],
      ],
    ],
    [
      "count-summary-chart",
      "แบ่งตามจำนวนบิลขายในช่วงที่เลือก",
      [
        ["มี 2 บิลขึ้นไป", repeat, `${number.format(repeat)} ราย`],
        ["มี 1 บิล", singles, `${number.format(singles)} ราย`],
        [
          "ไม่มีบิลขาย",
          filtered.length - singles - repeat,
          `${number.format(filtered.length - singles - repeat)} ราย`,
        ],
      ],
    ],
    [
      "invoice-summary-chart",
      "สัดส่วนบิล · จัดอันดับลูกค้าตามจำนวนบิล",
      [
        [
          "ลูกค้า 5 อันดับแรก",
          topInvoices,
          `${number.format(topInvoices)} บิล`,
        ],
        [
          "ลูกค้าที่เหลือ",
          invoices - topInvoices,
          `${number.format(invoices - topInvoices)} บิล`,
        ],
      ],
    ],
  ];
  for (const [id, caption, values] of charts) {
    const chart = el(id);
    chart.replaceChildren(node("p", caption, "summary-chart-caption"));
    if (!filtered.length) {
      chart.append(
        node("span", "ไม่มีข้อมูลตามเงื่อนไขที่เลือก", "summary-chart-empty"),
      );
      continue;
    }
    const netSummary = id === "net-summary-chart";
    const colors = netSummary
      ? ["#e8b0a9", "#fff4d6", positive + negative < 0 ? "#fff4d6" : "#dfb45f"]
      : ["#d90a0a", "#9a9ca5", "#55575f"];
    const layout = node(
      "div",
      "",
      netSummary ? "summary-net-composition" : "summary-donut-layout",
    );
    if (netSummary) {
      const net = positive + negative;
      const deduction = Math.abs(negative);
      const overview = node("div", "", "net-composition-overview");
      if (positive > 0 && net >= 0) {
        const retained = (net / positive) * 100;
        const deducted = (deduction / positive) * 100;
        const regionTotals = new Map();
        for (const customer of filtered) {
          const region = customer.region || "ไม่ระบุเขตขาย";
          regionTotals.set(
            region,
            (regionTotals.get(region) || 0) + Math.max(0, customer.net),
          );
        }
        // Light shades so the slices stay visible on the red card.
        const regionColors = [
          "#ffffff",
          "#f6d3cf",
          "#eaaaa4",
          "#dc8680",
          "#f1c7a0",
          "#c9716c",
          "#b98f8c",
        ];
        const regionLegend = node("div", "", "summary-chart-legend");
        const segments = [];
        [...regionTotals]
          .filter(([, amount]) => amount > 0)
          .sort(([a], [b]) => a.localeCompare(b, "th"))
          .forEach(([region, amount], index) => {
            const share = (amount / positive) * 100;
            const color = regionColors[index % regionColors.length];
            segments.push({
              share: (share * retained) / 100,
              color,
              value: number.format(share) + "%",
              label: region,
              sub: money(amount),
              aria: `${region}: ${money(amount)} (${number.format(share)}% ของยอดสุทธิบวก)`,
            });
            const row = node("div", "", "summary-chart-label"),
              dot = node("i", "", "summary-legend-dot");
            dot.style.background = color;
            dot.setAttribute("aria-hidden", "true");
            row.append(
              dot,
              node("span", region),
              node("b", number.format(share) + "%"),
            );
            regionLegend.append(row);
          });
        if (deducted > 0)
          segments.push({
            share: deducted,
            color: "#2a0605",
            value: number.format(deducted) + "%",
            label: "หักออก (ยอดติดลบ)",
            sub: money(deduction),
            aria: `หักออกจากยอดติดลบ ${money(deduction)} (${number.format(deducted)}% ของยอดสุทธิบวก)`,
          });
        const { ring } = summaryRing({
          className: "net-retention-ring",
          centerClass: "net-retention-center",
          box: 160,
          r: 66,
          ariaLabel: "สัดส่วนยอดบวกแยกตามเขตขาย",
          segments,
          center: {
            value: retained,
            text: (v) => number.format(v) + "%",
            label: "ยอดสุทธิคงเหลือ",
          },
          animate,
        });
        const detail = node("div", "", "net-retention-detail");
        detail.append(
          node("span", "สัดส่วนจากยอดบวก", "net-retention-eyebrow"),
          node("b", "หักออก " + number.format(deducted) + "%"),
          node("span", money(deduction), "net-retention-amount"),
          node(
            "span",
            "จากยอดสุทธิติดลบของลูกค้า",
            "net-retention-description",
          ),
        );
        overview.append(ring, detail);
        const regionButton = node(
          "button",
          "ดูสัดส่วนแต่ละภาค",
          "net-region-button",
        );
        regionButton.type = "button";
        regionButton.setAttribute("aria-haspopup", "dialog");
        const regionDialog = node("dialog", "", "net-region-dialog");
        regionDialog.setAttribute("aria-labelledby", "net-region-dialog-title");
        const dialogHeader = node("div", "", "net-region-dialog-header");
        const dialogTitle = node("h2", "สัดส่วนแต่ละภาค");
        dialogTitle.id = "net-region-dialog-title";
        const closeButton = node("button", "ปิด");
        closeButton.type = "button";
        dialogHeader.append(dialogTitle, closeButton);
        regionDialog.append(
          dialogHeader,
          regionLegend,
          node(
            "p",
            "สัดส่วนยอดสุทธิบวกของลูกค้าในแต่ละเขตขาย ก่อนหักยอดติดลบรวม",
            "net-region-note",
          ),
        );
        regionButton.addEventListener("click", () => regionDialog.showModal());
        closeButton.addEventListener("click", () => regionDialog.close());
        regionDialog.addEventListener("click", (event) => {
          if (event.target !== regionDialog) return;
          const bounds = regionDialog.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            regionDialog.close();
        });
        regionDialog.addEventListener("close", () => regionButton.focus());
        const chartHeader = node("div", "", "net-region-chart-header");
        chartHeader.append(chart.firstElementChild, regionButton);
        chart.prepend(chartHeader);
        layout.append(regionDialog);
      } else {
        overview.classList.add("net-composition-empty");
        overview.append(
          node(
            "span",
            positive > 0
              ? "ยอดหักมากกว่ายอดบวก"
              : deduction > 0
                ? "มีเฉพาะยอดหักในช่วงนี้"
                : "ไม่มียอดซื้อสุทธิในช่วงนี้",
            "net-composition-note",
          ),
        );
      }
      layout.prepend(overview);
    }
    let donut = null;
    if (!netSummary) {
      const total = values.reduce((sum, [, value]) => sum + value, 0);
      donut = summaryRing({
        className: "summary-donut",
        centerClass: "summary-donut-center",
        box: 140,
        r: 52,
        ariaLabel: caption,
        segments: values.map(([label, value, formatted], index) => ({
          share: total ? (value / total) * 100 : 0,
          color: colors[index],
          value: total ? number.format((value / total) * 100) + "%" : "—",
          label,
          sub: formatted,
          aria: `${label}: ${formatted}${total ? ` (${number.format((value / total) * 100)}%)` : ""}`,
        })),
        center: {
          value: total ? (values[0][1] / total) * 100 : 0,
          text: (v) => (total ? number.format(v) + "%" : "—"),
          label: total
            ? id === "count-summary-chart"
              ? "มี 2 บิลขึ้นไป"
              : "บิลจาก Top 5"
            : "ไม่มีบิลขาย",
        },
        animate: animate && total > 0,
      });
      layout.append(donut.ring);
    }
    const legend = node("div", "", "summary-chart-legend");
    for (const [index, [label, , formatted]] of values.entries()) {
      const row = node("div", "", "summary-chart-label");
      const dot = node("i", "", "summary-legend-dot");
      dot.style.background = colors[index];
      dot.setAttribute("aria-hidden", "true");
      row.append(dot, node("span", label), node("b", formatted));
      legend.append(row);
    }
    if (donut) {
      linkLegend(legend, donut.activate);
      donut.ring.addEventListener("ring-activate", ({ detail }) =>
        [...legend.children].forEach((row, index) =>
          row.classList.toggle("is-active", index === detail),
        ),
      );
    }
    layout.append(legend);
    chart.append(layout);
    if (netSummary)
      chart.append(
        node(
          "p",
          "ยอดติดลบนี้เป็นยอดสุทธิของกลุ่มลูกค้า ไม่ใช่ยอดรับคืนทั้งหมด",
          "summary-method-note",
        ),
      );
  }
}

function applySearch(preservePage = false) {
  if (!period) return;
  if (el("customer-detail").open) closeCustomerDetail();
  const query = el("customer-search").value.trim().toLocaleLowerCase("th-TH");
  filtered = customers.filter((customer) =>
    `${customer.code}\n${customer.name}`
      .toLocaleLowerCase("th-TH")
      .includes(query),
  );
  if (preservePage !== true) customerPage = 0;
  el("total-net").textContent = money(
    filtered.reduce((sum, customer) => sum + customer.net, 0),
  );
  el("customer-count").textContent = number.format(filtered.length);
  el("invoice-count").textContent = number.format(
    filtered.reduce((sum, customer) => sum + customer.invoiceCount, 0),
  );
  el("matching-count").textContent = `${number.format(filtered.length)} ราย`;
  renderSummaryCharts();
  renderChart();
  renderCustomers();
  message(
    filtered.length
      ? `${dateLabel(period.start)} – ${dateLabel(period.end)} · พบลูกค้า ${number.format(filtered.length)} ราย${query ? ` จากทั้งหมด ${number.format(customers.length)} ราย` : ""}`
      : customers.length
        ? "ไม่พบลูกค้าที่ตรงกับคำค้นหา ลองค้นหาด้วยรหัสหรือชื่ออื่น"
        : "ไม่พบรายการลูกค้าในช่วงวันที่เลือก",
  );
  if (!filtered.some((customer) => customer.code === selectedCode)) {
    selectedCode = null;
    clearDetail();
    updateSelectedHeading(null);
  }
}

async function selectCustomer(code, revealInTable = false) {
  const customer = filtered.find((item) => item.code === code);
  if (!customer || !period) return;
  if (revealInTable) {
    customerPage = Math.floor(filtered.indexOf(customer) / customerPageSize);
    renderCustomers();
  }
  if (
    selectedCode === code &&
    (detail || el("customer-detail").getAttribute("aria-busy") === "true")
  ) {
    updateSelection();
    return;
  }
  selectedCode = code;
  clearDetail(`กำลังโหลดรายการสินค้าของ ${customer.name}…`);
  updateSelectedHeading(customer);
  updateSelection();
  const request = ++detailRequest;
  const controller = new AbortController();
  detailController = controller;
  el("customer-detail").setAttribute("aria-busy", "true");
  try {
    const query = new URLSearchParams({ ...period, code });
    const data = await requestJSON(
      `/api/customer-insights/products?${query}`,
      controller.signal,
    );
    if (request !== detailRequest) return;
    detail = data;
    updateSelectedHeading(data.customer);
    el("detail-status").textContent =
      `โหลดสินค้าของ ${data.customer.name} แล้ว ${number.format(data.products.length)} รายการ`;
    el("detail-status").hidden = true;
    el("detail-content").hidden = false;
    el("cbx-foot").hidden = false;
    renderSummary();
    renderCategories();
    renderProducts();
  } catch (error) {
    if (controller.signal.aborted || request !== detailRequest) return;
    el("detail-status").textContent =
      error.message === "Failed to fetch"
        ? "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่"
        : error.message;
    el("detail-retry").hidden = false;
  } finally {
    if (request === detailRequest) {
      el("customer-detail").setAttribute("aria-busy", "false");
      detailController = null;
    }
  }
}

function catColor(category) {
  return cbx.colors.get(category) || "#6f6f6f";
}

function renderProducts() {
  if (!detail) return;
  const body = el("product-rows");
  body.replaceChildren();
  const list = visibleProducts();
  const itemNet = safeNum(detail.itemNet);
  const maxTotal = Math.max(0, ...list.map((p) => safeNum(p.total)));
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  list.forEach((product, index) => {
    const total = safeNum(product.total);
    const row = node("div", "", "cbx-row");
    row.setAttribute("role", "listitem");
    if (!reduce && index < 30) row.style.animationDelay = `${index * 25}ms`;

    const rank = node("span", String(index + 1), "cbx-rank");
    if (index === 0 && cbx.sort === "amount" && total > 0) rank.classList.add("is-top");

    const info = node("div", "", "cbx-prod");
    const meta = node("div", "", "cbx-prod-meta");
    const code = node("button", product.code || "ไม่ระบุรหัส", "cbx-code cbx-mono");
    code.type = "button";
    code.title = "คลิกเพื่อคัดลอกรหัสสินค้า";
    code.onclick = () => cbxCopy(product.code, "รหัสสินค้า");
    const tag = node("span", product.category || "ไม่ระบุหมวดหมู่", "cbx-cat-tag");
    const dot = node("i", "", "cbx-cat-dot");
    dot.style.background = catColor(product.category);
    tag.prepend(dot);
    meta.append(code, tag);
    info.append(node("span", product.name || "ไม่ระบุชื่อสินค้า", "cbx-prod-name"), meta);

    const qty = node("div", "", "cbx-qty");
    qty.append(node("strong", number.format(safeNum(product.quantity))), node("small", product.unit || ""));

    const amt = node("div", "", "cbx-amt");
    amt.append(
      node("strong", money(total), total < 0 ? "is-neg" : ""),
      node("small", `${number.format(Math.round(pct(total, itemNet) * 10) / 10)}% ของยอดซื้อ`),
    );
    const track = node("span", "", "cbx-track");
    const fill = node("span", "", "cbx-fill");
    fill.style.width = `${total > 0 && maxTotal > 0 ? Math.max(2, (total / maxTotal) * 100) : 0}%`;
    fill.style.background = catColor(product.category);
    track.append(fill);
    amt.append(track);

    const last = node("div", "", "cbx-last");
    const ago = daysAgo(product.lastPurchased);
    last.append(
      node("strong", product.lastPurchased ? shortDate(product.lastPurchased) : "—"),
      node(
        "small",
        ago === null ? "ไม่มีบิลขาย" : ago <= 0 ? "วันนี้" : `${number.format(ago)} วันก่อน`,
        ago !== null && ago <= 3 ? "is-recent" : "",
      ),
    );
    row.append(rank, info, qty, amt, last);
    body.append(row);
  });
  const empty = el("cbx-empty");
  empty.hidden = list.length > 0;
  empty.textContent = detail.products.length
    ? "ไม่พบสินค้าที่ตรงกับการค้นหา"
    : "ไม่พบรายการสินค้าในช่วงวันที่เลือก";
  const sum = list.reduce((s, p) => s + safeNum(p.total), 0);
  el("item-total").textContent =
    `${number.format(list.length)} จาก ${number.format(detail.products.length)} รายการ` +
    (cbx.cat ? ` · หมวด ${cbx.cat}` : "") +
    ` · รวม ${money(sum)}`;
}

function renderCategories() {
  const svg = el("category-chart"),
    legend = el("category-legend");
  svg.replaceChildren();
  legend.replaceChildren();
  const cats = [...detail.categories].sort((a, b) => safeNum(b.total) - safeNum(a.total));
  const positiveTotal = cats.reduce((sum, c) => sum + Math.max(0, safeNum(c.total)), 0);
  const positives = cats.filter((c) => safeNum(c.total) > 0);
  const maxCat = Math.max(0, ...positives.map((c) => safeNum(c.total)));
  cbx.colors = new Map();
  positives.forEach((c, i) => cbx.colors.set(c.name, palette[i % palette.length]));

  const ns = "http://www.w3.org/2000/svg";
  const ring = (attrs) => {
    const item = document.createElementNS(ns, "circle");
    for (const [key, value] of Object.entries({ cx: 88, cy: 88, r: 70, fill: "none", "stroke-width": 14, ...attrs }))
      item.setAttribute(key, String(value));
    svg.append(item);
    return item;
  };
  ring({ stroke: "#242424" });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gap = positives.length > 1 ? 0.8 : 0;
  let offset = 0;
  const segments = new Map();
  positives.forEach((c) => {
    const share = pct(safeNum(c.total), positiveTotal);
    const length = Math.max(0.1, share - gap);
    const seg = ring({
      stroke: catColor(c.name),
      pathLength: 100,
      "stroke-linecap": "butt",
      "stroke-dasharray": reduce ? `${length} ${100 - length}` : `0 100`,
      "stroke-dashoffset": -offset,
      transform: "rotate(-90 88 88)",
      class: "cbx-seg-arc",
      tabindex: 0,
      role: "button",
      "aria-label": `${c.name} ${number.format(Math.round(share * 10) / 10)}% ${money(c.total)}`,
    });
    if (!reduce)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => seg.setAttribute("stroke-dasharray", `${length} ${100 - length}`)),
      );
    seg.addEventListener("mouseenter", () => setCenter(c));
    seg.addEventListener("mouseleave", () => setCenter(null));
    seg.addEventListener("focus", () => setCenter(c));
    seg.addEventListener("blur", () => setCenter(null));
    seg.addEventListener("click", () => toggleCat(c.name));
    seg.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleCat(c.name);
      }
    });
    segments.set(c.name, seg);
    offset += share;
  });

  cats.forEach((c) => {
    const total = safeNum(c.total);
    const share = total > 0 ? pct(total, positiveTotal) : 0;
    const item = node("li");
    const button = node("button", "", "cbx-legend-row");
    button.type = "button";
    button.dataset.cat = c.name;
    const swatch = node("i", "", "cbx-swatch");
    swatch.style.background = catColor(c.name);
    const label = node("span", "", "cbx-legend-name");
    const track = node("span", "", "cbx-track");
    const fill = node("span", "", "cbx-fill");
    fill.style.width = `${total > 0 && maxCat > 0 ? (total / maxCat) * 100 : 0}%`;
    fill.style.background = catColor(c.name);
    track.append(fill);
    label.append(node("span", c.name || "ไม่ระบุหมวดหมู่"), track);
    button.append(
      swatch,
      label,
      node("strong", share > 0 ? `${number.format(Math.round(share * 10) / 10)}%` : "—", "cbx-legend-pct"),
      node("small", money(total), "cbx-legend-amt"),
    );
    button.addEventListener("mouseenter", () => total > 0 && setCenter(c));
    button.addEventListener("mouseleave", () => setCenter(null));
    button.onclick = () => toggleCat(c.name);
    item.append(button);
    legend.append(item);
  });

  function setCenter(c) {
    for (const [key, seg] of segments) seg.classList.toggle("is-hover", c?.name === key);
    if (c) {
      el("category-count").textContent = `${number.format(Math.round(pct(safeNum(c.total), positiveTotal) * 10) / 10)}%`;
      el("cbx-center-label").textContent = c.name;
      el("cbx-center-sub").textContent = money(c.total);
    } else {
      el("category-count").textContent = number.format(positives.length);
      el("cbx-center-label").textContent = "หมวดหมู่";
      el("cbx-center-sub").textContent = money(positiveTotal);
    }
  }
  cbx.paintCats = () => {
    for (const [key, seg] of segments) seg.classList.toggle("is-dim", !!cbx.cat && cbx.cat !== key);
    for (const row of legend.querySelectorAll(".cbx-legend-row")) {
      const active = row.dataset.cat === cbx.cat;
      row.classList.toggle("is-active", active);
      row.classList.toggle("is-dim", !!cbx.cat && !active);
      row.setAttribute("aria-pressed", String(active));
    }
  };
  setCenter(null);
  cbx.paintCats();
  el("cbx-cat-total").textContent = `รวม ${money(positiveTotal)}`;
  el("category-empty").hidden = positiveTotal > 0;
}

function toggleCat(category) {
  cbx.cat = cbx.cat === category ? null : category;
  cbx.paintCats?.();
  renderProducts();
}

function downloadCustomerCsv() {
  if (!detail) return;
  const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["รหัสสินค้า", "ชื่อสินค้า", "หมวดหมู่", "จำนวน", "หน่วย", "ยอดรวม", "ซื้อล่าสุด"],
    ...detail.products.map((p) => [
      p.code,
      p.name,
      p.category,
      safeNum(p.quantity),
      p.unit,
      safeNum(p.total).toFixed(2),
      p.lastPurchased || "",
    ]),
  ].map((row) => row.map(cell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `customer-products-${detail.customer.code || "unknown"}-${period?.start || ""}_${period?.end || ""}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function validateDates() {
  const start = el("start"),
    end = el("end");
  end.setCustomValidity("");
  if (
    start.value &&
    end.value &&
    (start.value > end.value ||
      (Date.parse(end.value) - Date.parse(start.value)) / 86400000 > 365)
  ) {
    end.setCustomValidity(
      "กรุณาเลือกวันสิ้นสุดตั้งแต่วันเริ่มต้น และช่วงเวลาไม่เกิน 366 วัน",
    );
  }
  return el("customer-filters").checkValidity();
}

function invalidateMaster() {
  if (el("customer-detail").open) closeCustomerDetail();
  masterController?.abort();
  masterRequest++;
  period = null;
  customers = [];
  filtered = [];
  clearDetail();
  el("customer-dashboard").hidden = true;
  el("refresh").disabled = false;
}

async function loadCustomers(silent = false) {
  if (window.prplusAccess && !window.prplusAccess.customer) return;
  if (activeInsightsView !== "customers") return;
  clearTimeout(filterTimer);
  if (!silent) invalidateMaster();
  if (!validateDates()) {
    message("กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน", true);
    return;
  }
  const selectedBefore = selectedCode;
  const requestedPeriod = { start: el("start").value, end: el("end").value };
  const controller = new AbortController();
  masterController = controller;
  const request = ++masterRequest;
  if (!silent) message("กำลังโหลดข้อมูลลูกค้าจาก SML…");
  el("refresh").disabled = true;
  try {
    const data = await requestJSON(
      `/api/customer-insights?${new URLSearchParams(requestedPeriod)}`,
      controller.signal,
    );
    if (request !== masterRequest) return;
    customers = data.customers
      .map((customer) => ({
        ...customer,
        net: Number(customer.net),
        invoiceCount: Number(customer.invoiceCount),
      }))
      .sort((a, b) => b.net - a.net || a.code.localeCompare(b.code, "th"));
    period = requestedPeriod;
    masterUpdatedAt = data.updatedAt;
    selectedCode = null;
    // Keep a selected customer across date changes only if it still matches both filters.
    const query = el("customer-search").value.trim().toLocaleLowerCase("th-TH");
    const previous = customers.find(
      (customer) =>
        customer.code === selectedBefore &&
        `${customer.code}\n${customer.name}`
          .toLocaleLowerCase("th-TH")
          .includes(query),
    );
    if (previous) selectedCode = previous.code;
    detailController = null;
    el("customer-dashboard").hidden = false;
    animateSummary = !silent;
    applySearch(silent);
    el("updated").textContent =
      `อัปเดตข้อมูล ${new Date(masterUpdatedAt).toLocaleString("th-TH")}`;
  } catch (error) {
    if (controller.signal.aborted || request !== masterRequest) return;
    message(
      error.message === "Failed to fetch"
        ? "เชื่อมต่อ SML ไม่สำเร็จ กรุณากดอัปเดตข้อมูลเพื่อลองใหม่"
        : error.message,
      true,
    );
  } finally {
    if (request === masterRequest) el("refresh").disabled = false;
  }
}

el("customer-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  syncNonBuyerPeriodToMaster();
  loadNonBuyers();
  if (activeInsightsView === "customers") loadCustomers();
  else productViewEvent("insights-product-refresh");
});
el("customers-view-button").addEventListener("click", () =>
  switchInsightsView("customers"),
);
el("products-view-button").addEventListener("click", () =>
  switchInsightsView("products"),
);
el("customer-search").addEventListener("input", applySearch);
el("non-buyer-search").addEventListener("input", applyNonBuyerSearch);
el("non-buyer-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  loadNonBuyers();
});
for (const id of ["non-buyer-start", "non-buyer-end"]) {
  el(id).addEventListener("input", () => {
    clearTimeout(nonBuyerTimer);
    if (validateNonBuyerDates()) nonBuyerTimer = setTimeout(loadNonBuyers, 250);
  });
}
for (const [direction, change] of [
  ["prev", -1],
  ["next", 1],
]) {
  el(`non-buyer-${direction}`).addEventListener("click", () => {
    nonBuyerPage = Math.max(0, nonBuyerPage + change);
    renderNonBuyers();
  });
}
for (const id of ["start", "end"]) {
  el(id).addEventListener("input", () => {
    invalidateMaster();
    clearTimeout(filterTimer);
    syncNonBuyerPeriodToMaster();
    clearTimeout(nonBuyerTimer);
    if (validateNonBuyerDates()) nonBuyerTimer = setTimeout(loadNonBuyers, 250);
    if (activeInsightsView === "products") {
      productViewEvent("insights-period-change");
      return;
    }
    if (validateDates()) {
      message("กำลังอัปเดตข้อมูลตามช่วงวันที่…");
      filterTimer = setTimeout(loadCustomers, 250);
    } else message("กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน", true);
  });
}
for (const [direction, change] of [
  ["prev", -1],
  ["next", 1],
]) {
  el(`customer-${direction}`).addEventListener("click", () => {
    customerPage = Math.max(
      0,
      Math.min(
        Math.max(0, Math.ceil(filtered.length / customerPageSize) - 1),
        customerPage + change,
      ),
    );
    renderCustomers();
  });
}
el("detail-retry").addEventListener("click", () =>
  selectCustomer(selectedCode),
);
el("detail-close").addEventListener("click", closeCustomerDetail);
el("selected-code").addEventListener("click", () =>
  cbxCopy(detail?.customer?.code, "รหัสลูกค้า"),
);
el("cbx-search").addEventListener("input", () => {
  clearTimeout(cbx.searchTimer);
  cbx.searchTimer = setTimeout(() => {
    cbx.query = el("cbx-search").value;
    renderProducts();
  }, 150);
});
el("cbx-sort").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sort]");
  if (!button || !detail) return;
  cbx.sort = button.dataset.sort;
  syncSortButtons();
  renderProducts();
});
el("cbx-csv").addEventListener("click", downloadCustomerCsv);
el("customer-detail").addEventListener("cancel", (event) => {
  event.preventDefault();
  if (cbx.query || el("cbx-search").value) {
    clearTimeout(cbx.searchTimer);
    cbx.query = "";
    el("cbx-search").value = "";
    renderProducts();
  } else if (cbx.cat) {
    toggleCat(cbx.cat);
  } else closeCustomerDetail();
});
el("customer-detail").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const controls = [
    ...el("customer-detail").querySelectorAll(
      'button:not(:disabled), input, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((control) => control.getClientRects().length > 0);
  const first = controls[0],
    last = controls.at(-1);
  if (
    (event.shiftKey && document.activeElement === first) ||
    (!event.shiftKey && document.activeElement === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
});
el("customer-detail").addEventListener("close", () => {
  // Ignore a queued close event if the user has already opened another customer.
  if (
    !el("customer-detail").open &&
    document.body.classList.contains("customer-dialog-open")
  )
    closeCustomerDetail();
});
function outsideDetail(event) {
  const bounds = el("customer-detail").getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}
el("customer-detail").addEventListener("pointerdown", (event) => {
  backdropPointerDown = outsideDetail(event);
});
el("customer-detail").addEventListener("click", (event) => {
  if (backdropPointerDown && outsideDetail(event)) closeCustomerDetail();
  backdropPointerDown = false;
});
const today = new Date();
el("start").value = iso(new Date(today.getFullYear(), today.getMonth(), 1));
el("end").value = iso(today);
el("non-buyer-start").value = el("start").value;
el("non-buyer-end").value = el("end").value;
async function startInsightsAccess() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return;
    const user = await response.json();
    const has = (p) =>
      !Array.isArray(user.permissions) ||
      user.role === "super_admin" ||
      user.permissions.includes(p);
    window.prplusAccess = {
      customer: has("customer_analysis"),
      product: has("product_analysis"),
    };
    el("customers-view-button").hidden = !window.prplusAccess.customer;
    el("products-view-button").hidden = !window.prplusAccess.product;
    if (window.prplusAccess.customer) {
      loadCustomers();
      loadNonBuyers();
    } else if (window.prplusAccess.product) switchInsightsView("products");
  } catch {
    message("ตรวจสิทธิ์ไม่สำเร็จ กรุณารีเฟรชหน้า", true);
  }
}
startInsightsAccess();
setInterval(() => {
  if (
    document.hidden ||
    el("refresh").disabled ||
    document.querySelector("dialog[open]")
  )
    return;
  if (activeInsightsView === "customers") loadCustomers(true);
  else productViewEvent("insights-product-refresh", true);
}, 60000);
