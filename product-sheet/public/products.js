const get = (id) => document.getElementById(id);
const size = 10;
// source: "sheet" = ไฟล์ WooCommerce, "sml" = คลังจาก SML
const columns = [
  { name: "รหัสสินค้า", source: "sheet", width: 120, kind: "code" },
  { name: "ลงเว็บ", source: "web", width: 124, kind: "web" },
  { name: "ชื่อ", source: "sheet", width: 240, kind: "name" },
  { name: "คำอธิบาย", source: "sheet", long: true, width: 300 },
  { name: "น้ำหนัก (กก.)", source: "sheet", number: true, width: 80 },
  { name: "ยาว (ซม.)", header: "ยาว (เซนติเมตร)", source: "sheet", number: true, width: 72 },
  { name: "กว้าง (ซม.)", header: "กว้าง (เซนติเมตร)", source: "sheet", number: true, width: 72 },
  { name: "สูง (ซม.)", header: "สูง (เซนติเมตร)", source: "sheet", number: true, width: 72 },
  { name: "ขนาดจริง", source: "real", width: 150, kind: "real" },
  { name: "ราคาปกติ", source: "sheet", number: true, width: 96, kind: "price" },
  { name: "คลัง", source: "sml", number: true, width: 110, kind: "stock" },
  { name: "หมวดหมู่", source: "sheet", width: 200, kind: "tags" },
  { name: "ไฟล์รูปภาพ", source: "sheet", width: 150, kind: "images" },
];
let rows = [],
  filteredRows = [],
  page = 0;
// สถานะลงเว็บไซต์: key = รหัสสินค้าตัวเล็ก → { code, postedAt, hash }
let webPosted = {},
  webError = "";
// ขนาดตัวสินค้าจริง (ไม่ใช่ขนาดกล่อง): key = รหัสสินค้าตัวเล็ก → { w, l, h, kg, source }
let realSizes = {},
  realError = "";
const realSize = (item) => (item.code ? realSizes[item.code.toLocaleLowerCase()] : null);
const sizeText = ({ w, l, h }) => (w && l && h ? `${w} × ${l} × ${h} ซม.` : "");

function realCell(td, item) {
  if (!item.code) {
    td.innerHTML = '<span class="empty">—</span>';
    return;
  }
  if (item.type === "variation") {
    td.innerHTML = '<span class="empty" title="สินค้าหลายตัวเลือก กรอกที่สินค้าแม่">ใช้ของสินค้าแม่</span>';
    return;
  }
  if (realError) {
    td.innerHTML = '<span class="pill none">โหลดไม่ได้</span>';
    td.firstChild.title = realError;
    return;
  }
  const size = realSize(item);
  if (size) {
    const box = document.createElement("div");
    box.className = "real-size";
    box.textContent = [sizeText(size), size.kg ? `${size.kg} กก.` : ""].filter(Boolean).join("\n");
    box.title = size.source === "excel" ? "มาจากไฟล์ product-sizes.xlsx" : "กรอกจากหน้านี้";
    td.append(box);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "web-btn";
  button.textContent = size ? "แก้ไข" : "+ กรอกขนาดจริง";
  button.onclick = () => {
    openDetail(item);
    get("real-w").focus();
  };
  td.append(button);
}

// แสดงข้อมูลทางเทคนิค + รายละเอียด ตามที่ CSV จะส่งขึ้นเว็บ
function safeDescription(html) {
  // สร้างใหม่เฉพาะ p / ul / li / strong จากข้อความ ไม่ใส่ HTML ตรงๆ
  const doc = new DOMParser().parseFromString(html, "text/html");
  const copy = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    const tag = node.nodeName.toLowerCase();
    const out = document.createElement(["p", "ul", "li", "strong"].includes(tag) ? tag : "span");
    node.childNodes.forEach((child) => out.append(copy(child)));
    return out;
  };
  const box = document.createElement("div");
  box.className = "preview-desc";
  doc.body.childNodes.forEach((node) => box.append(copy(node)));
  return box;
}

let previewRequest = 0;
async function renderPreview(item) {
  const section = get("detail-preview");
  const body = get("preview-body");
  section.hidden = !item.code || item.type === "variation";
  if (section.hidden) return;
  const request = ++previewRequest;
  body.textContent = "กำลังโหลด…";
  try {
    const data = await json(`api/web-preview?code=${encodeURIComponent(item.code)}`);
    if (request !== previewRequest) return;
    const specs = document.createElement("table");
    specs.className = "preview-specs";
    for (const { name, value } of data.attributes) {
      const tr = specs.insertRow();
      tr.insertCell().textContent = name;
      tr.insertCell().textContent = value;
    }
    const specsTitle = document.createElement("h4");
    specsTitle.textContent = `ข้อมูลทางเทคนิค (${data.attributes.length})`;
    const descTitle = document.createElement("h4");
    descTitle.textContent = "รายละเอียดสินค้า";
    body.replaceChildren(
      specsTitle,
      data.attributes.length ? specs : Object.assign(document.createElement("p"), { textContent: "ไม่มี" }),
      descTitle,
      data.description ? safeDescription(data.description) : Object.assign(document.createElement("p"), { textContent: "ไม่มี" }),
    );
  } catch (error) {
    if (request === previewRequest) body.textContent = `โหลดตัวอย่างไม่สำเร็จ: ${error.message}`;
  }
}

function renderDetailReal(item) {
  const box = get("detail-real");
  box.hidden = !item.code || item.type === "variation" || Boolean(realError);
  if (box.hidden) return;
  const size = realSize(item) || {};
  for (const key of ["w", "l", "h", "kg"]) get(`real-${key}`).value = size[key] || "";
  get("real-msg").className = "row-msg";
  get("real-msg").textContent = size.source === "excel" ? "ค่าปัจจุบันมาจากไฟล์ product-sizes.xlsx" : "";
  get("real-form").onsubmit = async (event) => {
    event.preventDefault();
    const body = { code: item.code };
    for (const key of ["w", "l", "h", "kg"]) body[key] = get(`real-${key}`).value.trim();
    const save = get("real-save");
    save.disabled = true;
    get("real-msg").className = "row-msg";
    get("real-msg").textContent = "กำลังบันทึก…";
    try {
      const result = await json("api/real-sizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const key = item.code.toLocaleLowerCase();
      if (result.item) realSizes[key] = result.item;
      else delete realSizes[key];
      get("real-msg").className = "row-msg ok";
      get("real-msg").textContent = result.item ? "บันทึกแล้ว" : "ล้างขนาดจริงแล้ว";
      renderPreview(item);
      if (item.realTd?.isConnected) {
        item.realTd.replaceChildren();
        realCell(item.realTd, item);
      }
    } catch (error) {
      get("real-msg").className = "row-msg err";
      get("real-msg").textContent = error.message;
    } finally {
      save.disabled = false;
    }
  };
}
// ฟิลด์ที่ใช้ตรวจว่าข้อมูลเปลี่ยนหลังลงเว็บ (ไม่รวมคลัง เพราะเปลี่ยนทุกวัน)
const hashFields = ["ชื่อ", "คำอธิบาย", "น้ำหนัก (กก.)", "ยาว (ซม.)", "กว้าง (ซม.)", "สูง (ซม.)", "ราคาปกติ", "หมวดหมู่", "ไฟล์รูปภาพ"];
const webLabels = { none: "+ ลงเว็บแล้ว", posted: "✓ ลงเว็บแล้ว", changed: "⚠ ข้อมูลเปลี่ยน" };

function productHash(item) {
  const text = JSON.stringify(
    hashFields.map((name) => item.values[columns.findIndex((c) => c.name === name)] ?? ""),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16);
}

function webState(item) {
  if (!item.code) return "nocode";
  if (webError) return "error";
  const record = webPosted[item.code.toLocaleLowerCase()];
  if (!record) return "none";
  return record.hash === item.hash ? "posted" : "changed";
}

function webCell(td, item) {
  const state = webState(item);
  if (state === "nocode") {
    td.innerHTML = '<span class="empty">—</span>';
    return;
  }
  if (state === "error") {
    const pill = document.createElement("span");
    pill.className = "pill none";
    pill.textContent = "โหลดสถานะไม่ได้";
    pill.title = webError;
    return td.append(pill);
  }
  const record = webPosted[item.code.toLocaleLowerCase()];
  const button = document.createElement("button");
  button.type = "button";
  button.className = `web-btn ${state}`;
  button.disabled = Boolean(item.webSaving);
  button.textContent = item.webSaving ? "กำลังบันทึก…" : webLabels[state];
  button.title = {
    none: "กดเมื่อลงสินค้านี้บนเว็บไซต์แล้ว",
    posted: "กดเพื่อยกเลิกสถานะลงเว็บ",
    changed: "ข้อมูลในไฟล์เปลี่ยนหลังลงเว็บ — อัปเดตบนเว็บแล้วกดเพื่อยืนยัน",
  }[state];
  button.onclick = () => toggleWeb(item);
  td.append(button);
  if (record) {
    const date = document.createElement("span");
    date.className = "web-date";
    date.textContent = new Date(record.postedAt).toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
    td.append(date);
  }
  if (item.webMessage) {
    const message = document.createElement("span");
    message.className = "row-msg err";
    message.textContent = item.webMessage;
    td.append(message);
  }
}

async function toggleWeb(item) {
  const state = webState(item);
  if (state === "nocode" || state === "error" || item.webSaving) return;
  if (state === "posted" && !confirm(`ยกเลิกสถานะ "ลงเว็บแล้ว" ของ ${item.code}?`)) return;
  if (
    state === "changed" &&
    !confirm(`อัปเดตข้อมูล ${item.code} บนเว็บไซต์ให้ตรงกับไฟล์แล้วใช่ไหม?\n(ยกเลิก = ยังไม่ได้อัปเดต)`)
  )
    return;
  item.webSaving = true;
  item.webMessage = "";
  updateWebViews(item);
  try {
    const result = await json("api/web-posted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: item.code, posted: state !== "posted", hash: item.hash }),
    });
    const key = item.code.toLocaleLowerCase();
    if (result.item) webPosted[key] = result.item;
    else delete webPosted[key];
  } catch (error) {
    item.webMessage = `บันทึกไม่สำเร็จ: ${error.message}`;
  } finally {
    item.webSaving = false;
  }
  updateWebViews(item);
}

// อัปเดตเฉพาะช่องที่เกี่ยวข้อง ไม่ render ใหม่ทั้งตาราง (จะได้ไม่เด้งกลับบนสุด)
function updateWebViews(item) {
  if (item.webTd?.isConnected) {
    item.webTd.replaceChildren();
    webCell(item.webTd, item);
    item.webTd.parentElement.className = `web-${webState(item)}`;
  }
  if (get("detail").open && detailItem === item) renderDetailWeb(item);
  updateCount();
}

function renderDetailWeb(item) {
  const button = get("detail-web");
  const state = webState(item);
  button.hidden = state === "nocode" || state === "error";
  button.className = `detail-btn web-btn ${state}`;
  button.disabled = Boolean(item.webSaving);
  button.textContent = item.webSaving ? "กำลังบันทึก…" : webLabels[state] || "";
  button.onclick = () => toggleWeb(item);
  if (item.webMessage) get("detail-toast").textContent = item.webMessage;
}

function updateCount() {
  let posted = 0,
    changed = 0;
  for (const item of rows) {
    const state = webState(item);
    if (state === "posted") posted++;
    else if (state === "changed") changed++;
  }
  const web = webError
    ? " · สถานะลงเว็บโหลดไม่ได้"
    : ` · ลงเว็บแล้ว ${(posted + changed).toLocaleString("th-TH")}${changed ? ` (ข้อมูลเปลี่ยน ${changed.toLocaleString("th-TH")})` : ""}`;
  get("count").textContent =
    `${filteredRows.length.toLocaleString("th-TH")} / ${rows.length.toLocaleString("th-TH")} รายการ${web}`;
}

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
    // แสดงเฉพาะหมวดชั้นล่างสุด และรวมชื่อซ้ำที่อยู่ใต้หลายหมวดแม่
    const paths = value.split(",").map((t) => t.trim()).filter(Boolean);
    const leaves = new Map();
    for (const tag of paths) {
      if (paths.some((other) => other.startsWith(`${tag} >`))) continue;
      const leaf = tag.split(">").pop().trim();
      leaves.set(leaf, [...(leaves.get(leaf) || []), tag]);
    }
    for (const [leaf, full] of leaves) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = leaf;
      span.title = full.join("\n");
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

// ---------- ป็อปอัปข้อมูลเต็มของสินค้า ----------
function htmlToText(value) {
  // คงการขึ้นบรรทัดของ <br>, <p>, <li> ไว้ ให้คัดลอกไปวางแล้วอ่านง่าย
  const doc = new DOMParser().parseFromString(value, "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("li").forEach((li) => li.prepend("• "));
  doc
    .querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6")
    .forEach((block) => block.append("\n"));
  return doc.body.textContent
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detailText(column, value) {
  if (!value) return "";
  if (column.long) return htmlToText(value);
  if (column.kind === "price") {
    const number = Number(value.replace(/,/g, ""));
    return Number.isFinite(number) ? `฿${number.toLocaleString("th-TH")}` : value;
  }
  if (column.kind === "tags")
    return value.split(",").map((t) => t.trim()).filter(Boolean).join("\n");
  if (column.kind === "images")
    return (value.match(/https?:\/\/[^,\s]+/g) || [value]).join("\n");
  return value;
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // http (ไม่ใช่ secure context) ใช้ clipboard API ไม่ได้
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    get("detail").append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) {
      get("detail-toast").textContent = "คัดลอกไม่สำเร็จ กรุณาลากเลือกข้อความแล้วกด Ctrl+C";
      return;
    }
  }
  get("detail-toast").textContent = `คัดลอก${label}แล้ว`;
}

let detailItem = null;
function openDetail(item) {
  const dialog = get("detail");
  detailItem = item;
  const code = item.values[columns.findIndex((c) => c.kind === "code")] || "";
  const name = item.values[columns.findIndex((c) => c.kind === "name")] || "";
  get("detail-code").textContent = code;
  get("detail-title").textContent = name || "ไม่มีชื่อสินค้า";
  get("detail-toast").textContent = "";
  renderDetailWeb(item);
  renderDetailReal(item);
  renderPreview(item);
  const fields = columns
    .map((column, index) => [
      column.name,
      detailText(column, item.values[index]),
      column,
      item.values[index],
    ])
    .filter(([, , column]) => column.kind !== "web" && column.kind !== "real");
  get("detail-fields").replaceChildren(
    ...fields.map(([label, text, column, raw]) => {
      const wrap = document.createElement("div");
      wrap.className = "detail-field";
      const dt = document.createElement("dt");
      dt.textContent = label;
      if (text) {
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "detail-btn";
        copy.textContent = "คัดลอก";
        copy.onclick = () => copyText(text, label);
        dt.append(copy);
        if (column.long && /<[a-z][\s\S]*>/i.test(raw)) {
          // WooCommerce เก็บคำอธิบายเป็น HTML เผื่อไปวางในหลังร้าน
          const copyHtml = document.createElement("button");
          copyHtml.type = "button";
          copyHtml.className = "detail-btn";
          copyHtml.style.marginLeft = "0";
          copyHtml.textContent = "คัดลอก HTML";
          copyHtml.onclick = () => copyText(raw, `${label} (HTML)`);
          dt.append(copyHtml);
        }
      }
      const dd = text ? cell("dd", text) : document.createElement("dd");
      if (!text) dd.innerHTML = '<span class="empty">—</span>';
      wrap.append(dt, dd);
      return wrap;
    }),
  );
  get("detail-copy-all").onclick = () =>
    copyText(
      fields
        .filter(([, text]) => text)
        .map(([label, text]) => `${label}: ${text.includes("\n") ? `\n${text}` : text}`)
        .join("\n\n"),
      "ทั้งหมด",
    );
  dialog.showModal();
  get("detail-fields").scrollTop = 0;
  dialog.scrollTop = 0;
}

get("detail-close").onclick = () => get("detail").close();
// คลิกพื้นหลังนอกกล่อง = ปิด (แต่ไม่ปิดตอนลากเลือกข้อความแล้วปล่อยเมาส์นอกกล่อง)
let pressedOnBackdrop = false;
get("detail").addEventListener("mousedown", (event) => {
  pressedOnBackdrop = event.target === get("detail");
});
get("detail").addEventListener("click", (event) => {
  if (pressedOnBackdrop && event.target === get("detail")) get("detail").close();
});

function render() {
  const body = get("rows");
  body.replaceChildren();
  filteredRows.slice(page * size, (page + 1) * size).forEach((item) => {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.className = `web-${webState(item)}`;
    // คลิกแถว (ยกเว้นลิงก์รูป) หรือกด Enter = เปิดป็อปอัปข้อมูลเต็มที่คัดลอกได้
    tr.addEventListener("click", (event) => {
      if (!event.target.closest("a, button")) openDetail(item);
    });
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === tr) openDetail(item);
    });
    item.values.forEach((value, index) => {
      const column = columns[index];
      const td = document.createElement("td");
      // คำอธิบายแสดงย่อ 3 บรรทัด ค่าเต็มดูได้ในป็อปอัป
      if (column.kind === "web") {
        item.webTd = td;
        webCell(td, item);
      } else if (column.kind === "real") {
        item.realTd = td;
        realCell(td, item);
      } else content(td, column, value, item.stock);
      if (column.number) td.classList.add("number");
      if (column.kind === "code" || column.kind === "name")
        td.classList.add(column.kind);
      tr.append(td);
    });
    body.append(tr);
  });
  if (!filteredRows.length && rows.length) {
    // ไม่พบ: บอกว่าติดตัวกรองไหน และให้ค้นทุกหมวดได้ในคลิกเดียว
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.className = "empty-result";
    const where = categoryPath ? ` ในหมวด "${categoryPath.split(" > ").pop()}"` : "";
    td.append(`ไม่พบสินค้าที่ตรงกับคำค้นและตัวกรอง${where}`);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "detail-btn";
    reset.textContent = categoryPath ? "ค้นหาทุกหมวด" : "ล้างตัวกรองทั้งหมด";
    reset.onclick = () => {
      if (categoryPath) selectCategory("", false);
      else get("reset-filters").click();
    };
    td.append(reset);
    tr.append(td);
    body.append(tr);
  }
  const total = filteredRows.length,
    start = total ? page * size + 1 : 0,
    end = Math.min((page + 1) * size, total);
  get("page-info").textContent =
    `รายการ ${start}–${end} จาก ${total.toLocaleString("th-TH")}`;
  get("prev").disabled = page === 0;
  get("next").disabled = (page + 1) * size >= total;
  document.querySelector(".sheet-scroll").scrollTop = 0;
}

// ---------- ตัวกรองหมวดหมู่แบบต้นไม้ ----------
const groupOrder = [
  "เครื่องเสียงกลางแจ้ง",
  "ดอกลำโพง & ยูนิต",
  "ตู้ลำโพง",
  "แอมป์ & มิกเซอร์",
  "ไมโครโฟน",
  "ตู้แร็ค & ขาตั้ง",
  "เครื่องเสียงรถยนต์",
  "สายสัญญาณ & ปลั๊ก",
  "อะไหล่ & อุปกรณ์ช่าง",
];
let categoryPath = "",
  categoryTree = null;
const openPaths = new Set();
const inCategory = (item, path) =>
  item.categories.some((c) => c === path || c.startsWith(`${path} > `));

function buildCategoryTree() {
  const root = { children: new Map(), count: rows.length };
  for (const item of rows) {
    // นับสินค้าหนึ่งครั้งต่อโหนด แม้อยู่หลาย path ใต้โหนดเดียวกัน
    const seen = new Set();
    for (const path of item.categories) {
      let node = root;
      const parts = path.split(" > ");
      parts.forEach((name, i) => {
        const full = parts.slice(0, i + 1).join(" > ");
        if (!node.children.has(name))
          node.children.set(name, { name, path: full, children: new Map(), count: 0 });
        node = node.children.get(name);
        if (!seen.has(full)) {
          seen.add(full);
          node.count++;
        }
      });
    }
  }
  categoryTree = root;
  renderCategoryTree();
}

function sortedChildren(node, top) {
  return [...node.children.values()].sort((a, b) => {
    if (top) {
      const ia = groupOrder.indexOf(a.name),
        ib = groupOrder.indexOf(b.name);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }
    return a.name.localeCompare(b.name, "th", { numeric: true });
  });
}

function renderCategoryTree() {
  const list = get("cat-tree");
  if (!categoryTree) return;
  const query = get("cat-search").value.trim().toLocaleLowerCase();
  const matches = (node) =>
    node.name.toLocaleLowerCase().includes(query) ||
    [...node.children.values()].some(matches);
  const build = (node, depth) => {
    const wrap = document.createElement("div");
    wrap.className = `cat-node depth-${Math.min(depth, 2)}`;
    const hasChildren = node.children.size > 0;
    const open = hasChildren && (query ? true : openPaths.has(node.path));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cat-item";
    button.classList.toggle("on", node.path === categoryPath);
    button.classList.toggle("open", open);
    if (hasChildren) button.setAttribute("aria-expanded", String(open));
    button.title = node.path;
    button.innerHTML = '<span class="cat-name"></span><span class="cat-count"></span>';
    button.querySelector(".cat-name").textContent = node.name;
    button.querySelector(".cat-count").textContent = node.count.toLocaleString("th-TH");
    if (hasChildren) button.insertAdjacentHTML("beforeend", '<span class="cat-chev" aria-hidden="true">›</span>');
    button.onclick = () => selectCategory(node.path, hasChildren);
    wrap.append(button);
    if (open) {
      const children = document.createElement("div");
      children.className = "cat-children";
      for (const child of sortedChildren(node, false))
        if (!query || matches(child) || node.name.toLocaleLowerCase().includes(query))
          children.append(build(child, depth + 1));
      wrap.append(children);
    }
    return wrap;
  };
  const all = document.createElement("button");
  all.type = "button";
  all.className = "cat-item cat-all";
  all.classList.toggle("on", !categoryPath);
  all.innerHTML = '<span class="cat-name">ทั้งหมด</span><span class="cat-count"></span>';
  all.querySelector(".cat-count").textContent = categoryTree.count.toLocaleString("th-TH");
  all.onclick = () => selectCategory("", false);
  const nodes = sortedChildren(categoryTree, true)
    .filter((node) => !query || matches(node))
    .map((node) => build(node, 0));
  list.replaceChildren(all, ...nodes);
  if (!nodes.length && query) {
    const empty = document.createElement("p");
    empty.className = "cat-empty";
    empty.textContent = "ไม่พบหมวดหมู่ที่ค้นหา";
    // ช่องนี้ค้นชื่อหมวด ไม่ใช่รหัสสินค้า: ให้ล้างกลับมาเห็นทุกหมวดได้ในคลิกเดียว
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "detail-btn";
    clear.style.display = "block";
    clear.style.marginTop = "8px";
    clear.textContent = "ล้างคำค้น";
    clear.onclick = () => {
      get("cat-search").value = "";
      renderCategoryTree();
      get("cat-search").focus();
    };
    empty.append(clear);
    list.append(empty);
  }
  get("cat-current").textContent = categoryPath
    ? categoryPath.split(" > ").pop()
    : "ทั้งหมด";
  get("cat-current").title = categoryPath;
}

function selectCategory(path, hasChildren) {
  if (path && path === categoryPath && hasChildren && openPaths.has(path)) {
    // กดหมวดที่เลือกอยู่ซ้ำ = ยกเลิกเลือกและพับ
    openPaths.delete(path);
    categoryPath = path.includes(" > ") ? path.slice(0, path.lastIndexOf(" > ")) : "";
  } else {
    categoryPath = path;
    const parts = path ? path.split(" > ") : [];
    parts.forEach((_, i) => openPaths.add(parts.slice(0, i + 1).join(" > ")));
    if (!hasChildren) get("cat-panel").classList.remove("open");
  }
  renderCategoryTree();
  search();
}

get("cat-search").addEventListener("input", renderCategoryTree);
get("cat-toggle").onclick = () => get("cat-panel").classList.toggle("open");
get("cat-close").onclick = () => get("cat-panel").classList.remove("open");

function search() {
  const query = get("search").value.trim().toLocaleLowerCase();
  const stockFilter = get("filter-stock").value,
    category = categoryPath;
  const presence = [...document.querySelectorAll(".column-filters select")]
    .map((select, index) => [index, select.value])
    .filter(([, value]) => value !== "all");
  filteredRows = rows.filter(
    (item) =>
      presence.every(([index, value]) => {
        if (columns[index].kind === "real")
          return (value === "has") === Boolean(realSize(item));
        if (columns[index].kind !== "web")
          return (value === "has") === item.filled[index];
        const state = webState(item);
        return value === "has"
          ? state === "posted" || state === "changed"
          : value === state;
      }) &&
      (stockFilter === "all" || stockFilter === item.stockState) &&
      (!category || inCategory(item, category)) &&
      (!query ||
        item.values.some((value) => value.toLocaleLowerCase().includes(query))),
  );
  page = 0;
  updateCount();
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
get("filter-stock").addEventListener("change", search);
get("reset-filters").onclick = () => {
  document.querySelectorAll(".column-filters select").forEach((select, i) => {
    select.value = i === 0 ? "has" : "all";
    select.classList.toggle("active", i === 0);
  });
  get("filter-stock").value = "all";
  categoryPath = "";
  get("cat-search").value = "";
  renderCategoryTree();
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
      if (c.kind === "web")
        select.append(
          new Option("ทั้งหมด", "all"),
          new Option("ลงเว็บแล้ว", "has"),
          new Option("ยังไม่ลง", "none"),
          new Option("ข้อมูลเปลี่ยน", "changed"),
        );
      else if (c.kind === "real")
        select.append(
          new Option("ทั้งหมด", "all"),
          new Option("กรอกแล้ว", "has"),
          new Option("ยังไม่กรอก", "none"),
        );
      else
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
    const [sml, web, real] = await Promise.allSettled([
      json("api/sml-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: [...new Set(codes.filter(Boolean))] }),
      }),
      json("api/web-posted"),
      json("api/real-sizes"),
    ]);
    if (real.status === "fulfilled") realSizes = real.value.items || {};
    else {
      realError = real.reason.message;
      notes.push(`ขนาดจริง: ${realError}`);
    }
    if (web.status === "fulfilled") webPosted = web.value.items || {};
    else {
      webError = web.reason.message;
      notes.push(`สถานะลงเว็บ: ${webError}`);
    }
    if (sml.status === "rejected") notes.push(`คลัง: ${sml.reason.message}`);
    else
      notes.push(
        `คลังจาก SML (ยอดคงเหลือในทะเบียน) ณ ${new Date(sml.value.updatedAt).toLocaleString("th-TH")}`,
      );

    // WooCommerce: variation ไม่มีหมวดของตัวเอง ใช้หมวดของสินค้าแม่
    // คอลัมน์ "หลัก" อ้างแม่ได้ทั้ง id:<ID> หรือรหัสสินค้า
    const categoryIndex = columns.findIndex((c) => c.kind === "tags");
    const idColumn = headers.indexOf("ID");
    const parentColumn = headers.indexOf("หลัก");
    const parentCategories = new Map();
    if (indexes[categoryIndex] >= 0)
      data.rows.forEach((row, r) => {
        const category = String(row[indexes[categoryIndex]] ?? "");
        if (!category.trim()) return;
        const id = idColumn < 0 ? "" : String(row[idColumn] ?? "").trim();
        if (id) parentCategories.set(`id:${id}`, category);
        if (codes[r]) parentCategories.set(codes[r].toLocaleLowerCase(), category);
      });
    rows = data.rows.map((row, r) => {
      const key = codes[r].toLocaleLowerCase();
      const stock =
        sml.status === "fulfilled" && key ? sml.value.stock[key] : null;
      const values = columns.map((c, i) => {
        if (c.source === "sheet") return indexes[i] < 0 ? "" : String(row[indexes[i]] ?? "");
        if (!key || c.source === "web" || c.source === "real") return "";
        return sml.status === "fulfilled" ? formatQty(stock) : "โหลดไม่สำเร็จ";
      });
      if (!values[categoryIndex].trim() && parentColumn >= 0) {
        const parent = String(row[parentColumn] ?? "").trim().toLocaleLowerCase();
        values[categoryIndex] = parentCategories.get(parent) || "";
      }
      const qty = stock && stock.qty != null ? Number(stock.qty) : NaN;
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
        // path เต็ม เช่น "ไมโครโฟน > ไมโครโฟน > ไมค์ลอย"
        categories: values[categoryIndex]
          .split(",")
          .map((t) => t.split(">").map((part) => part.trim()).join(" > "))
          .filter(Boolean),
      };
    });
    for (const item of rows) item.hash = productHash(item);
    buildCategoryTree();
    if (sml.status === "fulfilled") renderUnmatched();
    else get("unmatched-count").textContent = "ตรวจสอบไม่ได้ (โหลด SML ไม่สำเร็จ)";
    get("status").textContent = [...notes, "แสดงหน้าละ 10 รายการ"].join(" · ");
    search();
  } catch (error) {
    get("count").textContent = "โหลดข้อมูลไม่สำเร็จ";
    get("status").textContent = `เกิดข้อผิดพลาด: ${error.message}`;
  }
})();
