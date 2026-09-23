const $ = (id) => document.getElementById(id);
const exportDialog = $("product-export-dialog");
// ตัวกรองสินค้าขายดีเป็นสิทธิ์แยก เริ่มต้นซ่อนไว้จนกว่าจะรู้ว่าบัญชีนี้ได้รับสิทธิ์
let canRankBestSellers = false;
window.addEventListener("prplus-access", (event) => {
  const allowed = event.detail?.role === "super_admin";
  $("open-export").hidden = !allowed;
  exportDialog.hidden = !allowed;
  if (!allowed && exportDialog.open) exportDialog.close();
  canRankBestSellers =
    allowed || !!event.detail?.permissions?.includes("best_sellers");
  $("product-best-field").hidden = !canRankBestSellers;
  if (!canRankBestSellers && $("product-best").value !== "off") {
    $("product-best").value = "off";
    applied = { ...applied, sort: "code", direction: "asc" };
    applyProductFilters();
  }
});
$("open-export").onclick = () => exportDialog.showModal();
$("close-export").onclick = () => exportDialog.close();
let exportBackdrop = false;
const outsideExport = (event) => {
  const bounds = exportDialog.getBoundingClientRect();
  return (
    event.target === exportDialog &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  );
};
exportDialog.addEventListener("pointerdown", (event) => {
  exportBackdrop = event.button === 0 && outsideExport(event);
});
exportDialog.addEventListener("click", (event) => {
  if (exportBackdrop && outsideExport(event)) exportDialog.close();
  exportBackdrop = false;
});
exportDialog.addEventListener("close", () => {
  exportBackdrop = false;
});
const exportStockLabel = document.createElement("label");
exportStockLabel.innerHTML =
  '<span>สถานะสินค้า</span><select id="export-stock"><option value="all">ทั้งหมด</option><option value="in">มีสินค้า</option><option value="out">ไม่มีสินค้า</option></select>';
exportDialog.querySelector(".export-controls")?.prepend(exportStockLabel);
exportStockLabel.querySelector("select").addEventListener("change", () => {
  $("product-stock").value = exportStockLabel.querySelector("select").value;
  applyProductFilters();
});
let current = null,
  applied = {
    q: "",
    group: "",
    subgroup: "",
    activity: "all",
    stock: "all",
    best: "off",
    sort: "code",
    direction: "asc",
  },
  version = 0,
  exporting = false;
const sortableHeaders = [];
for (const [index, sort] of [
  [6, "stock"],
  [7, "price"],
]) {
  const header = document.querySelectorAll(".product-panel thead th")[index];
  const button = document.createElement("button"),
    icon = document.createElement("span");
  button.type = "button";
  button.className = "product-sort";
  button.dataset.sort = sort;
  icon.className = "product-sort-icon";
  icon.textContent = "↕";
  icon.setAttribute("aria-hidden", "true");
  button.append(document.createTextNode(header.textContent), icon);
  header.replaceChildren(button);
  header.setAttribute("aria-sort", "none");
  sortableHeaders.push(header);
  button.onclick = () =>
    load(0, {
      ...applied,
      sort,
      direction:
        applied.sort === sort && applied.direction === "asc" ? "desc" : "asc",
    });
}
function updateSortHeaders() {
  for (const header of sortableHeaders) {
    const button = header.querySelector("button"),
      active = button.dataset.sort === applied.sort;
    header.setAttribute(
      "aria-sort",
      active
        ? applied.direction === "asc"
          ? "ascending"
          : "descending"
        : "none",
    );
    button.querySelector("span").textContent = active
      ? applied.direction === "asc"
        ? "▲"
        : "▼"
      : "↕";
  }
}
const textCell = (value) =>
  value == null || String(value).trim() === "" ? "—" : String(value).trim();
const priceLabel = (value) =>
  value == null || String(value).trim() === ""
    ? "—"
    : Number.isFinite(Number(value))
      ? Number(value).toLocaleString("th-TH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : String(value);
const stockLabel = (value) =>
  value == null || String(value).trim() === ""
    ? "—"
    : Number(value).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const stockStatus = (value) =>
  value == null || String(value).trim() === ""
    ? "—"
    : Number(value) > 0
      ? "มีสินค้า"
      : "ไม่มีสินค้า";
const count = (n) => Number(n).toLocaleString("th-TH");
function exportLabel() {
  $("download-products").textContent = exporting
    ? "กำลังสร้างไฟล์…"
    : `↓ ดาวน์โหลด ${current ? count(current.matching) : ""} สินค้า`;
}
async function load(page = 0, filters = applied, silent = false) {
  $("product-filtered-count").textContent = "กำลังโหลด…";
  const id = ++version;
  $("search-products").disabled = true;
  $("products-prev").disabled = true;
  $("products-next").disabled = true;
  $("download-products").disabled = true;
  $("product-status").classList.remove("error");
  if (!silent) $("product-status").textContent = "กำลังโหลดสินค้าจาก SML…";
  try {
    const r = await fetch(
      "/api/products?" + new URLSearchParams({ ...filters, page }),
      { cache: "no-store", signal: AbortSignal.timeout(20000) },
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (id !== version) return;
    current = data;
    applied = {
      ...filters,
      sort: data.sort ?? filters.sort,
      direction: data.direction ?? filters.direction,
    };
    updateSortHeaders();
    $("product-table").replaceChildren();
    $("product-count").textContent =
      `ตามตัวกรอง ${count(data.matching)} รายการ · ทั้งหมด ${count(data.total)} รายการ`;
    $("product-updated").textContent =
      "ดึงข้อมูล " + new Date(data.updatedAt).toLocaleString("th-TH");
    $("product-filtered-count").textContent =
      `พบ ${count(data.matching)} รายการ`;
    const selectedGroup = $("product-group").value;
    $("product-group").replaceChildren(new Option("ทุกกลุ่มสินค้า", ""));
    for (const g of data.groups)
      $("product-group").add(
        new Option(`${g.code} · ${g.name} (${count(g.count)})`, g.code),
      );
    $("product-group").value = selectedGroup;
    const subgroup = $("product-subgroup");
    const hasSubgroups = Array.isArray(data.subgroups);
    subgroup.replaceChildren(new Option(!hasSubgroups ? "กรุณารีสตาร์ต backend" : data.subgroups.length ? "ทุกกลุ่มสินค้าย่อย" : "ไม่มีกลุ่มย่อยในกลุ่มนี้", ""));
    for (const g of data.subgroups || [])
      subgroup.add(new Option(`${g.code} · ${g.name} (${count(g.count)})`, g.code));
    subgroup.value = filters.subgroup || "";
    subgroup.disabled = !data.subgroups?.length;
    const ranking = (data.best ?? "off") !== "off";
    document
      .querySelector(".product-panel table")
      .classList.toggle("ranked", ranking);
    for (const p of data.rows) {
      const tr = document.createElement("tr");
      const rank = document.createElement("td");
      rank.className = "rank-cell";
      rank.textContent =
        ranking && p.best_seller_rank != null
          ? count(p.best_seller_rank)
          : "—";
      tr.append(rank);
      const values = [
        p.code,
        p.name_1,
        p.group_main_name || p.group_main,
        p.unit_standard,
        p.activity_2568_2569,
        stockLabel(p.balance_qty),
        priceLabel(p.catalog_sale_price),
        stockStatus(p.balance_qty),
      ];
      for (const [index, v] of values.entries()) {
        const td = document.createElement("td");
        const text = textCell(v);
        if (index === 7) {
          const status = document.createElement("span");
          status.textContent = text;
          status.className =
            "stock-status " +
            (text === "มีสินค้า"
              ? "in-stock"
              : text === "ไม่มีสินค้า"
                ? "out-of-stock"
                : "unknown-stock");
          td.append(status);
        } else {
          td.textContent = text;
        }
        tr.append(td);
      }
      tr.tabIndex = 0;
      tr.className = "product-selectable-row";
      tr.setAttribute("aria-haspopup", "dialog");
      tr.setAttribute("aria-controls", "product-detail");
      tr.setAttribute("aria-label", `ดูรายละเอียด ${p.code} ${p.name_1}`);
      tr.onclick = () => detail(p);
      tr.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          detail(p);
        }
      };
      $("product-table").append(tr);
    }
    if (!data.rows.length) {
      const tr = document.createElement("tr"),
        td = document.createElement("td");
      td.colSpan = 9;
      td.textContent = "ไม่พบสินค้าตามตัวกรอง";
      tr.append(td);
      $("product-table").append(tr);
    }
    $("products-page").textContent =
      `หน้า ${data.page + 1} / ${Math.max(1, Math.ceil(data.matching / data.pageSize))} · หน้าละ ${data.pageSize} สินค้า`;
    $("products-prev").disabled = data.page === 0;
    $("products-next").disabled =
      (data.page + 1) * data.pageSize >= data.matching;
    $("product-status").textContent =
      `แสดงคอลัมน์หลักในตาราง · ดาวน์โหลดได้ครบ ${data.fields.length} คอลัมน์` +
      (ranking
        ? ` · เรียงตามยอดขายสุทธิ${data.best === "3m" ? " 3 เดือนก่อน" : "ทั้งหมด"} อันดับ 1 ก่อน`
        : "") +
      (!hasSubgroups ? " · backend ยังไม่รองรับกลุ่มย่อย กรุณารีสตาร์ตเซิร์ฟเวอร์แล้วโหลดหน้าใหม่" : "");
    $("download-products").disabled = exporting;
    exportLabel();
  } catch (e) {
    if (id !== version) return;
    if ($("product-subgroup").disabled)
      $("product-subgroup").replaceChildren(new Option("โหลดกลุ่มย่อยไม่สำเร็จ กดค้นหาเพื่อลองใหม่", ""));
    $("product-filtered-count").textContent =
      silent && current
        ? `ข้อมูลเดิม ${count(current.matching)} รายการ`
        : "โหลดไม่สำเร็จ";
    if (silent) {
      $("product-status").textContent =
        "อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลเดิม · " + e.message;
      return;
    }
    current = null;
    $("product-table").replaceChildren();
    $("product-updated").textContent = "";
    $("product-count").textContent = "โหลดข้อมูลไม่สำเร็จ";
    $("products-page").textContent = "";
    $("product-status").textContent =
      e.name === "TimeoutError"
        ? "การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่"
        : e.message;
    $("product-status").classList.add("error");
  } finally {
    if (id === version) {
      $("search-products").disabled = false;
      $("download-products").disabled = !current || exporting;
      $("products-prev").disabled = !current || current.page === 0;
      $("products-next").disabled =
        !current || (current.page + 1) * current.pageSize >= current.matching;
      exportLabel();
    }
  }
}
const bahtLabel = (value) =>
  value == null || String(value).trim() === ""
    ? "—"
    : Number(value).toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
let bestSellerRequest = 0;
async function loadBestSeller(code) {
  const panel = $("detail-bestseller");
  const id = ++bestSellerRequest;
  panel.replaceChildren();
  panel.append(
    detailNode("p", "อันดับสินค้าขายดี", "detail-bestseller-title"),
    detailNode("p", "กำลังดึงอันดับขายดีจาก SML…", "detail-bestseller-state"),
  );
  try {
    const r = await fetch(
      "/api/products/best-seller?" + new URLSearchParams({ code }),
      { cache: "no-store", signal: AbortSignal.timeout(20000) },
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (id !== bestSellerRequest) return;
    panel.replaceChildren(
      detailNode("p", "อันดับสินค้าขายดี", "detail-bestseller-title"),
    );
    if (!data.sold) {
      panel.append(
        detailNode(
          "p",
          "สินค้านี้ยังไม่มีรายการขายในระบบ จึงไม่ติดอันดับขายดี",
          "detail-bestseller-state",
        ),
      );
      return;
    }
    const standing = (label, place) =>
      place
        ? [label, `อันดับ ${count(place.rank)} จาก ${count(place.total)}`]
        : [label, "ไม่ติดอันดับ"];
    const metrics = [
      standing("อันดับขายดีทั้งหมด", data.all),
      standing("อันดับขายดี 3 เดือนล่าสุด", data.recent),
      ["ยอดขายสุทธิทั้งหมด (บาท)", bahtLabel(data.netAll)],
      ["ยอดขายสุทธิ 3 เดือน (บาท)", bahtLabel(data.netRecent)],
      ["ขายล่าสุด", data.lastSold ?? "—"],
      [
        "ใบขาย · ลูกค้า",
        `${count(data.invoices ?? 0)} ใบ · ${count(data.buyers ?? 0)} ราย`,
      ],
    ];
    const grid = detailNode("div", "", "detail-bestseller-grid");
    for (const [label, value] of metrics) {
      const card = detailNode("article", "", "product-detail-metric");
      if (label.startsWith("อันดับ") && value !== "ไม่ติดอันดับ")
        card.classList.add("status-info");
      card.append(detailNode("span", label), detailNode("strong", value));
      grid.append(card);
    }
    panel.append(
      grid,
      detailNode(
        "p",
        "อันดับคิดจากยอดขายสุทธิทั้งทะเบียน (ขาย + เพิ่มหนี้ − รับคืน) ไม่ขึ้นกับตัวกรองในตาราง · ไม่รวมสินค้าฝากขาย",
        "detail-bestseller-note",
      ),
    );
  } catch (e) {
    if (id !== bestSellerRequest) return;
    panel.replaceChildren(
      detailNode("p", "อันดับสินค้าขายดี", "detail-bestseller-title"),
      detailNode(
        "p",
        e.name === "TimeoutError"
          ? "ดึงอันดับขายดีนานเกินไป กรุณาปิดแล้วเปิดใหม่"
          : e.message,
        "detail-bestseller-state error",
      ),
    );
  }
}
function detailNode(tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
const hasMeaningfulValue = (value) =>
  value !== null && value !== undefined && String(value).trim() !== "";
function detail(product) {
  const summaryMetrics = [
    ["ราคาขายในทะเบียน (บาท)", priceLabel(product.catalog_sale_price)],
    [
      "คงเหลือในทะเบียน",
      `${stockLabel(product.balance_qty)} ${product.unit_standard || ""}`,
    ],
    ["สถานะคงเหลือ", stockStatus(product.balance_qty)],
    ["การเคลื่อนไหว", product.activity_2568_2569],
  ].filter(
    ([, value]) => hasMeaningfulValue(value) && String(value).trim() !== "—",
  );
  $("detail-title").textContent = product.name_1 || product.code;
  const summary = $("detail-summary");
  summary.replaceChildren();
  for (const [label, value] of summaryMetrics) {
    const card = detailNode("article", "", "product-detail-metric");
    const status =
      label === "สถานะคงเหลือ"
        ? value === "มีสินค้า"
          ? "status-good"
          : value === "ไม่มีสินค้า"
            ? "status-bad"
            : "status-neutral"
        : label === "การเคลื่อนไหว" && value && value !== "ไม่ระบุ"
          ? "status-info"
          : "";
    if (status) card.classList.add(status);
    card.append(detailNode("span", label), detailNode("strong", value));
    summary.append(card);
  }
  // Keep this quick-view focused on the summary cards; full SML field values are intentionally omitted.
  $("detail-fields").replaceChildren();
  $("detail-subtitle").textContent =
    `รหัส ${product.code} · ข้อมูลทะเบียนปัจจุบัน · ดึงข้อมูล ${new Date(current.updatedAt).toLocaleString("th-TH")}`;
  $("product-detail").showModal();
  $("product-detail").scrollTop = 0;
  if (canRankBestSellers) loadBestSeller(product.code);
  else $("detail-bestseller").replaceChildren();
}
$("close-detail").onclick = () => $("product-detail").close();
const productDialog = $("product-detail");
let backdropPress = false;
function outsideProductDialog(event) {
  const bounds = productDialog.getBoundingClientRect();
  return (
    event.target === productDialog &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  );
}
productDialog.addEventListener("pointerdown", (event) => {
  backdropPress = event.button === 0 && outsideProductDialog(event);
});
productDialog.addEventListener("click", (event) => {
  if (backdropPress && outsideProductDialog(event)) productDialog.close();
  backdropPress = false;
});
productDialog.addEventListener("pointercancel", () => {
  backdropPress = false;
});
productDialog.addEventListener("close", () => {
  backdropPress = false;
  bestSellerRequest++;
});
function applyProductFilters() {
  const filters = {
    q: $("product-search").value.trim(),
    group: $("product-group").value,
    subgroup: $("product-subgroup").value,
    activity: $("product-activity").value,
    stock: $("product-stock").value,
    best: $("product-best").value,
    sort: applied.sort,
    direction: applied.direction,
  };
  const exportStock = $("export-stock");
  if (exportStock) exportStock.value = filters.stock;
  $("export-scope").value =
    filters.q || filters.group || filters.subgroup || filters.best !== "off"
      ? "filtered"
      : filters.activity;
  load(0, filters);
}
$("product-filters").onsubmit = (e) => {
  e.preventDefault();
  applyProductFilters();
};
$("clear-products").onclick = () => {
  $("product-search").value = "";
  $("product-group").value = "";
  resetSubgroups();
  $("product-activity").value = "all";
  $("product-stock").value = "all";
  $("product-best").value = "off";
  applied = { ...applied, sort: "code", direction: "asc" };
  applyProductFilters();
};
$("products-prev").onclick = () => {
  if (current) load(current.page - 1);
};
$("products-next").onclick = () => {
  if (current) load(current.page + 1);
};
$("export-scope").onchange = () => {
  const scope = $("export-scope").value;
  if (scope === "filtered") {
    applyProductFilters();
    return;
  }
  $("product-search").value = "";
  $("product-group").value = "";
  resetSubgroups();
  $("product-activity").value = scope;
  applyProductFilters();
};
$("download-products").onclick = async () => {
  if (!current || exporting || $("search-products").disabled) return;
  exporting = true;
  exportLabel();
  $("download-products").disabled = true;
  $("download-status").classList.remove("error");
  $("download-status").textContent =
    "กำลังสร้างไฟล์สินค้าทุกแถวตามขอบเขตที่เลือก…";
  const format = $("export-format").value,
    scope = "filtered";
  try {
    const r = await fetch(
      "/api/products/export?" +
        new URLSearchParams({ ...applied, format, scope }),
      { cache: "no-store", signal: AbortSignal.timeout(120000) },
    );
    if (!r.ok) {
      const e = await r.json();
      throw new Error(e.error);
    }
    const blob = await r.blob(),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download =
      r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ||
      `sml-products.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("download-status").textContent =
      `ดาวน์โหลด ${count(r.headers.get("X-Product-Count"))} สินค้าเป็น ${format.toUpperCase()} สำเร็จ`;
  } catch (e) {
    $("download-status").textContent =
      e.name === "TimeoutError" ? "สร้างไฟล์นานเกินไป กรุณาลองใหม่" : e.message;
    $("download-status").classList.add("error");
  } finally {
    exporting = false;
    $("download-products").disabled = !current || $("search-products").disabled;
    exportLabel();
  }
};
load();
setInterval(() => {
  if (
    !document.hidden &&
    !$("search-products").disabled &&
    !exporting &&
    !$("product-detail").open
  )
    load(current?.page || 0, applied, true);
}, 60000);

function resetSubgroups() {
  $("product-subgroup").replaceChildren(new Option("กำลังโหลดกลุ่มย่อย…", ""));
  $("product-subgroup").disabled = true;
}
$("product-group").onchange = () => {
  resetSubgroups();
  applyProductFilters();
};
$("product-subgroup").onchange = applyProductFilters;
$("product-activity").onchange = applyProductFilters;
// เปิดจัดอันดับ = เรียงยอดขายสุทธิมากไปน้อย, ปิดแล้วกลับไปเรียงรหัสสินค้า
$("product-best").onchange = () => {
  const ranking = $("product-best").value !== "off";
  applied = {
    ...applied,
    sort: ranking ? "best" : "code",
    direction: ranking ? "desc" : "asc",
  };
  applyProductFilters();
};
const stockFilter = document.createElement("label");
stockFilter.innerHTML =
  '<span>สถานะสินค้า</span><select id="product-stock"><option value="all">ทั้งหมด</option><option value="in">มีสินค้า</option><option value="out">ไม่มีสินค้า</option></select>';
$("product-activity").closest("label").after(stockFilter);
stockFilter.querySelector("select").onchange = applyProductFilters;
