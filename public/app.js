const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const money = (value) => "฿" + number.format(Number(value));
const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
let charts = [],
  current = null,
  requestId = 0;
$("year").textContent = new Date().getFullYear();
// Re-evaluates the active quick range (e.g. "today" after midnight); a custom range stays as typed.
const setPeriod = () => window.overviewTop?.refreshPresetDates();
function cell(row, text, className = "") {
  const td = document.createElement("td");
  td.textContent = text;
  td.className = className;
  row.append(td);
  return td;
}
let productPage = 0;
const PAGE_SIZE = 5;
let invoicePage = 0,
  invoiceSearch = "";
const INVOICE_PAGE_SIZE = 25;
function renderProductPage(products) {
  const body = $("product-rows");
  body.replaceChildren();
  const total = products.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (productPage >= totalPages) productPage = totalPages - 1;
  if (productPage < 0) productPage = 0;
  const start = productPage * PAGE_SIZE;
  const pageItems = products.slice(start, start + PAGE_SIZE);
  const sum = products.reduce((n, p) => n + Number(p.sales), 0);
  pageItems.forEach((p, i) => {
    const globalIndex = start + i;
    const row = document.createElement("tr");
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = String(globalIndex + 1);
    cell(row, "").append(rank);
    cell(row, p.name || p.code, "product-name");
    cell(row, p.code);
    const quantityButton = document.createElement("button");
    quantityButton.type = "button";
    quantityButton.className = "quantity-link";
    quantityButton.textContent = `${number.format(p.quantity)} ${p.unit || ""}`;
    quantityButton.setAttribute("aria-label", `ดูบิลของ ${p.name || p.code}`);
    quantityButton.setAttribute("aria-haspopup", "dialog");
    quantityButton.setAttribute("aria-controls", "product-invoices");
    row.classList.add("product-invoice-row");
    row.addEventListener("click", () => {
      quantityButton.focus({ preventScroll: true });
      openProductInvoices(p);
    });
    cell(row, "", "text-right").append(quantityButton);
    cell(row, money(p.sales), "text-right font-medium");
    const percent = sum > 0 ? (Number(p.sales) / sum) * 100 : 0;
    const share = cell(row, "", "text-right"),
      track = document.createElement("span"),
      bar = document.createElement("i");
    track.className = "share";
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    track.append(bar);
    share.append(track, `${percent.toFixed(1)}%`);
    body.append(row);
  });
  if (!total) {
    const row = document.createElement("tr");
    const td = cell(row, "ไม่พบข้อมูลสินค้าในช่วงเวลาที่เลือก", "text-center");
    td.colSpan = 6;
    body.append(row);
  }
  $("product-pill").textContent =
    `${number.format(total)} รายการในช่วงที่เลือก`;
  $("product-page-info").textContent = total
    ? `แสดง ${start + 1}–${Math.min(start + PAGE_SIZE, total)} จาก ${total} รายการ`
    : "";
  $("product-prev").disabled = productPage <= 0;
  $("product-next").disabled = productPage >= totalPages - 1;
}
const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const shortThaiDate = (isoDate) => {
  if (!isoDate) return "—";
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  const text = d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }),
    yy = String((d.getFullYear() + 543) % 100).padStart(2, "0");
  return `${text} ${yy}`;
};
const thaiWeekday = (isoDate) => {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("th-TH", { weekday: "short" });
};
function billCountUp(el, target, delay = 0, formatter = number.format) {
  if (reducedMotion() || !Number.isFinite(target)) {
    el.textContent = formatter(target);
    return;
  }
  const duration = 500,
    start = performance.now() + delay;
  function step(now) {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    el.textContent = formatter(Math.round(target * t));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function billToast(text) {
  const box = $("product-invoices-toast");
  box.textContent = text;
  box.hidden = false;
  box.classList.remove("is-shown");
  void box.offsetWidth;
  box.classList.add("is-shown");
  clearTimeout(billToast.timer);
  billToast.timer = setTimeout(() => {
    box.classList.remove("is-shown");
    box.hidden = true;
  }, 1800);
}
async function copyBillText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    billToast(message);
  } catch {
    billToast("คัดลอกไม่สำเร็จ กรุณาคัดลอกเอง");
  }
}
let activeProduct = null,
  billSort = "recent",
  billDateFilter = null;
function openProductInvoices(product) {
  if (!current) return;
  try {
    activeProduct = product;
    billSort = "recent";
    billDateFilter = null;
    for (const b of $("product-invoices-sort").querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(b.dataset.sort === "recent"));
    $("product-invoices-title").textContent = product.name || product.code || "ไม่ระบุชื่อสินค้า";
    $("product-invoices-code").textContent = product.code || "ไม่ระบุรหัส";
    $("product-invoices-code").onclick = () =>
      copyBillText(product.code, `คัดลอกรหัสสินค้า ${product.code} แล้ว`);
    $("product-invoices-period").textContent =
      current.period?.start && current.period?.end
        ? current.period.start === current.period.end
          ? shortThaiDate(current.period.start)
          : `${shortThaiDate(current.period.start)} – ${shortThaiDate(current.period.end)}`
        : "";
    renderProductInvoices();
    $("product-invoices").showModal();
  } catch (error) {
    console.error("openProductInvoices failed", error);
    $("product-invoices-title").textContent = "เกิดข้อผิดพลาดในการแสดงบิล";
    $("product-invoices-empty").hidden = false;
    $("product-invoices-empty").textContent =
      "เกิดข้อผิดพลาด: " + (error?.message || String(error));
    if (!$("product-invoices").open) $("product-invoices").showModal();
  }
}
function renderBillChart(invoices) {
  const wrap = $("product-invoices-chart");
  wrap.replaceChildren();
  if (!current) return;
  const byDate = new Map();
  for (const inv of invoices) {
    const cur = byDate.get(inv.date) || { amount: 0, count: 0 };
    cur.amount += Number(inv.sales) || 0;
    cur.count += 1;
    byDate.set(inv.date, cur);
  }
  const days = [];
  for (
    let d = new Date(current.period.start + "T00:00:00"),
      end = new Date(current.period.end + "T00:00:00");
    d <= end;
    d.setDate(d.getDate() + 1)
  )
    days.push(iso(d));
  const max = Math.max(0, ...days.map((day) => byDate.get(day)?.amount || 0));
  $("product-invoices-chart-max").textContent = max ? money(max) : "฿0";
  $("product-invoices-chart-first").textContent = days.length
    ? shortThaiDate(days[0])
    : "";
  $("product-invoices-chart-last").textContent = days.length
    ? shortThaiDate(days[days.length - 1])
    : "";
  $("product-invoices-chart-mid").textContent = days.length
    ? shortThaiDate(days[Math.floor((days.length - 1) / 2)])
    : "";
  days.forEach((day, i) => {
    const info = byDate.get(day),
      hasSales = !!info && info.amount > 0,
      bar = document.createElement("button");
    bar.type = "button";
    bar.className =
      "cs-bill-bar" +
      (hasSales ? " has-sales" : "") +
      (hasSales && info.amount === max ? " is-max" : "") +
      (billDateFilter === day ? " is-selected" : "");
    bar.style.height = (hasSales ? Math.max(6, (info.amount / max) * 54) : 3) + "px";
    bar.style.animationDelay = Math.min(i, 40) * 8 + "ms";
    const label =
      thaiWeekday(day) +
      " " +
      shortThaiDate(day) +
      (hasSales
        ? ` · ${money(info.amount)} · ${number.format(info.count)} บิล`
        : " · ไม่มียอดขาย");
    bar.setAttribute("aria-label", label);
    if (hasSales)
      bar.onclick = () => {
        billDateFilter = billDateFilter === day ? null : day;
        renderProductInvoices();
      };
    let tip;
    bar.addEventListener("pointerenter", () => {
      tip = document.createElement("div");
      tip.className = "cs-bill-tip";
      tip.textContent = label;
      bar.append(tip);
    });
    bar.addEventListener("pointerleave", () => tip?.remove());
    wrap.append(bar);
  });
}
function renderProductInvoices() {
  const product = activeProduct;
  if (!product) return;
  const all = product.invoices || [],
    filtered = billDateFilter
      ? all.filter((inv) => inv.date === billDateFilter)
      : all,
    sorted = [...filtered].sort((a, b) =>
      billSort === "amount"
        ? Number(b.sales) - Number(a.sales)
        : b.date === a.date
          ? 0
          : b.date.localeCompare(a.date),
    );
  renderBillChart(all);
  const filterBox = $("product-invoices-filter");
  filterBox.hidden = !billDateFilter;
  if (billDateFilter)
    $("product-invoices-filter-label").textContent =
      `เฉพาะ ${shortThaiDate(billDateFilter)}`;
  const totalAmount = filtered.reduce((n, i) => n + Number(i.sales), 0),
    totalQty = filtered.reduce((n, i) => n + Number(i.quantity), 0),
    billCount = filtered.length;
  billCountUp($("product-invoices-amount"), totalAmount, 0, money);
  $("product-invoices-amount-avg").textContent = totalQty
    ? `เฉลี่ย ${money(totalAmount / totalQty)} / ${product.unit || "หน่วย"}`
    : "เฉลี่ย —";
  billCountUp($("product-invoices-qty"), totalQty, 120);
  $("product-invoices-qty-avg").textContent = billCount
    ? `เฉลี่ย ${number.format(totalQty / billCount)} ${product.unit || ""} / บิล`
    : "เฉลี่ย —";
  billCountUp($("product-invoices-count"), billCount, 240);
  $("product-invoices-count-avg").textContent = billCount
    ? `เฉลี่ย ${money(totalAmount / billCount)} / บิล`
    : "เฉลี่ย —";
  const maxAmt = Math.max(0, ...sorted.map((i) => Number(i.sales)));
  const list = $("product-invoice-rows");
  list.replaceChildren();
  $("product-invoices-empty").hidden = sorted.length > 0;
  sorted.forEach((invoice, i) => {
    const row = document.createElement("div");
    row.className = "cs-bill-row";
    row.style.animationDelay = Math.min(i, 20) * 25 + "ms";
    const dateCol = document.createElement("div");
    dateCol.className = "cs-bill-row-date";
    const dateStrong = document.createElement("strong");
    dateStrong.textContent = shortThaiDate(invoice.date);
    const dateSmall = document.createElement("small");
    dateSmall.textContent = thaiWeekday(invoice.date);
    dateCol.append(dateStrong, dateSmall);
    const docCol = document.createElement("div");
    docCol.className = "cs-bill-row-doc";
    const docBtn = document.createElement("button");
    docBtn.type = "button";
    docBtn.className = "cs-doc-btn";
    docBtn.textContent = invoice.docNo;
    docBtn.title = "คลิกเพื่อคัดลอกเลขบิล";
    docBtn.onclick = () =>
      copyBillText(invoice.docNo, `คัดลอกเลขบิล ${invoice.docNo} แล้ว`);
    docCol.append(docBtn);
    if (invoice.docNo) {
      const prefix = document.createElement("span");
      prefix.className = "cs-doc-prefix";
      prefix.textContent = invoice.docNo.slice(0, 2);
      docCol.append(prefix);
    }
    const qtyCol = document.createElement("div");
    qtyCol.className = "cs-bill-row-qty";
    qtyCol.textContent = `${number.format(invoice.quantity)} ${product.unit || ""}`;
    const amtCol = document.createElement("div");
    amtCol.className = "cs-bill-row-amt";
    const amtStrong = document.createElement("strong");
    amtStrong.textContent = money(invoice.sales);
    amtCol.append(amtStrong);
    if (Number(invoice.sales) === maxAmt && maxAmt > 0) {
      const topTag = document.createElement("span");
      topTag.className = "cs-bill-tag-top";
      topTag.textContent = "บิลใหญ่สุด";
      amtCol.append(topTag);
    }
    const track = document.createElement("div");
    track.className = "cs-bill-row-amt-track";
    const bar = document.createElement("i");
    bar.style.width =
      (maxAmt ? Math.max(4, (Number(invoice.sales) / maxAmt) * 100) : 0) + "%";
    track.append(bar);
    amtCol.append(track);
    row.append(dateCol, docCol, qtyCol, amtCol);
    list.append(row);
  });
  $("product-invoices-summary").textContent =
    `${number.format(billCount)} บิล · รวม ${number.format(totalQty)} ${product.unit || ""} · ${money(totalAmount)}`;
}
$("product-invoices-sort").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sort]");
  if (!button) return;
  billSort = button.dataset.sort;
  for (const b of $("product-invoices-sort").querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b === button));
  renderProductInvoices();
});
$("product-invoices-filter-clear").onclick = () => {
  billDateFilter = null;
  renderProductInvoices();
};
$("product-invoices-csv").onclick = () => {
  if (!activeProduct) return;
  const product = activeProduct,
    rows = [...(product.invoices || [])].sort((a, b) => a.date.localeCompare(b.date)),
    escape = (v) => {
      const text = String(v ?? "");
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    },
    header = ["วันที่", "เลขบิล", "จำนวนขาย", "ยอดขายสินค้า"],
    body = rows.map((r) => [r.date, r.docNo, r.quantity, r.sales]),
    csv = [header, ...body].map((row) => row.map(escape).join(",")).join("\r\n"),
    blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `product-invoices-${product.code}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
$("product-invoices").addEventListener("cancel", (event) => {
  if (billDateFilter) {
    event.preventDefault();
    billDateFilter = null;
    renderProductInvoices();
  }
});
$("close-product-invoices").addEventListener("click", () =>
  $("product-invoices").close(),
);
$("product-invoices").addEventListener("click", (event) => {
  if (event.target === $("product-invoices")) $("product-invoices").close();
});
function renderInvoiceRows(data) {
  const body = $("invoice-rows");
  body.replaceChildren();
  data.invoices.forEach((invoice) => {
    const row = document.createElement("tr");
    cell(
      row,
      new Date(invoice.date + "T00:00:00").toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    );
    cell(row, invoice.docNo);
    cell(row, invoice.customer || invoice.customerCode || "ไม่ระบุลูกค้า");
    cell(row, money(invoice.total), "text-right font-medium");
    body.append(row);
  });
  if (!data.invoices.length) {
    const row = document.createElement("tr"),
      td = cell(row, "ไม่พบบิลตามเงื่อนไขที่ค้นหา", "text-center");
    td.colSpan = 4;
    body.append(row);
  }
  const start = data.page * data.pageSize + 1;
  const end = Math.min((data.page + 1) * data.pageSize, data.total);
  $("invoice-page-info").textContent = data.total
    ? `แสดง ${start}–${end} จาก ${number.format(data.total)} บิล`
    : "ไม่พบรายการบิล";
  $("invoice-prev").disabled = data.page <= 0;
  $("invoice-next").disabled = end >= data.total;
  $("invoice-status").textContent =
    `อัปเดตรายการ ${new Date(data.updatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}
async function loadInvoices(page = 0) {
  if (!current?.period) {
    $("status").textContent = "กรุณาโหลดข้อมูลยอดขายก่อนดูรายการบิล";
    return;
  }
  invoicePage = Math.max(0, page);
  $("invoice-status").classList.remove("error");
  $("invoice-status").textContent = "กำลังดึงรายการบิล…";
  $("invoice-prev").disabled = true;
  $("invoice-next").disabled = true;
  const params = new URLSearchParams({
    start: current.period.start,
    end: current.period.end,
    page: invoicePage,
    pageSize: INVOICE_PAGE_SIZE,
    q: invoiceSearch,
  });
  try {
    const response = await fetch(`/api/invoices?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "โหลดรายการบิลไม่สำเร็จ");
    renderInvoiceRows(data);
  } catch (error) {
    $("invoice-status").textContent =
      error.name === "TimeoutError"
        ? "การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่"
        : error.message;
    $("invoice-status").classList.add("error");
    $("invoice-rows").replaceChildren();
    $("invoice-page-info").textContent = "";
  }
}
function openInvoices() {
  if (!current?.period) {
    $("status").textContent = "กรุณาโหลดข้อมูลยอดขายก่อนดูรายการบิล";
    return;
  }
  const dateLabel = (value) =>
    new Date(value + "T00:00:00").toLocaleDateString("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  $("invoice-dialog-period").textContent =
    current.period.start === current.period.end
      ? dateLabel(current.period.start)
      : `${dateLabel(current.period.start)} – ${dateLabel(current.period.end)}`;
  $("invoice-search").value = invoiceSearch;
  $("invoice-dialog").showModal();
  loadInvoices(0);
}
function render(data, silent = false) {
  $("total-sales").dataset.amount = String(data.totalSales);
  $("item-sales").dataset.amount = String(data.itemSales);
  if (!silent) productPage = 0;
  renderProductPage(data.products);
  $("updated").textContent =
    `อัปเดต ${new Date(data.updatedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`;
  charts.forEach((chart) => chart.destroy());
  charts = [];
  if (!window.Chart) return;
  Chart.defaults.font.family = "'Noto Sans Thai', Tahoma, sans-serif";
  const theme = window.dashboardTheme?.palette() || {
    muted: "#656973",
    line: "#e0e2e6",
    brand: "#e10600",
    surface: "#fff",
  };
  Chart.defaults.color = theme.muted;
  const options = () => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { intersect: false, mode: "index" },
    layout: { padding: { top: 8, right: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#482629",
        titleColor: "#f5dcd7",
        bodyColor: "#fff",
        padding: { top: 10, bottom: 10, left: 14, right: 14 },
        cornerRadius: 10,
        displayColors: false,
        titleFont: { size: 11, weight: "500" },
        bodyFont: { size: 13, weight: "600" },
        callbacks: { label: (ctx) => ` ${money(ctx.parsed.y)}` },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          font: { size: 10, weight: "500" },
          color: theme.muted,
          maxRotation: 0,
          maxTicksLimit: 7,
          padding: 6,
        },
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: theme.line, lineWidth: 1 },
        ticks: {
          font: { size: 10, weight: "500" },
          color: theme.muted,
          maxTicksLimit: 5,
          padding: 8,
          callback: (v) =>
            Math.abs(v) >= 1000000
              ? `${v / 1000000}m`
              : Math.abs(v) >= 1000
                ? `${v / 1000}k`
                : v,
        },
      },
    },
  });
  const warehouseColors = [
    "#813437",
    "#bb7261",
    "#cc9589",
    "#d9b7a6",
    "#e8c9bf",
    "#e8c9bf",
  ];
  const warehouseChart = document.getElementById("warehouse-chart");
  if (warehouseChart)
    charts.push(
      new Chart(warehouseChart, {
        type: "bar",
        data: {
          labels: data.warehouses.map((w) => w.name),
          datasets: [
            {
              data: data.warehouses.map((w) => Number(w.sales)),
              backgroundColor: data.warehouses.map((w, i) =>
                Number(w.sales) < 0
                  ? "#c34f52"
                  : warehouseColors[i % warehouseColors.length],
              ),
              borderRadius: 7,
              maxBarThickness: 42,
              borderSkipped: false,
            },
          ],
        },
        options: {
          ...options(),
          plugins: {
            ...options().plugins,
            tooltip: {
              ...options().plugins.tooltip,
              callbacks: { label: (ctx) => ` ${money(ctx.parsed.y)}` },
            },
          },
        },
      }),
    );
}
async function load(silent = false) {
  const id = ++requestId,
    start = $("start").value,
    end = $("end").value;
  silent = silent && !!current;
  if (!silent) {
    current = null;
    $("export").disabled = true;
    window.overviewTop?.clear();
  }
  if (!silent) $("product-invoices").close();
  $("status").classList.remove("error");
  if (
    !start ||
    !end ||
    start > end ||
    (Date.parse(end) - Date.parse(start)) / 86400000 > 365
  ) {
    $("status").textContent = "กรุณาเลือกช่วงวันที่ให้ถูกต้อง ไม่เกิน 366 วัน";
    $("status").classList.add("error");
    $("apply").disabled = false;
    window.overviewTop?.setLoading(false);
    return;
  }
  $("apply").disabled = true;
  $("status").textContent = "กำลังอัปเดตข้อมูลจาก SML…";
  if (!silent) $("display-period").textContent = "กำลังโหลดข้อมูล…";
  $("connection-badge").textContent = "SML · กำลังอัปเดต";
  $("connection-badge").dataset.state = "loading";
  window.overviewTop?.setLoading(true);
  try {
    let data;
    {
      if (location.protocol === "file:")
        throw new Error(
          "กรุณาเปิดผ่าน http://localhost:3001 เพื่อเชื่อมต่อ SML",
        );
      const response = await fetch(
        `/api/dashboard?${new URLSearchParams({ start, end })}`,
        { cache: "no-store", signal: AbortSignal.timeout(20000) },
      );
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new Error("ไม่พบ API กรุณาเริ่ม Backend ด้วย npm start");
      data = await response.json();
      if (!response.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
    }
    if (id !== requestId) return;
    if (!silent) {
      invoiceSearch = "";
      invoicePage = 0;
    }
    render(data, silent);
    window.overviewTop?.show(data, start, end, silent);
    window.salesTrend?.setDaily({ daily: data.daily, start, end }, silent);
    current = data;
    current.period = { start, end };
    $("export").disabled = false;
    window.loadSalesAnalysis?.(start, end, silent);
    $("connection-badge").textContent = "เชื่อมต่อ SML แล้ว";
    $("connection-badge").dataset.state = "connected";
    // The update time now sits in the range line; the status line only carries messages.
    $("status").textContent = "";
  } catch (error) {
    if (id !== requestId) return;
    $("connection-badge").textContent = "เชื่อมต่อไม่สำเร็จ";
    $("connection-badge").dataset.state = "failed";
    if (silent) {
      $("status").textContent = error.message;
      $("status").classList.add("error");
      return;
    }
    $("display-period").textContent = "ยังไม่มีข้อมูลล่าสุด";
    charts.forEach((chart) => chart.destroy());
    charts = [];
    window.salesTrend?.clearDaily("โหลดข้อมูลไม่สำเร็จ");
    window.overviewTop?.clear();
    $("product-rows").replaceChildren();
    $("invoice-rows").replaceChildren();
    $("invoice-page-info").textContent = "";
    $("updated").textContent = "ยังไม่ได้อัปเดต";
    $("status").textContent =
      error.name === "TimeoutError"
        ? "การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่"
        : error.message;
    $("status").classList.add("error");
  } finally {
    if (id === requestId) {
      $("apply").disabled = false;
      window.overviewTop?.setLoading(false);
    }
  }
}
$("filters").addEventListener("submit", (e) => {
  e.preventDefault();
  load();
});
$("product-prev").addEventListener("click", () => {
  if (current) {
    productPage--;
    renderProductPage(current.products);
  }
});
$("product-next").addEventListener("click", () => {
  if (current) {
    productPage++;
    renderProductPage(current.products);
  }
});
$("invoice-card").addEventListener("click", openInvoices);
$("close-invoices").addEventListener("click", () =>
  $("invoice-dialog").close(),
);
$("invoice-search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  invoiceSearch = $("invoice-search").value.trim();
  loadInvoices(0);
});
$("invoice-prev").addEventListener("click", () =>
  loadInvoices(invoicePage - 1),
);
$("invoice-next").addEventListener("click", () =>
  loadInvoices(invoicePage + 1),
);
$("export").addEventListener("click", () => {
  if (!current) return;
  const rows = [
    ["Period", current.period.start, current.period.end],
    ["Report", "4007 / 4014"],
    ["แหล่งข้อมูล", current.source],
    ["ยอดขายรวม", current.totalSales],
    ["จำนวนบิล", current.totalInvoices],
    [],
    ["วันที่", "ยอดขาย"],
    ...current.daily.map((d) => [d.day, d.sales]),
    [],
    ["คลังสินค้า", "ยอดขาย"],
    ...current.warehouses.map((w) => [w.name, w.sales]),
    [],
    ["รหัสสินค้า", "สินค้า", "จำนวน", "หน่วย", "ยอดขาย"],
    ...current.products.map((p) => [
      p.code,
      p.name,
      p.quantity,
      p.unit,
      p.sales,
    ]),
  ];
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? "");
          if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "sml-sales-dashboard.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("source").value = "live";
setPeriod();
load();

setInterval(() => {
  if (
    !document.hidden &&
    !$("apply").disabled &&
    !document.querySelector("dialog[open]")
  ) {
    setPeriod();
    load(true);
  }
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("apply").disabled) {
    setPeriod();
    load();
  }
});

window.addEventListener("dashboard-theme-change", () => {
  const theme = window.dashboardTheme.palette();
  for (const chart of charts) {
    for (const scale of Object.values(chart.options.scales || {})) {
      if (scale.ticks) scale.ticks.color = theme.muted;
      if (scale.grid) scale.grid.color = theme.line;
    }
    chart.data.datasets.forEach((dataset) => {
      dataset.borderColor = theme.brand;
    });
    chart.update("none");
  }
});
