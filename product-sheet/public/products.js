const get = (id) => document.getElementById(id);
const size = 10;
// source: "sheet" = ไฟล์ WooCommerce, "sml" = คลังจาก SML
const columns = [
  { name: "รหัสสินค้า", source: "sheet", width: 120, kind: "code" },
  { name: "ชื่อ", source: "sheet", width: 240, kind: "name" },
  { name: "คำอธิบาย", source: "sheet", long: true, width: 300 },
  { name: "น้ำหนัก (กก.)", source: "sheet", number: true, width: 80 },
  { name: "ยาว (ซม.)", header: "ยาว (เซนติเมตร)", source: "sheet", number: true, width: 72 },
  { name: "กว้าง (ซม.)", header: "กว้าง (เซนติเมตร)", source: "sheet", number: true, width: 72 },
  { name: "สูง (ซม.)", header: "สูง (เซนติเมตร)", source: "sheet", number: true, width: 72 },
  { name: "ราคาปกติ", source: "sheet", number: true, width: 96, kind: "price" },
  { name: "คลัง", source: "sml", number: true, width: 110, kind: "stock" },
  { name: "หมวดหมู่", source: "sheet", width: 200, kind: "tags" },
  { name: "ไฟล์รูปภาพ", source: "sheet", width: 150, kind: "images" },
];
let rows = [],
  filteredRows = [],
  page = 0;

function stripHtml(value) {
  return new DOMParser()
    .parseFromString(value, "text/html")
    .body.textContent.replace(/\s+/g, " ")
    .trim();
}

function content(td, column, value, stock) {
  if (column.kind === "stock") {
    const pill = document.createElement("span");
    const qty = stock && stock.qty != null ? Number(stock.qty) : NaN;
    pill.className = `pill ${Number.isFinite(qty) ? (qty > 0 ? "in" : "out") : "none"}`;
    pill.textContent = value;
    return td.append(pill);
  }
  if (!value) {
    td.innerHTML = '<span class="empty">—</span>';
    return;
  }
  if (column.long) {
    const preview = document.createElement("div");
    preview.className = "clamp";
    preview.textContent = stripHtml(value);
    return td.append(preview);
  }
  if (column.kind === "price") {
    const number = Number(value.replace(/,/g, ""));
    td.textContent = Number.isFinite(number)
      ? `฿${number.toLocaleString("th-TH")}`
      : value;
    return;
  }
  if (column.kind === "tags") {
    for (const tag of value.split(",").map((t) => t.trim()).filter(Boolean)) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag.split(">").pop().trim();
      span.title = tag;
      td.append(span);
    }
    return;
  }
  if (column.kind === "images") {
    const links = value.match(/https?:\/\/[^,\s]+/g) || [];
    links.forEach((href, i) => {
      const link = document.createElement("a");
      link.className = "img-link";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `รูป ${i + 1}`;
      link.title = href;
      td.append(link);
    });
    if (!links.length) td.textContent = value;
    return;
  }
  td.textContent = value;
}

function cell(tag, text) {
  const node = document.createElement(tag);
  let end = 0;
  for (const match of String(text).matchAll(/https?:\/\/[^,\s]+/g)) {
    node.append(document.createTextNode(text.slice(end, match.index)));
    const link = document.createElement("a");
    link.href = match[0];
    link.textContent = match[0];
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    node.append(link);
    end = match.index + match[0].length;
  }
  node.append(document.createTextNode(String(text).slice(end)));
  return node;
}

function render() {
  const body = get("rows");
  body.replaceChildren();
  filteredRows.slice(page * size, (page + 1) * size).forEach((item) => {
    const tr = document.createElement("tr");
    item.values.forEach((value, index) => {
      const column = columns[index];
      const td = document.createElement("td");
      // คำอธิบายแสดงย่อ 3 บรรทัด ค่าเต็ม (รวม HTML) ดูได้ในช่อง fx
      content(td, column, value, item.stock);
      if (column.number) td.classList.add("number");
      if (column.kind === "code" || column.kind === "name")
        td.classList.add(column.kind);
      td.tabIndex = 0;
      td.addEventListener("focus", () => {
        get("cell-name").textContent = column.name;
        get("cell-value").value = value;
      });
      tr.append(td);
    });
    body.append(tr);
  });
  const total = filteredRows.length,
    start = total ? page * size + 1 : 0,
    end = Math.min((page + 1) * size, total);
  get("page-info").textContent =
    `รายการ ${start}–${end} จาก ${total.toLocaleString("th-TH")}`;
  get("prev").disabled = page === 0;
  get("next").disabled = (page + 1) * size >= total;
  document.querySelector(".sheet-scroll").scrollTop = 0;
}

function search() {
  const query = get("search").value.trim().toLocaleLowerCase();
  const stockFilter = get("filter-stock").value,
    category = get("filter-category").value;
  const presence = [...document.querySelectorAll(".column-filters select")]
    .map((select, index) => [index, select.value])
    .filter(([, value]) => value !== "all");
  filteredRows = rows.filter(
    (item) =>
      presence.every(
        ([index, value]) => (value === "has") === item.filled[index],
      ) &&
      (stockFilter === "all" || stockFilter === item.stockState) &&
      (!category || item.categories.includes(category)) &&
      (!query ||
        item.values.some((value) => value.toLocaleLowerCase().includes(query))),
  );
  page = 0;
  get("count").textContent =
    `${filteredRows.length.toLocaleString("th-TH")} / ${rows.length.toLocaleString("th-TH")} รายการ`;
  render();
}

get("prev").onclick = () => {
  page--;
  render();
};
get("next").onclick = () => {
  page++;
  render();
};
get("search").addEventListener("input", search);
for (const id of ["filter-stock", "filter-category"])
  get(id).addEventListener("change", search);
get("reset-filters").onclick = () => {
  document.querySelectorAll(".column-filters select").forEach((select, i) => {
    select.value = i === 0 ? "has" : "all";
    select.classList.toggle("active", i === 0);
  });
  get("filter-stock").value = "all";
  get("filter-category").value = "";
  search();
};
get("clear-search").onclick = () => {
  get("search").value = "";
  search();
  get("search").focus();
};

async function json(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function formatQty(stock) {
  if (!stock) return "ไม่พบใน SML";
  if (stock.qty === null || stock.qty === undefined) return "ไม่มีข้อมูล";
  const qty = Number(stock.qty);
  const text = Number.isFinite(qty)
    ? qty.toLocaleString("th-TH", { maximumFractionDigits: 2 })
    : String(stock.qty);
  return stock.unit ? `${text} ${stock.unit}` : text;
}

const typeOrder = { simple: 0, variation: 1, variable: 2 };

function renderUnmatched() {
  const list = rows
    .filter((item) => item.code && item.stockState === "missing")
    .sort(
      (a, b) =>
        (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3) ||
        a.code.localeCompare(b.code),
    );
  get("unmatched-count").textContent = `${list.length} รหัส`;
  const body = get("unmatched-rows");
  body.replaceChildren();
  if (!list.length) {
    const tr = document.createElement("tr");
    const td = cell("td", "รหัสทุกตัวในไฟล์ตรงกับ SML แล้ว");
    td.colSpan = 5;
    tr.append(td);
    return body.append(tr);
  }
  for (const item of list) body.append(unmatchedRow(item));
}

function unmatchedRow(item) {
  const tr = document.createElement("tr");
  const badge = document.createElement("span");
  badge.className = `type-badge ${item.type}`;
  badge.textContent = item.type || "-";
  const typeCell = document.createElement("td");
  typeCell.append(badge);
  const select = document.createElement("select");
  select.append(new Option("คลิกเพื่อโหลดรหัสจาก SML…", ""));
  let loaded = false;
  const loadSuggestions = async () => {
    if (loaded) return;
    loaded = true;
    select.options[0].text = "กำลังค้นหา…";
    try {
      const result = await json(
        `api/sml-suggest?code=${encodeURIComponent(item.code)}`,
      );
      select.options[0].text = result.rows.length
        ? `เลือกรหัส (${result.rows.length} รายการ ขึ้นต้น ${result.prefix})`
        : "ไม่พบรหัสใกล้เคียงใน SML";
      for (const s of result.rows)
        select.append(
          new Option(`${s.code} — ${s.name} (คลัง ${formatQty(s)})`, s.code),
        );
    } catch (error) {
      loaded = false;
      select.options[0].text = `โหลดไม่สำเร็จ: ${error.message}`;
    }
  };
  select.addEventListener("focus", loadSuggestions);
  select.addEventListener("mousedown", loadSuggestions);
  const pickCell = document.createElement("td");
  pickCell.append(select);
  const message = document.createElement("span");
  message.className = "row-msg";
  pickCell.append(message);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "บันทึก";
  save.onclick = async () => {
    if (!select.value) {
      message.className = "row-msg err";
      message.textContent = "กรุณาเลือกรหัสจาก SML ก่อน";
      return;
    }
    if (!confirm(`เปลี่ยนรหัส ${item.code} เป็น ${select.value} ในไฟล์ Excel?`))
      return;
    save.disabled = select.disabled = true;
    message.className = "row-msg";
    message.textContent = "กำลังบันทึก…";
    try {
      const result = await json("api/update-sku", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldCode: item.code, newCode: select.value }),
      });
      const stockResult = await json("api/sml-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: [result.newCode] }),
      });
      applyNewCode(item, result.newCode, stockResult.stock[result.newCode.toLowerCase()]);
      message.className = "row-msg ok";
      message.textContent = `บันทึกแล้ว: ${result.newCode}${result.children ? ` (แก้ "หลัก" ของตัวเลือก ${result.children} แถว)` : ""}`;
      setTimeout(() => {
        renderUnmatched();
        search();
      }, 1200);
    } catch (error) {
      save.disabled = select.disabled = false;
      message.className = "row-msg err";
      message.textContent = error.message;
    }
  };
  const actionCell = document.createElement("td");
  actionCell.append(save);
  tr.append(cell("td", item.code), typeCell, cell("td", item.values[1]), pickCell, actionCell);
  tr.firstChild.className = "code";
  return tr;
}

function applyNewCode(item, newCode, stock) {
  const codeIndex = columns.findIndex((c) => c.kind === "code");
  const stockIndex = columns.findIndex((c) => c.kind === "stock");
  item.code = newCode;
  item.values[codeIndex] = newCode;
  item.stock = stock || null;
  item.values[stockIndex] = formatQty(stock);
  item.filled[stockIndex] = stock != null && stock.qty != null;
  const qty = stock && stock.qty != null ? Number(stock.qty) : NaN;
  item.stockState = !stock
    ? "missing"
    : Number.isFinite(qty)
      ? qty > 0
        ? "in"
        : "out"
      : "unknown";
}

(async () => {
  try {
    const data = await json("api/sheet");
    const headers = data.headers.map((header) => String(header).trim());
    const indexes = columns.map((c) =>
      c.source === "sheet" ? headers.indexOf(c.header || c.name) : -1,
    );
    const missing = columns.filter(
      (c, i) => c.source === "sheet" && indexes[i] < 0,
    );
    const head = document.createElement("tr");
    const colgroup = get("columns");
    columns.forEach((c) => {
      const th = cell("th", c.name);
      if (c.source !== "sheet") th.className = `from-${c.source}`;
      if (c.number) th.classList.add("number");
      head.append(th);
      const col = document.createElement("col");
      col.style.width = `${c.width}px`;
      colgroup.append(col);
    });
    // แถวตัวกรอง "มี/ไม่มีข้อมูล" รายคอลัมน์ (รหัสสินค้าเริ่มที่ "มีข้อมูล" เพื่อซ่อนแถวที่ไม่มีรหัส)
    const filterRow = document.createElement("tr");
    filterRow.className = "column-filters";
    columns.forEach((c, i) => {
      const th = document.createElement("th");
      const select = document.createElement("select");
      select.setAttribute("aria-label", `กรองคอลัมน์ ${c.name}`);
      select.append(
        new Option("ทั้งหมด", "all"),
        new Option("มีข้อมูล", "has"),
        new Option("ไม่มีข้อมูล", "none"),
      );
      select.value = i === 0 ? "has" : "all";
      select.classList.toggle("active", i === 0);
      select.addEventListener("change", () => {
        select.classList.toggle("active", select.value !== "all");
        search();
      });
      th.append(select);
      filterRow.append(th);
    });
    get("head").replaceChildren(head, filterRow);

    const codes = data.rows.map((row) =>
      String(row[headers.indexOf("รหัสสินค้า")] ?? "").trim(),
    );
    const notes = [];
    if (missing.length)
      notes.push(`ไม่พบคอลัมน์ในไฟล์: ${missing.map((c) => c.name).join(", ")}`);
    const [sml] = await Promise.allSettled([
      json("api/sml-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: [...new Set(codes.filter(Boolean))] }),
      }),
    ]);
    if (sml.status === "rejected") notes.push(`คลัง: ${sml.reason.message}`);
    else
      notes.push(
        `คลังจาก SML (ยอดคงเหลือในทะเบียน) ณ ${new Date(sml.value.updatedAt).toLocaleString("th-TH")}`,
      );

    rows = data.rows.map((row, r) => {
      const key = codes[r].toLocaleLowerCase();
      const stock =
        sml.status === "fulfilled" && key ? sml.value.stock[key] : null;
      const values = columns.map((c, i) => {
        if (c.source === "sheet") return indexes[i] < 0 ? "" : String(row[indexes[i]] ?? "");
        if (!key) return "";
        return sml.status === "fulfilled" ? formatQty(stock) : "โหลดไม่สำเร็จ";
      });
      const qty = stock && stock.qty != null ? Number(stock.qty) : NaN;
      const categoryIndex = columns.findIndex((c) => c.kind === "tags");
      return {
        values,
        stock,
        code: codes[r],
        type: String(row[headers.indexOf("ชนิด")] ?? "").trim(),
        // คลัง "มีข้อมูล" = พบใน SML และ balance_qty ไม่เป็น NULL (0 นับว่ามีข้อมูล)
        filled: columns.map((c, i) =>
          c.kind === "stock"
            ? stock != null && stock.qty != null
            : values[i].trim() !== "",
        ),
        // ไม่มีรหัส / โหลด SML ไม่ได้ จะไม่ตรงกับตัวกรองคลังใดๆ นอกจาก "ทั้งหมด"
        stockState:
          !key || sml.status !== "fulfilled"
            ? "unknown"
            : !stock
              ? "missing"
              : Number.isFinite(qty)
                ? qty > 0
                  ? "in"
                  : "out"
                : "unknown",
        categories: values[categoryIndex]
          .split(",")
          .map((t) => t.split(">").pop().trim())
          .filter(Boolean),
      };
    });
    const select = get("filter-category");
    const counts = new Map();
    rows.forEach((r) =>
      r.categories.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1)),
    );
    [...counts]
      .sort((a, b) => a[0].localeCompare(b[0], "th"))
      .forEach(([name, n]) => select.append(new Option(`${name} (${n})`, name)));
    if (sml.status === "fulfilled") renderUnmatched();
    else get("unmatched-count").textContent = "ตรวจสอบไม่ได้ (โหลด SML ไม่สำเร็จ)";
    get("status").textContent = [...notes, "แสดงหน้าละ 10 รายการ"].join(" · ");
    search();
  } catch (error) {
    get("count").textContent = "โหลดข้อมูลไม่สำเร็จ";
    get("status").textContent = `เกิดข้อผิดพลาด: ${error.message}`;
  }
})();
