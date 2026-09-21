const get = (id) => document.getElementById(id);
const size = 100;
let data,
  page = 0,
  filteredRows = [];
let editingProduct = null;

function letter(index) {
  let result = "";
  for (index++; index > 0; index = Math.floor((index - 1) / 26))
    result = String.fromCharCode(65 + ((index - 1) % 26)) + result;
  return result;
}

function cell(tag, text) {
  const node = document.createElement(tag);
  if (tag === "td" && /^https?:\/\//.test(text)) {
    let end = 0;
    for (const match of text.matchAll(/https?:\/\/[^,\s]+/g)) {
      node.append(document.createTextNode(text.slice(end, match.index)));
      const link = document.createElement("a");
      link.href = match[0];
      link.textContent = match[0];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      node.append(link);
      end = match.index + match[0].length;
    }
    node.append(document.createTextNode(text.slice(end)));
  } else node.textContent = text;
  return node;
}

function render() {
  const body = get("rows");
  body.replaceChildren();
  filteredRows
    .slice(page * size, (page + 1) * size)
    .forEach(({ row, rowNumber }) => {
      const tr = document.createElement("tr"),
        number = rowNumber + 2,
        th = cell("th", number);
      th.className = "row-number";
      th.scope = "row";
      tr.append(th);
      row.forEach((value, index) => {
        const td = cell("td", value);
        td.tabIndex = 0;
        td.addEventListener("focus", () => {
          get("cell-name").textContent = letter(index) + number;
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
  filteredRows = data.rows
    .map((row, rowNumber) => ({ row, rowNumber }))
    .filter(
      ({ row }) =>
        !query ||
        row.some((value) => String(value).toLocaleLowerCase().includes(query)),
    );
  page = 0;
  get("count").textContent =
    `${filteredRows.length.toLocaleString("th-TH")} / ${data.rows.length.toLocaleString("th-TH")} รายการ · ${data.headers.length} คอลัมน์`;
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
get("clear-search").onclick = () => {
  get("search").value = "";
  search();
  get("search").focus();
};

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${String(value).slice(0, 10)}T00:00:00+07:00`));
}

function compactNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(value);
}

async function loadMissingProducts() {
  const body = get("missing-rows");
  get("missing-count").textContent = "กำลังตรวจสอบ…";
  get("refresh-missing").disabled = true;
  body.replaceChildren();
  const loading = document.createElement("tr");
  const loadingCell = cell("td", "กำลังตรวจสอบข้อมูลจาก SML…");
  loadingCell.colSpan = 6;
  loadingCell.className = "missing-empty";
  loading.append(loadingCell);
  body.append(loading);
  try {
    const response = await fetch("/api/missing-products", {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    get("missing-count").textContent =
      `${result.count.toLocaleString("th-TH")} รายการ`;
    get("missing-period").textContent =
      `ตั้งแต่ ${formatDate(result.start)} ถึง ${formatDate(result.end)}`;
    body.replaceChildren();
    if (!result.rows.length) {
      const row = document.createElement("tr"),
        empty = cell("td", "สินค้าครบแล้ว ไม่พบรายการที่ยังไม่มีใน Excel");
      empty.colSpan = 6;
      empty.className = "missing-empty";
      row.append(empty);
      body.append(row);
    } else
      result.rows.forEach((product) => {
        const row = document.createElement("tr");
        [
          product.code,
          product.name,
          product.unit,
          product.product_group,
          formatDate(product.created_date),
        ].forEach((value) => row.append(cell("td", String(value ?? ""))));
        const action = document.createElement("td"),
          button = document.createElement("button");
        button.type = "button";
        button.className = "add-product";
        button.textContent = "แก้ไขและเพิ่ม";
        button.onclick = () => openProductEditor(product);
        action.append(button);
        row.append(action);
        body.append(row);
      });
  } catch (error) {
    get("missing-count").textContent = "ตรวจสอบไม่สำเร็จ";
    body.replaceChildren();
    const row = document.createElement("tr"),
      failed = cell("td", error.message || "ตรวจสอบสินค้าใหม่ไม่สำเร็จ");
    failed.colSpan = 6;
    failed.className = "missing-empty";
    row.append(failed);
    body.append(row);
  } finally {
    get("refresh-missing").disabled = false;
  }
}

get("refresh-missing").onclick = loadMissingProducts;
loadMissingProducts();

function openProductEditor(product) {
  if (!data) return;
  editingProduct = product;
  const price = product.regular_price
    ? `${Number(product.regular_price).toLocaleString("th-TH")} บาท`
    : "ไม่มีราคาขาย";
  const stock =
    product.stock_quantity === null || product.stock_quantity === undefined
      ? "ไม่มีข้อมูลคงเหลือ"
      : `คงเหลือ ${Number(product.stock_quantity).toLocaleString("th-TH")} ${product.unit || ""}`.trim();
  get("editor-product-name").textContent =
    `${product.code} · ${product.name} · ${price} · ${stock}`;
  get("editor-message").textContent = "";
  const fields = get("editor-fields");
  fields.replaceChildren();
  const values = data.headers.map(() => "");
  const sourceValues = {
    รหัสสินค้า: product.code,
    ชื่อ: product.name,
    คำอธิบายแบบย่อ: product.remark,
    คำอธิบาย: product.description,
    "มีสินค้าในคลังสินค้า?": Number(product.stock_quantity) > 0 ? "1" : "0",
    คลังสินค้า: compactNumber(product.stock_quantity),
    ราคาปกติ: compactNumber(product.regular_price),
    หมวดหมู่: product.product_group,
    แบรนด์: product.brand,
  };
  data.headers.forEach((header, index) => {
    if (sourceValues[header] !== null && sourceValues[header] !== undefined)
      values[index] = String(sourceValues[header]);
  });
  const skuIndex = data.headers.indexOf("รหัสสินค้า");
  data.headers.forEach((header, index) => {
    const label = document.createElement("label"),
      title = document.createElement("span");
    title.textContent = header || `คอลัมน์ ${letter(index)}`;
    const multiline = /คำอธิบาย|บันทึก/.test(header),
      input = document.createElement(multiline ? "textarea" : "input");
    input.name = `column-${index}`;
    input.value = values[index];
    input.dataset.column = index;
    if (index === skuIndex) input.readOnly = true;
    label.className = "editor-field";
    label.append(title, input);
    fields.append(label);
  });
  get("product-editor").showModal();
}

get("cancel-product").onclick = () => get("product-editor").close();
get("product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingProduct) return;
  const values = data.headers.map(
    (_, index) =>
      get("editor-fields").querySelector(`[data-column="${index}"]`).value,
  );
  get("save-product").disabled = true;
  get("cancel-product").disabled = true;
  get("editor-message").textContent = "กำลังบันทึก…";
  try {
    const response = await fetch("/api/missing-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceCode: editingProduct.code, values }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    get("editor-message").textContent = "บันทึกสำเร็จ กำลังโหลดข้อมูลใหม่…";
    window.location.reload();
  } catch (error) {
    get("editor-message").textContent = error.message || "บันทึกไม่สำเร็จ";
    get("save-product").disabled = false;
    get("cancel-product").disabled = false;
  }
});

fetch("/api/sheet")
  .then((response) => {
    if (!response.ok) throw Error();
    return response.json();
  })
  .then((result) => {
    data = result;
    filteredRows = data.rows.map((row, rowNumber) => ({ row, rowNumber }));
    get("count").textContent =
      `${data.rows.length.toLocaleString("th-TH")} รายการ · ${data.headers.length} คอลัมน์`;
    const letters = document.createElement("tr"),
      headings = document.createElement("tr");
    letters.className = "letters";
    for (const row of [letters, headings]) {
      const th = cell("th", row === letters ? "" : "1");
      th.className = "row-number";
      row.append(th);
    }
    const widths = [
      54,
      ...data.headers.map((_, index) =>
        index === 4 ? 336 : [8, 9, 30].includes(index) ? 420 : 168,
      ),
    ];
    widths.forEach((width) => {
      const col = document.createElement("col");
      col.style.width = `${width}px`;
      get("columns").append(col);
    });
    data.headers.forEach((name, index) => {
      letters.append(cell("th", letter(index)));
      const th = cell("th", name);
      th.scope = "col";
      headings.append(th);
    });
    get("head").append(letters, headings);
    render();
  })
  .catch(() => {
    get("status").textContent = "โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้า";
    get("count").textContent = "โหลดไม่สำเร็จ";
  });
