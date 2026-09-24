import { regionFor } from "./consignment-data.js";
import { renderRegionalChart } from "./consignment-region-chart.js";
import { setHelpData } from "./consignment-help.js";
import { exportConsignment } from "./consignment-export.js";
const $ = (id) => document.getElementById(id),
  fmt = (n) =>
    new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(n);
const date = (d) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
let products = [],
  visible = [],
  page = 0,
  selected = null,
  historyPage = 0,
  loaded = false,
  dataSignature = "";
let exporting = false,
  sortDirection = "desc",
  exportSource = "",
  latestVisible = null;
const size = 25;
const STALE_DAYS = 90;
const filterIds = ["search", "region", "customer", "unit", "stock"];
const filterLabels = {
  search: "ค้นหา",
  region: "ภูมิภาค",
  customer: "รหัสฝาก",
  unit: "หน่วย",
  stock: "สถานะ",
};
const pct = (n) =>
  new Intl.NumberFormat("th-TH", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(n);
const stamp = (d) =>
  new Date(d).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// Whole days from a YYYY-MM-DD movement date to today (local calendar), NaN when there is no date.
function daysSince(isoDate) {
  if (!isoDate) return NaN;
  const [y, m, d] = isoDate.split("-").map(Number),
    now = new Date();
  return Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(y, m - 1, d)) /
      86400000,
  );
}
const isStale = (p) => daysSince(p.last) > STALE_DAYS;
function readFilters() {
  return {
    q: $("search").value.trim().toLocaleLowerCase(),
    region: $("region").value,
    customer: $("customer").value,
    unit: $("unit").value,
    stock: $("stock").value,
  };
}
let criteria = readFilters();
function matches(p) {
  const f = criteria;
  return (
    (!f.q ||
      [p.product, p.code, p.customer, p.customerCode]
        .join(" ")
        .toLocaleLowerCase()
        .includes(f.q)) &&
    (!f.region || p.region === f.region) &&
    (!f.customer || p.customer.slice(0, 3) === f.customer) &&
    (!f.unit || p.unit === f.unit) &&
    (!f.stock ||
      (f.stock === "positive"
        ? p.balance > 0
        : f.stock === "zero"
          ? p.balance === 0
          : f.stock === "stale"
            ? isStale(p)
            : p.balance < 0))
  );
}
// Numbers count from their previous value; bars ease via CSS. Both are skipped for reduced motion.
function countTo(el, value) {
  const from = Number(el.dataset.value ?? 0),
    token = (el.countToken = (el.countToken || 0) + 1),
    round = Number.isInteger(value) ? Math.round : (n) => n;
  el.dataset.value = value;
  if (reducedMotion() || !Number.isFinite(from) || from === value) {
    el.textContent = fmt(value);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    if (el.countToken !== token) return;
    const t = Math.min(1, (now - start) / 600);
    el.textContent = fmt(round(from + (value - from) * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function clearValue(el, text = "—") {
  el.countToken = (el.countToken || 0) + 1;
  delete el.dataset.value;
  el.textContent = text;
}
// Readable value of a filter field ("" when it is not set).
function filterText(id) {
  const field = $(id),
    value = field.value.trim();
  if (!value) return "";
  return id === "search"
    ? `“${value}”`
    : field.selectedOptions[0]?.textContent || value;
}
function renderChips() {
  const box = $("active-filters");
  let active = 0;
  box.replaceChildren();
  for (const id of filterIds) {
    const field = $(id),
      text = filterText(id);
    field.classList.toggle("is-active", Boolean(text));
    if (!text) continue;
    active++;
    const chip = document.createElement("span"),
      remove = document.createElement("button");
    chip.className = "cs-chip";
    chip.textContent = `${filterLabels[id]}: ${text}`;
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "ลบตัวกรอง " + filterLabels[id]);
    remove.onclick = () => {
      field.value = "";
      filterChanged(0);
      (box.querySelector("button") || $("search")).focus();
    };
    chip.append(remove);
    box.append(chip);
  }
  if (!active) {
    const note = document.createElement("span");
    note.className = "cs-chips-empty";
    note.textContent = "ยังไม่ได้กรอง · แสดงสินค้าทั้งหมด";
    box.append(note);
  }
  $("reset").disabled = !active;
}
const summaryTable = document.querySelector(".panel .movement-table");
const sortableSummaryHeaders = [
  ...summaryTable.querySelectorAll("thead th"),
].slice(1, 5);
const summarySortKeys = ["recent", "in", "out", "balance"];
sortableSummaryHeaders.forEach((header, index) => {
  const key = summarySortKeys[index],
    button = document.createElement("button"),
    icon = document.createElement("span");
  button.type = "button";
  button.className = "consignment-sort";
  icon.className = "consignment-sort-icon";
  icon.setAttribute("aria-hidden", "true");
  button.append(document.createTextNode(header.textContent), icon);
  header.replaceChildren(button);
  header.setAttribute("aria-sort", "none");
  button.onclick = () => {
    if ($("sort").value === key)
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    else {
      sortDirection = "asc";
      $("sort").value = key;
    }
    render();
  };
});
function updateSummarySortHeaders() {
  sortableSummaryHeaders.forEach((header, index) => {
    const active = $("sort").value === summarySortKeys[index];
    header.setAttribute(
      "aria-sort",
      active ? (sortDirection === "asc" ? "ascending" : "descending") : "none",
    );
    header.querySelector(".consignment-sort-icon").textContent = active
      ? sortDirection === "asc"
        ? "▲"
        : "▼"
      : "↕";
  });
}
function cell(tr, text, className = "") {
  const td = document.createElement("td");
  td.textContent = text;
  td.className = className;
  tr.append(td);
  return td;
}
function options(id, values) {
  const old = $(id).value;
  $(id).replaceChildren(
    new Option("ทั้งหมด", ""),
    ...[...new Set(values)]
      .filter(Boolean)
      .sort()
      .map((v) => new Option(v, v)),
  );
  if ([...$(id).options].some((o) => o.value === old)) $(id).value = old;
}
function render() {
  criteria = readFilters();
  visible = products.filter(matches);
  renderChips();
  renderCards();
  renderTable();
}
function renderCards() {
  const shown = visible.length,
    units = new Set();
  let inStock = 0,
    zero = 0,
    negative = 0,
    stale = 0,
    outSum = 0,
    balanceSum = 0;
  latestVisible = null;
  for (const p of visible) {
    if (p.balance > 0) inStock++;
    else if (p.balance === 0) zero++;
    else negative++;
    if (isStale(p)) stale++;
    outSum += p.out;
    balanceSum += p.balance;
    units.add(p.unit);
    if (
      !latestVisible ||
      p.last > latestVisible.last ||
      (p.last === latestVisible.last && p.index > latestVisible.index)
    )
      latestVisible = p;
  }
  $("cs-empty").hidden = !loaded || shown > 0;
  for (const id of ["link-table", "link-in-stock", "link-regional"])
    $(id).disabled = !loaded;
  $("link-history").disabled = !latestVisible;
  const unitWarning = $("unit-warning"),
    lastAgo = $("last-ago"),
    staleLine = $("stale-line");
  lastAgo.classList.remove("is-fresh");
  staleLine.classList.remove("cs-warn");
  if (!loaded) {
    // Still loading, or the first load failed: show dashes, never zeros.
    for (const id of ["product-count", "stock-count", "out-total"])
      clearValue($(id));
    for (const id of [
      "product-total",
      "stock-share",
      "balance-line",
      "last-ago",
      "stale-line",
      "out-unit",
    ])
      $(id).textContent = "";
    $("product-bar").style.width = "0%";
    $("stock-bar").style.width = "0%";
    $("last-date").textContent = "—";
    $("flow-unit").textContent = "เบิกออกสะสม";
    unitWarning.hidden = true;
    return;
  }
  countTo($("product-count"), shown);
  $("product-total").textContent = `จากทั้งหมด ${fmt(products.length)} รหัส`;
  $("product-bar").style.width = `${products.length ? (shown / products.length) * 100 : 0}%`;
  countTo($("stock-count"), inStock);
  $("stock-bar").style.width = `${shown ? (inStock / shown) * 100 : 0}%`;
  $("stock-share").textContent =
    `มีของ ${shown ? pct(inStock / shown) : "–"} · หมดแล้ว ${fmt(zero)} รหัส` +
    (negative ? ` · ติดลบ ${fmt(negative)} รหัส` : "");
  countTo($("out-total"), outSum);
  const oneUnit = units.size === 1 ? [...units][0] : "",
    ratio = outSum > 0 ? pct(balanceSum / outSum) : "–";
  $("out-unit").textContent = oneUnit;
  $("balance-line").textContent =
    `คงเหลือล่าสุด ${fmt(balanceSum)}${oneUnit ? " " + oneUnit : ""} · อัตราคงเหลือ ${ratio}`;
  unitWarning.hidden = units.size < 2;
  unitWarning.textContent = `⚠ รวม ${fmt(units.size)} หน่วยปนกัน`;
  $("flow-unit").textContent = oneUnit
    ? `หน่วย: ${oneUnit}`
    : units.size > 1
      ? "หลายหน่วย"
      : "เบิกออกสะสม";
  const days = daysSince(latestVisible?.last);
  $("last-date").textContent = latestVisible ? date(latestVisible.last) : "–";
  lastAgo.textContent = !Number.isFinite(days)
    ? ""
    : days <= 0
      ? "วันนี้"
      : days === 1
        ? "เมื่อวาน"
        : `ผ่านมา ${fmt(days)} วัน`;
  lastAgo.classList.toggle("is-fresh", Number.isFinite(days) && days <= 1);
  staleLine.textContent = `ไม่เคลื่อนไหวเกิน ${STALE_DAYS} วัน ${fmt(stale)} รหัส`;
  staleLine.classList.toggle("cs-warn", stale > 0);
}
// Current numbers shown inside the (i) help popup, from the same filtered list as the cards.
function groupBy(list, keyOf) {
  const groups = new Map();
  for (const p of list) {
    const key = keyOf(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups];
}
const sum = (list, field) => list.reduce((s, p) => s + p[field], 0);
function helpData(key) {
  if (!["products", "stock", "flow", "recent", "filters"].includes(key))
    return null;
  if (!loaded)
    return { note: "ยังไม่มีข้อมูลจาก SML · รอโหลดเสร็จแล้วเปิดอีกครั้ง" };
  const shown = visible.length,
    used = filterIds.map((id) => [filterLabels[id], filterText(id)]),
    usedText =
      used
        .filter(([, text]) => text)
        .map(([label, text]) => `${label}: ${text}`)
        .join(" · ") || "ไม่ได้กรอง";
  const empty = shown ? "" : "ไม่พบสินค้าที่ตรงกับตัวกรอง";
  if (key === "filters")
    return {
      rows: [
        ...used.map(([label, text]) => [label, text || "ทั้งหมด"]),
        ["ผลลัพธ์", `${fmt(shown)} จาก ${fmt(products.length)} รหัส`],
      ],
    };
  if (key === "products")
    return {
      note: empty,
      rows: [
        ["สินค้าที่แสดง", `${fmt(shown)} รหัส`],
        [
          "จากทั้งหมด",
          `${fmt(products.length)} รหัส (${products.length ? pct(shown / products.length) : "–"})`,
        ],
        ["ตัวกรองที่ใช้", usedText],
      ],
      table: {
        caption: "แยกตามภูมิภาค",
        head: ["ภูมิภาค", "รหัส"],
        rows: groupBy(visible, (p) => p.region)
          .sort((a, b) => b[1].length - a[1].length)
          .map(([region, list]) => [region, fmt(list.length)]),
      },
    };
  if (key === "stock") {
    const inStock = visible.filter((p) => p.balance > 0).length,
      zero = visible.filter((p) => p.balance === 0).length,
      negative = shown - inStock - zero;
    return {
      note: empty,
      rows: [
        ["มีคงเหลือ (> 0)", `${fmt(inStock)} รหัส`],
        ["หมดแล้ว (= 0)", `${fmt(zero)} รหัส`],
        ...(negative ? [["คงเหลือติดลบ", `${fmt(negative)} รหัส`]] : []),
        ["สัดส่วนมีของ", shown ? pct(inStock / shown) : "–"],
      ],
      table: {
        caption: "แยกตามภูมิภาค",
        head: ["ภูมิภาค", "มีของ", "หมดแล้ว"],
        rows: groupBy(visible, (p) => p.region)
          .sort((a, b) => b[1].length - a[1].length)
          .map(([region, list]) => [
            region,
            fmt(list.filter((p) => p.balance > 0).length),
            fmt(list.filter((p) => p.balance === 0).length),
          ]),
      },
    };
  }
  if (key === "flow") {
    const outSum = sum(visible, "out"),
      balanceSum = sum(visible, "balance"),
      byUnit = groupBy(visible, (p) => p.unit);
    return {
      note:
        empty ||
        (byUnit.length > 1
          ? `ยอดรวมปน ${fmt(byUnit.length)} หน่วย · ดูตารางแยกหน่วยด้านล่าง`
          : ""),
      rows: [
        ["เบิกออกสะสม", fmt(outSum)],
        ["คงเหลือล่าสุด", fmt(balanceSum)],
        ["อัตราคงเหลือ", outSum > 0 ? pct(balanceSum / outSum) : "–"],
      ],
      table: {
        caption: "แยกตามหน่วย",
        head: ["หน่วย", "รหัส", "เบิกออก", "คงเหลือ"],
        rows: byUnit
          .sort((a, b) => sum(b[1], "out") - sum(a[1], "out"))
          .map(([unit, list]) => [
            unit,
            fmt(list.length),
            fmt(sum(list, "out")),
            fmt(sum(list, "balance")),
          ]),
      },
    };
  }
  const recent = [...visible]
      .sort(
        (a, b) => b.last.localeCompare(a.last) || b.index - a.index,
      )
      .slice(0, 5),
    days = daysSince(latestVisible?.last);
  return {
    note: empty,
    rows: [
      ["เคลื่อนไหวล่าสุด", latestVisible ? date(latestVisible.last) : "–"],
      [
        "ผ่านมา",
        !Number.isFinite(days)
          ? "–"
          : days <= 0
            ? "วันนี้"
            : days === 1
              ? "เมื่อวาน"
              : `${fmt(days)} วัน`,
      ],
      [
        `ไม่เคลื่อนไหวเกิน ${STALE_DAYS} วัน`,
        `${fmt(visible.filter(isStale).length)} รหัส`,
      ],
    ],
    table: {
      caption: "5 รหัสที่เคลื่อนไหวล่าสุด",
      head: ["สินค้า", "วันที่", "คงเหลือ"],
      rows: recent.map((p) => [
        `${p.code} · ${p.product}`,
        date(p.last),
        `${fmt(p.balance)} ${p.unit}`,
      ]),
    },
  };
}
setHelpData(helpData);
function renderTable() {
  const unit = criteria.unit,
    sort = $("sort").value;
  visible.sort((a, b) => {
    const factor = sortDirection === "asc" ? 1 : -1;
    const value =
      sort === "balance"
        ? a.balance - b.balance
        : sort === "out"
          ? a.out - b.out
          : sort === "in"
            ? a.in - b.in
            : a.last.localeCompare(b.last);
    return factor * value || a.code.localeCompare(b.code);
  });
  updateSummarySortHeaders();
  $("export-excel").disabled = exporting || !loaded || !visible.length;
  renderRegionalChart(visible, unit, loaded);
  page = Math.min(page, Math.max(0, Math.ceil(visible.length / size) - 1));
  $("context").textContent = loaded
    ? `${fmt(visible.length)} รหัสสินค้า · คลิกแถวสินค้าเพื่อดูว่าเบิกอะไร เมื่อไร`
    : "กำลังรอข้อมูลจาก SML";
  $("summary").replaceChildren();
  for (const p of visible.slice(page * size, (page + 1) * size)) {
    const tr = document.createElement("tr"),
      name = cell(tr, "", "product-cell"),
      strong = document.createElement("strong"),
      small = document.createElement("small");
    strong.textContent = p.product;
    small.textContent =
      p.code + " · " + (p.customerCode || "ไม่พบรหัสลูกค้า") + " · " + p.region;
    name.append(strong, small);
    cell(tr, date(p.last));
    cell(tr, fmt(p.in));
    cell(tr, fmt(p.out), "out-number");
    cell(tr, fmt(p.balance), "balance-number");
    cell(tr, p.unit);
    const openHistory = () => showHistory(p);
    tr.classList.add("clickable-product");
    tr.tabIndex = 0;
    tr.setAttribute("aria-label", "ดูรายการ " + p.code);
    tr.setAttribute("aria-haspopup", "dialog");
    tr.onclick = () => {
      tr.focus({ preventScroll: true });
      openHistory();
    };
    tr.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openHistory();
      }
    };
    $("summary").append(tr);
  }
  if (!visible.length) {
    const tr = document.createElement("tr");
    cell(tr, loaded ? "ไม่พบสินค้าที่ตรงตัวกรอง" : "ยังไม่มีข้อมูล").colSpan =
      6;
    $("summary").append(tr);
  }
  $("page-info").textContent =
    `หน้า ${page + 1} / ${Math.max(1, Math.ceil(visible.length / size))}`;
  $("prev").disabled = page === 0;
  $("next").disabled = (page + 1) * size >= visible.length;
}
function showHistory(p) {
  selected = p;
  historyPage = 0;
  renderHistory();
  $("history").showModal();
}
function renderHistory() {
  const p = selected,
    rows = [...p.rows].sort((a, b) => b.index - a.index);
  $("history-title").textContent = p.product;
  $("history-subtitle").textContent =
    p.code + " · " + (p.customerCode || "ไม่พบรหัสลูกค้า");
  $("history-totals").textContent =
    `รับเข้า/ยกมา ${fmt(p.in)} · เบิกออก ${fmt(p.out)} · คงเหลือล่าสุด ${fmt(p.balance)} ${p.unit}`;
  $("history-rows").replaceChildren();
  for (const r of rows.slice(historyPage * size, (historyPage + 1) * size)) {
    const tr = document.createElement("tr");
    cell(tr, date(r.date));
    const documentCell = cell(tr, "");
    if (r.docNo) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "document-link";
      button.textContent = r.docNo;
      button.onclick = () => openDocument(r);
      documentCell.append(button);
    } else documentCell.textContent = "—";
    cell(
      tr,
      r.flag === 54
        ? "รับเข้า / ยกมา"
        : r.flag === 44
          ? "เบิกออก (ขาย)"
          : r.flag === 58
            ? "รับคืนจากเบิก"
            : r.type,
    );
    cell(
      tr,
      fmt(r.quantity) + " " + p.unit,
      r.type === "เบิกออก" ? "out-number" : "",
    );
    cell(tr, fmt(r.balance) + " " + p.unit);
    $("history-rows").append(tr);
  }
  $("history-page").textContent =
    `${fmt(rows.length)} รายการ · หน้า ${historyPage + 1} / ${Math.ceil(rows.length / size)}`;
  $("history-prev").disabled = historyPage === 0;
  $("history-next").disabled = (historyPage + 1) * size >= rows.length;
}
async function openDocument(row) {
  const dialog = $("document-detail"),
    body = $("document-rows");
  $("document-title").textContent = "เอกสาร " + row.docNo;
  $("document-subtitle").textContent = `${date(row.date)} · ${row.type}`;
  body.replaceChildren();
  $("document-status").textContent = "กำลังโหลดรายละเอียดเอกสาร…";
  dialog.showModal();
  try {
    const params = new URLSearchParams({
        docNo: row.docNo,
        date: row.date,
        flag: String(row.flag),
      }),
      response = await fetch("/api/consignment/document?" + params, {
        cache: "no-store",
      }),
      data = await response.json();
    if (!response.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
    $("document-status").textContent = data.rows.length
      ? `พบ ${fmt(data.rows.length)} รายการในเอกสาร`
      : "ไม่พบรายการในเอกสาร";
    for (const item of data.rows) {
      const tr = document.createElement("tr");
      cell(tr, item.code);
      cell(tr, item.product);
      cell(tr, fmt(item.quantity));
      cell(tr, item.unit);
      cell(tr, item.type);
      body.append(tr);
    }
  } catch (error) {
    $("document-status").textContent = error.message;
  }
}
async function load(silent = false) {
  let changed = false;
  if (!silent) {
    $("source").textContent = "กำลังโหลดข้อมูลสินค้าฝากจาก SML…";
    $("error").textContent = "";
  }
  try {
    const response = await fetch("/api/consignment", {
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      }),
      data = await response.json();
    if (!response.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
    if (!Array.isArray(data.rows)) throw new Error("ข้อมูลตอบกลับไม่ถูกต้อง");
    const nextSignature = JSON.stringify(data.rows);
    changed = nextSignature !== dataSignature;
    const grouped = new Map();
    for (const raw of data.rows) {
      const r = {
        ...raw,
        quantity: Number(raw.quantity),
        balance: Number(raw.balance),
        index: Number(raw.index),
      };
      if (
        !r.productCode ||
        !Number.isFinite(r.quantity) ||
        !Number.isFinite(r.balance) ||
        !Number.isFinite(r.index)
      )
        throw new Error("ข้อมูลจำนวนสินค้าไม่ถูกต้อง");
      let p = grouped.get(r.productCode);
      if (!p) {
        p = {
          code: r.productCode,
          product: r.product,
          customer: r.customer,
          customerCode: r.customerCode,
          region: regionFor(r.customer),
          unit: r.unit || "หน่วย",
          in: 0,
          out: 0,
          balance: 0,
          last: "",
          index: -1,
          rows: [],
        };
        grouped.set(r.productCode, p);
      }
      p.rows.push(r);
      if (r.type === "เบิกออก") p.out += r.quantity;
      else p.in += r.quantity;
      if (r.index > p.index) {
        p.index = r.index;
        p.balance = r.balance;
        p.last = r.date;
      }
    }
    products = [...grouped.values()];
    dataSignature = nextSignature;
    loaded = true;
    if (!silent) page = 0;
    options(
      "region",
      products.map((p) => p.region),
    );
    options(
      "customer",
      products.map((p) => p.customer.slice(0, 3)),
    );
    options(
      "unit",
      products.map((p) => p.unit),
    );
    // The Excel "source" line keeps its original wording; the header shows the shorter form.
    exportSource = `${data.source} · ${fmt(data.rows.length)} รายการ · อัปเดต ${new Date(data.updatedAt).toLocaleString("th-TH")}`;
    $("source").textContent =
      `เคลื่อนไหวสินค้าตามคลัง · ${fmt(data.rows.length)} รายการ · อัปเดต ${stamp(data.updatedAt)}`;
    $("source-state").dataset.state = "connected";
  } catch (e) {
    if (!silent || !loaded) {
      $("source").textContent = "โหลดข้อมูลไม่สำเร็จ";
      $("source-state").dataset.state = "failed";
      $("error").textContent =
        (e.name === "TimeoutError"
          ? "โหลดเกินเวลาที่กำหนด กรุณาลองใหม่"
          : e.message) + (loaded ? " · กำลังแสดงข้อมูลจากครั้งก่อน" : "");
    }
  } finally {
    if (!silent || changed) render();
  }
}
// Search waits 250 ms after typing; dropdowns filter at once. Cards dim briefly while filtering.
let searchTimer, fadeTimer;
function applyFilters() {
  clearTimeout(searchTimer);
  page = 0;
  render();
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(
    () => $("cs-kpis").classList.remove("is-filtering"),
    160,
  );
}
function filterChanged(delay) {
  $("cs-kpis").classList.add("is-filtering");
  clearTimeout(searchTimer);
  if (delay) searchTimer = setTimeout(applyFilters, delay);
  else applyFilters();
}
$("search").addEventListener("input", () => filterChanged(250));
for (const id of ["region", "customer", "unit", "stock"])
  $(id).addEventListener("change", () => filterChanged(0));
$("sort").addEventListener("change", () => {
  sortDirection = "desc";
  page = 0;
  render();
});
$("search").addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !$("search").value) return;
  event.preventDefault();
  $("search").value = "";
  filterChanged(0);
});
document.addEventListener("keydown", (event) => {
  if (
    event.key !== "/" ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.defaultPrevented ||
    document.querySelector("dialog[open]")
  )
    return;
  const focused = document.activeElement;
  if (
    focused?.isContentEditable ||
    focused?.closest?.("input, textarea, select")
  )
    return;
  event.preventDefault();
  $("search").focus();
  $("search").select();
});
document.querySelectorAll(".cs-card").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const box = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - box.left}px`);
    card.style.setProperty("--my", `${event.clientY - box.top}px`);
  });
  // Clicking anywhere on a card opens its explanation with current numbers; the footer link
  // and the (i) icon keep their own separate actions when clicked directly.
  const icon = card.querySelector(".cs-icon");
  if (!icon) return;
  card.classList.add("is-clickable");
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select")) return;
    if (String(window.getSelection?.() || "")) return;
    icon.click();
  });
});
const scrollToSection = (id) =>
  $(id).scrollIntoView({
    behavior: reducedMotion() ? "auto" : "smooth",
    block: "start",
  });
$("link-table").onclick = () => scrollToSection("movement");
$("link-regional").onclick = () => scrollToSection("regional");
$("link-in-stock").onclick = () => {
  $("stock").value = "positive";
  filterChanged(0);
};
$("link-history").onclick = () => latestVisible && showHistory(latestVisible);
$("export-excel").onclick = async () => {
  if (exporting || !visible.length) return;
  const snapshot = [...visible],
    filters = ["search", "region", "customer", "unit", "stock", "sort"].map(
      (id) => [id, $(id).value],
    );
  exporting = true;
  render();
  $("export-status").textContent = "กำลังสร้างไฟล์ Excel…";
  try {
    await exportConsignment(snapshot, filters, exportSource);
    $("export-status").textContent =
      `ส่งออก ${fmt(snapshot.length)} รหัสสินค้า พร้อมประวัติรับ–เบิกแล้ว`;
  } catch {
    $("export-status").textContent = "ส่งออกไม่สำเร็จ กรุณาลองใหม่";
  } finally {
    exporting = false;
    render();
  }
};
function resetFilters() {
  for (const id of filterIds) $(id).value = "";
  $("sort").value = "recent";
  filterChanged(0);
}
$("reset").onclick = resetFilters;
$("empty-reset").onclick = () => {
  resetFilters();
  $("search").focus();
};
$("prev").onclick = () => {
  page--;
  render();
};
$("next").onclick = () => {
  page++;
  render();
};
$("history-prev").onclick = () => {
  historyPage--;
  renderHistory();
};
$("history-next").onclick = () => {
  historyPage++;
  renderHistory();
};
$("close-history").onclick = () => $("history").close();
$("close-document").onclick = () => $("document-detail").close();
// Clicking the backdrop (outside the dialog's own padding) closes it, same as the × button.
for (const id of ["history", "document-detail"])
  $(id).addEventListener("click", (event) => {
    if (event.target === $(id)) $(id).close();
  });
render();
load();
setInterval(() => load(true), 60000);
