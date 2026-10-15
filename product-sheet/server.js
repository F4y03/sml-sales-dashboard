import express from "express";
import ExcelJS from "exceljs";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

const workbook = new ExcelJS.Workbook();
const sheet = await workbook.csv.readFile(
  fileURLToPath(new URL("./data/products.csv", import.meta.url)),
  { map: (value) => value.replace(/\r\n?/g, "\n") },
);
sheet.name = "สินค้า";
sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
sheet.autoFilter = {
  from: { row: 1, column: 1 },
  to: { row: sheet.rowCount, column: sheet.columnCount },
};
sheet.columns.forEach((column, index) => {
  column.width = index === 4 ? 48 : [8, 9, 30].includes(index) ? 60 : 24;
});
sheet.eachRow((row, rowNumber) => {
  row.height = rowNumber === 1 ? 44 : 36;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.numFmt = "@";
    cell.font = {
      name: "Tahoma",
      size: 11,
      color: { argb: rowNumber === 1 ? "FFFFFFFF" : "FF24332D" },
      bold: rowNumber === 1,
    };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb:
          rowNumber === 1
            ? "FF217346"
            : rowNumber % 2 === 0
              ? "FFFFFFFF"
              : "FFF3F8F5",
      },
    };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFDFE8E2" } },
      right: { style: "thin", color: { argb: "FFDFE8E2" } },
    };
  });
});
const rows = Array.from({ length: sheet.rowCount }, (_, row) =>
  Array.from({ length: sheet.columnCount }, (_, column) =>
    String(sheet.getCell(row + 1, column + 1).value ?? ""),
  ),
);
const file = await workbook.xlsx.writeBuffer();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
const driveWorkbookPath = fileURLToPath(
  new URL(
    "../product-image-drive-output/products-with-individual-drive-links.xlsx",
    import.meta.url,
  ),
);
const smlPool = new pg.Pool({
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  max: 2,
  options: "-c default_transaction_read_only=on",
});
smlPool.on("error", (error) =>
  console.error("Idle SML connection:", error.code),
);
const missingProductStart = "2025-01-01";

async function readDriveWorkbook() {
  const updated = new ExcelJS.Workbook();
  await updated.xlsx.readFile(driveWorkbookPath);
  return updated;
}

function workbookSkus(tab) {
  const headers = Array.from({ length: tab.columnCount }, (_, column) =>
    tab.getCell(1, column + 1).text.trim(),
  );
  const skuColumn = headers.indexOf("รหัสสินค้า") + 1;
  if (!skuColumn) throw new Error("SKU_COLUMN_NOT_FOUND");
  const skus = new Set();
  for (let row = 2; row <= tab.rowCount; row++) {
    const sku = tab.getCell(row, skuColumn).text.trim().toLocaleLowerCase();
    if (sku) skus.add(sku);
  }
  return skus;
}

function workbookHeaders(tab) {
  return Array.from({ length: tab.columnCount }, (_, column) =>
    tab.getCell(1, column + 1).text.trim(),
  );
}

app.get("/api/missing-products", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (!existsSync(driveWorkbookPath))
    return res.status(503).json({ error: "ไม่พบไฟล์ Excel สำหรับเปรียบเทียบ" });
  let client;
  try {
    const tab = (await readDriveWorkbook()).worksheets[0];
    const excelSkus = workbookSkus(tab);
    client = await smlPool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query({
      text: `SELECT i.code, i.name_1 AS name, i.unit_standard AS unit,
                    COALESCE((SELECT MAX(g.name_1) FROM ic_group g WHERE g.code = i.group_main), i.group_main) AS product_group,
                    i.description, i.remark, i.item_brand AS brand, i.item_model AS model,
                    i.balance_qty AS stock_quantity, i.tax_type,
                    (SELECT NULLIF(TRIM(p.price_0), '')
                     FROM ic_inventory_price_formula p
                     WHERE p.ic_code = i.code AND p.unit_code = i.unit_standard AND p.sale_type = 0
                     ORDER BY p.roworder DESC LIMIT 1) AS regular_price,
                    i.create_datetime::date AS created_date
             FROM ic_inventory i
             WHERE i.create_datetime >= $1::date
               AND i.create_datetime < CURRENT_DATE + INTERVAL '1 day'
               AND COALESCE(BTRIM(i.code), '') NOT IN ('', 'หมายเหตุ')
               AND LEFT(BTRIM(i.code), 1) <> 'ฝ'
             ORDER BY i.create_datetime DESC, i.code, i.roworder DESC`,
      values: [missingProductStart],
    });
    await client.query("COMMIT");
    const unique = new Map();
    for (const product of result.rows) {
      const key = String(product.code).trim().toLocaleLowerCase();
      if (!excelSkus.has(key) && !unique.has(key)) unique.set(key, product);
    }
    res.json({
      start: missingProductStart,
      end: new Date().toISOString().slice(0, 10),
      count: unique.size,
      rows: [...unique.values()],
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Missing product query failed:", error.code || error.message);
    res
      .status(503)
      .json({ error: "ตรวจสอบสินค้าใหม่จาก SML ไม่สำเร็จ กรุณาลองใหม่" });
  } finally {
    client?.release();
  }
});

let savingProduct = false;
app.post("/api/missing-products", async (req, res) => {
  if (savingProduct)
    return res
      .status(429)
      .json({ error: "กำลังบันทึกสินค้า กรุณาลองใหม่อีกครั้ง" });
  const sourceCode =
    typeof req.body?.sourceCode === "string" ? req.body.sourceCode.trim() : "";
  const values = Array.isArray(req.body?.values) ? req.body.values : null;
  if (
    !sourceCode ||
    !values ||
    values.some((value) => typeof value !== "string") ||
    values.reduce((sum, value) => sum + value.length, 0) > 200000
  ) {
    return res.status(400).json({ error: "ข้อมูลสินค้าที่ส่งมาไม่ถูกต้อง" });
  }
  let temporaryPath;
  savingProduct = true;
  try {
    const source = await smlPool.query({
      text: `SELECT 1 FROM ic_inventory
             WHERE BTRIM(code) = $1 AND create_datetime >= $2::date
               AND create_datetime < CURRENT_DATE + INTERVAL '1 day'
               AND LEFT(BTRIM(code), 1) <> 'ฝ'
             LIMIT 1`,
      values: [sourceCode, missingProductStart],
    });
    if (!source.rowCount)
      return res
        .status(400)
        .json({ error: "ไม่พบรหัสสินค้านี้ในช่วงวันที่ที่กำหนด" });
    const workbook = await readDriveWorkbook();
    const tab = workbook.worksheets[0];
    const headers = workbookHeaders(tab);
    if (values.length !== headers.length)
      return res
        .status(400)
        .json({ error: "จำนวนคอลัมน์สินค้าไม่ตรงกับไฟล์ Excel" });
    const skuColumn = headers.indexOf("รหัสสินค้า");
    if (skuColumn < 0) throw new Error("SKU_COLUMN_NOT_FOUND");
    if (
      values[skuColumn].trim().toLocaleLowerCase() !==
      sourceCode.toLocaleLowerCase()
    )
      return res
        .status(400)
        .json({ error: "รหัสสินค้าไม่ตรงกับข้อมูลจาก SML" });
    if (workbookSkus(tab).has(sourceCode.toLocaleLowerCase()))
      return res
        .status(409)
        .json({ error: "รหัสสินค้านี้มีอยู่ใน Excel แล้ว" });
    const row = tab.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = "@";
      cell.alignment = { vertical: "top", wrapText: true };
    });
    temporaryPath = `${driveWorkbookPath}.${process.pid}.${Date.now()}.tmp`;
    await workbook.xlsx.writeFile(temporaryPath);
    await rename(temporaryPath, driveWorkbookPath);
    temporaryPath = null;
    res.status(201).json({ saved: true, code: sourceCode, row: row.number });
  } catch (error) {
    console.error("Save missing product failed:", error.code || error.message);
    res
      .status(500)
      .json({ error: "เพิ่มสินค้าลง Excel ไม่สำเร็จ กรุณาลองใหม่" });
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => {});
    savingProduct = false;
  }
});

app.get("/api/sheet", async (req, res, next) => {
  if (!existsSync(driveWorkbookPath)) return next();
  try {
    const tab = (await readDriveWorkbook()).worksheets[0];
    const values = Array.from({ length: tab.rowCount }, (_, row) =>
      Array.from(
        { length: tab.columnCount },
        (_, column) => tab.getCell(row + 1, column + 1).text,
      ),
    );
    res.json({
      title: "WooCommerce",
      headers: values[0],
      rows: values.slice(1),
    });
  } catch (error) {
    next(error);
  }
});
app.get("/download.xlsx", (req, res, next) => {
  if (!existsSync(driveWorkbookPath)) return next();
  res.download(driveWorkbookPath, "products-with-individual-drive-links.xlsx");
});
// ---------- แปลงคำอธิบายสำหรับเว็บไซต์ (เฉพาะ CSV) ----------
// บรรทัด "• หัวข้อ : ค่า" → คุณสมบัติในแท็บ "ข้อมูลทางเทคนิค" และคำอธิบายเป็น <ul><li>
// รวมเฉพาะชื่อหัวข้อที่สะกดผิด/สะกดต่าง ไม่รวมคำที่ความหมายอาจต่างกัน
const specKeyAliases = {
  "อิมพิแดนซ์": "อิมพีแดนซ์",
  "อิมพีเเดนซ์": "อิมพีแดนซ์",
  "ความถึ่ตอบสนอง": "ความถี่ตอบสนอง",
  "ความถี่ตอบสนอ": "ความถี่ตอบสนอง",
  "ทวีทเตอร์": "ทวีตเตอร์",
  "วอยซคอยล์ขนาด": "วอยซ์คอยล์ขนาด",
  "เชื่อมต่อบลทูธ": "เชื่อมต่อบลูทูธ",
  "ระยะรับสัญญาน": "ระยะรับสัญญาณ",
  "พาเวอร์มิกเซอร์": "เพาเวอร์มิกเซอร์",
  "อัตตราส่วนสัญญาณรบกวน": "อัตราส่วนสัญญาณรบกวน",
  "ฟังก์ชั่นบันมึกเสียง": "ฟังก์ชั่นบันทึกเสียง",
  "อิมพุทไวลท์": "อินพุทโวลท์",
  "วัสดุ / สี": "วัสดุ/สี",
  "POWER SUPPLY": "Power Supply",
  "lmage rejection": "Image rejection",
  "การตอบสนองความถี่ (Frequency response)": "การตอบสนองความถี่ (Frequency Response)",
  "ช่วงความถี่ (Frequency range)": "ช่วงความถี่ (Frequency Range)",
};
const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function parseSpecLine(line) {
  const match = line.match(/^•\s*([^:：]{1,40}?)\s*[:：]\s*(.+)$/);
  // "อัตราส่วนการหด 2:1", "MX60 : ..." ไม่ใช่หัวข้อ:ค่า
  if (!match || /\d$/.test(match[1])) return null;
  const key = match[1].replace(/^\((.*)\)$/, "$1").trim();
  return { key: specKeyAliases[key] || key, value: match[2].trim() };
}

function descriptionToHtml(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines[0] === "รายละเอียดสินค้า") lines.shift();
  const html = [];
  let list = [];
  const flush = () => {
    if (list.length) html.push(`<ul>\n${list.join("\n")}\n</ul>`);
    list = [];
  };
  for (const line of lines) {
    if (!line.startsWith("•")) {
      flush();
      html.push(`<p>${escapeHtml(line)}</p>`);
      continue;
    }
    const spec = parseSpecLine(line);
    list.push(
      spec
        ? `<li><strong>${escapeHtml(spec.key)}</strong> ${escapeHtml(spec.value)}</li>`
        : `<li>${escapeHtml(line.replace(/^•\s*/, ""))}</li>`,
    );
  }
  flush();
  return html.join("\n");
}

function addSpecAttributes(tab) {
  const headers = workbookHeaders(tab);
  const col = (name) => headers.indexOf(name) + 1;
  const descriptionColumn = col("คำอธิบาย");
  const typeColumn = col("ชนิด");
  if (!descriptionColumn || !typeColumn) return;
  const attributeColumns = (n) => ({
    name: col(`ชื่อคุณสมบัติ ${n}`),
    value: col(`ค่าคุณสมบัติ ${n}`),
    visible: col(`คุณสมบัติภายนอกที่เห็นได้ ${n}`),
    global: col(`คุณสมบัติทั่วไป ${n}`),
  });
  const ensureAttribute = (n) => {
    if (attributeColumns(n).name) return attributeColumns(n);
    for (const label of ["ชื่อคุณสมบัติ", "ค่าคุณสมบัติ", "คุณสมบัติภายนอกที่เห็นได้", "คุณสมบัติทั่วไป"]) {
      headers.push(`${label} ${n}`);
      tab.getCell(1, headers.length).value = `${label} ${n}`;
    }
    return attributeColumns(n);
  };
  const nameColumn = col("ชื่อ");
  const brandColumn = col("แบรนด์");
  const dimensionColumns = ["กว้าง", "ยาว", "สูง"].map((label) => [label, col(`${label} (เซนติเมตร)`)]);
  // คอมมาเป็นตัวคั่นหลายค่าใน CSV ของ WooCommerce ต้อง escape (ยกเว้นค่าตัวเลือกเดิมที่ตั้งใจคั่นหลายค่า)
  const escapeValue = (value) => value.replace(/,/g, "\\,");
  for (let row = 2; row <= tab.rowCount; row++) {
    const text = (column) => (column ? tab.getCell(row, column).text.trim() : "");
    const isVariation = text(typeColumn) === "variation";
    const description = tab.getCell(row, descriptionColumn).text;
    if (description.trim())
      tab.getCell(row, descriptionColumn).value = descriptionToHtml(description);

    // คุณสมบัติเดิมในไฟล์ (เช่น Color ของสินค้าหลายสี) เก็บไว้ทั้งหมด
    const existing = [];
    for (let n = 1; attributeColumns(n).name; n++) {
      const columns = attributeColumns(n);
      const name = text(columns.name);
      if (name)
        existing.push({ name, value: text(columns.value), visible: text(columns.visible), global: text(columns.global) });
      for (const column of Object.values(columns)) tab.getCell(row, column).value = null;
    }
    // เว็บใหม่ใช้คุณสมบัติ "สี" แบบ Global และค่าไม่มีคำว่า "สี" นำหน้า (สีดำ → ดำ)
    const toColorValue = (value) =>
      value.split(",").map((part) => part.trim().replace(/^สี(?=\S)/, "")).join(", ");
    for (const attribute of existing)
      if (/^(color|สี)$/i.test(attribute.name)) {
        attribute.name = "สี";
        attribute.value = toColorValue(attribute.value);
        attribute.global = "1";
      }

    const attributes = [];
    if (!isVariation) {
      const { brand, model } = brandAndModel(text(nameColumn));
      if (model) attributes.push({ name: "รุ่น", value: escapeValue(model) });
      if (brand) {
        attributes.push({ name: "แบรนด์", value: brand });
        if (brandColumn && !text(brandColumn)) tab.getCell(row, brandColumn).value = brand;
      }
      const dimensions = dimensionColumns.map(([label, column]) => [label, text(column)]);
      if (dimensions.every(([, value]) => value))
        attributes.push({
          name: "ขนาด",
          value: `${dimensions.map(([label, value]) => `${label} ${value} ซม.`).join(" ")} (ขนาดกล่อง)`,
        });
    }
    const color = existing.find((attribute) => attribute.name === "สี");
    if (color) attributes.push(color);
    attributes.push(...existing.filter((attribute) => attribute !== color));

    // ตัวเลือกย่อย (variation) ใช้คุณสมบัติของสินค้าแม่ ไม่ใส่สเปกซ้ำ
    if (!isVariation) {
      const specs = new Map();
      for (const line of description.split("\n")) {
        const spec = parseSpecLine(line.trim());
        if (!spec) continue;
        if (spec.key === "Color") spec.key = "สี";
        // ชื่อซ้ำกับคุณสมบัติที่มีอยู่แล้ว (เช่น สี ของสินค้าหลายสี) ไม่ใส่ทับ
        if (attributes.some((attribute) => attribute.name.toLocaleLowerCase() === spec.key.toLocaleLowerCase())) continue;
        const values = specs.get(spec.key) || [];
        if (!values.includes(spec.value)) values.push(spec.value);
        specs.set(spec.key, values);
      }
      // คำอธิบายมี กว้าง/ยาว/สูง ครบ (ตัวเลขละเอียดกว่าช่องการจัดส่ง) ใช้เป็น "ขนาด" แทน
      const sides = ["กว้าง", "ยาว", "สูง"].map((label) =>
        [`ความ${label}`, label].find((key) => specs.get(key)?.length === 1),
      );
      const size = attributes.find((attribute) => attribute.name === "ขนาด");
      if (size && sides.every(Boolean)) {
        size.value = `${sides.map((key) => `${key.replace(/^ความ/, "")} ${specs.get(key)[0]}`).join(" ")} (ขนาดกล่อง)`;
        sides.forEach((key) => specs.delete(key));
      }
      for (const [key, list] of specs) {
        const value = list.join(" / ");
        attributes.push(
          key === "สี"
            ? { name: "สี", value: escapeValue(toColorValue(value)), global: "1" }
            : { name: key, value: escapeValue(value) },
        );
      }
    }

    attributes.forEach((attribute, index) => {
      const columns = ensureAttribute(index + 1);
      tab.getCell(row, columns.name).value = attribute.name;
      tab.getCell(row, columns.value).value = attribute.value;
      // variation ไม่ต้องกำหนด "เห็นได้" (ใช้ของสินค้าแม่)
      tab.getCell(row, columns.visible).value = isVariation ? attribute.visible || null : attribute.visible || "1";
      tab.getCell(row, columns.global).value = attribute.global || "0";
    });
  }
}

// แบรนด์ของร้าน (ยืนยันโดยเจ้าของร้าน) ที่พบในชื่อสินค้า
// WOER ไม่ใช่แบรนด์ของร้าน, LG / SAMSUNG ในชื่อคือ "ใช้ได้กับ" ไม่ใช่ยี่ห้อสินค้า
const knownBrands = [
  ["PRO PLUS", /\bPRO\s?PLUS\b/i],
  ["BEST", /\bBEST\b/],
  ["MITSUMI", /\bMITSUMI\b/],
  ["PERFECTS", /\bPERFECTS\b/],
  ["NEW POWER", /\bNEW POWER\b/],
  ["LEGACY", /\bLEGACY\b/],
];
const isModelCode = (token) =>
  token.length >= 3 &&
  /^[A-Z0-9][A-Z0-9./-]*$/.test(token) &&
  /\d/.test(token) &&
  /[A-Z]/.test(token) &&
  (token.includes("-") || (token.match(/[A-Z]/g) || []).length >= 2) &&
  // หน่วย เช่น 500W 12V 21AH 2CH ไม่ใช่รุ่น
  !/^\d+(\.\d+)?(W|V|AH|MM|CM|HZ|KHZ|CH|U|MAH|OHM)$/.test(token);

function brandAndModel(name) {
  const tokens = name.split(/\s+/).map((token) => token.replace(/^[(\[]+|[)\],;]+$/g, ""));
  const found = knownBrands.find(([, pattern]) => pattern.test(name));
  const labelled = name.match(/รุ่น\s+(\S+)/);
  let model = labelled && isModelCode(labelled[1]) ? labelled[1] : "";
  if (!model && found) {
    // รุ่นมักต่อท้ายชื่อแบรนด์ เช่น "PRO PLUS EQ-9", "MITSUMI EXTRA S05-EX"
    const brandEnd = name.search(found[1]) + name.match(found[1])[0].length;
    model = name.slice(brandEnd).split(/\s+/).map((token) => token.replace(/^[(\[]+|[)\],;]+$/g, "")).find(isModelCode) || "";
  }
  if (!model) model = (found ? tokens.find(isModelCode) : [...tokens].reverse().slice(0, 1).find(isModelCode)) || "";
  return { brand: found ? found[0] : "", model };
}

app.get("/download.csv", async (req, res, next) => {
  if (!existsSync(driveWorkbookPath)) return next();
  try {
    const workbook = await readDriveWorkbook();
    const tab = workbook.worksheets[0];
    // ลิงก์ Drive แบบ /view เปิดเป็นหน้าเว็บ WooCommerce ดึงเป็นรูปไม่ได้
    // แปลงเป็นลิงก์รูปตรงเฉพาะใน CSV (ไฟล์ Excel ต้นฉบับไม่แก้)
    // WooCommerce เอาชื่อไฟล์จาก path ของ URL ต้องลงท้าย .jpg ไม่งั้นขึ้น "not allowed to upload this file type"
    // (#.jpg ไม่ถูกส่งไปที่ server ของ Google และ WordPress แก้นามสกุลให้ตรงชนิดรูปจริงเอง)
    const imageColumn = workbookHeaders(tab).indexOf("ไฟล์รูปภาพ") + 1;
    if (imageColumn)
      for (let row = 2; row <= tab.rowCount; row++) {
        const cell = tab.getCell(row, imageColumn);
        const direct = cell.text.replace(
          /https:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/view[^,\s]*/g,
          "https://lh3.googleusercontent.com/d/$1#.jpg",
        );
        if (direct !== cell.text) cell.value = direct;
      }
    addSpecAttributes(tab);
    const csv = await workbook.csv.writeBuffer();
    res.attachment("woocommerce-products.csv");
    res.type("text/csv; charset=utf-8").send(Buffer.from(csv));
  } catch (error) {
    next(error);
  }
});
app.get("/api/sheet", (req, res) =>
  res.json({
    title: "รายการสินค้า WooCommerce",
    headers: rows[0],
    rows: rows.slice(1),
  }),
);
app.get("/download.xlsx", (req, res) => {
  res.set({
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="woocommerce-products.xlsx"',
  });
  res.send(Buffer.from(file));
});
app.post("/api/sml-stock", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : null;
  if (
    !codes ||
    codes.length > 5000 ||
    codes.some((code) => typeof code !== "string" || code.length > 100)
  )
    return res.status(400).json({ error: "รายการรหัสสินค้าไม่ถูกต้อง" });
  try {
    const result = await smlPool.query({
      text: `SELECT DISTINCT ON (lower(BTRIM(i.code))) lower(BTRIM(i.code)) AS code,
                    i.balance_qty, i.unit_standard AS unit
             FROM ic_inventory i
             WHERE lower(BTRIM(i.code)) = ANY($1::text[])
             ORDER BY lower(BTRIM(i.code)), i.roworder DESC`,
      values: [codes.map((code) => code.trim().toLocaleLowerCase())],
    });
    const stock = {};
    for (const row of result.rows)
      stock[row.code] = { qty: row.balance_qty, unit: row.unit };
    res.json({ stock, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("SML stock query failed:", error.code || error.message);
    res.status(503).json({ error: "ดึงคลังจาก SML ไม่สำเร็จ" });
  }
});

app.get("/api/sml-suggest", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
  if (!code || code.length > 100)
    return res.status(400).json({ error: "รหัสสินค้าไม่ถูกต้อง" });
  // หารหัสใน SML ที่ขึ้นต้นเหมือนกัน ตัดท้ายทีละตัวจนเจอ (ขั้นต่ำ 4 ตัวอักษร)
  try {
    for (let length = code.length; length >= Math.min(4, code.length); length--) {
      const prefix = code.slice(0, length).toLocaleLowerCase();
      const result = await smlPool.query({
        text: `SELECT DISTINCT ON (lower(BTRIM(code))) BTRIM(code) AS code, name_1 AS name,
                      balance_qty, unit_standard AS unit
               FROM ic_inventory
               WHERE lower(BTRIM(code)) LIKE $1 || '%' ESCAPE '\\'
               ORDER BY lower(BTRIM(code)), roworder DESC
               LIMIT 30`,
        values: [prefix.replace(/[\\%_]/g, "\\$&")],
      });
      if (result.rowCount) return res.json({ prefix, rows: result.rows });
    }
    res.json({ prefix: "", rows: [] });
  } catch (error) {
    console.error("SML suggest failed:", error.code || error.message);
    res.status(503).json({ error: "ค้นหารหัสใน SML ไม่สำเร็จ" });
  }
});

app.post("/api/update-sku", async (req, res) => {
  const oldCode =
    typeof req.body?.oldCode === "string" ? req.body.oldCode.trim() : "";
  const newCode =
    typeof req.body?.newCode === "string" ? req.body.newCode.trim() : "";
  if (!oldCode || !newCode || newCode.length > 100)
    return res.status(400).json({ error: "รหัสสินค้าไม่ถูกต้อง" });
  if (!existsSync(driveWorkbookPath))
    return res.status(503).json({ error: "ไม่พบไฟล์ Excel สำหรับแก้ไข" });
  if (savingProduct)
    return res.status(429).json({ error: "กำลังบันทึกอยู่ กรุณาลองใหม่" });
  let temporaryPath;
  savingProduct = true;
  try {
    const exists = await smlPool.query({
      text: `SELECT BTRIM(code) AS code FROM ic_inventory
             WHERE lower(BTRIM(code)) = lower($1) LIMIT 1`,
      values: [newCode],
    });
    if (!exists.rowCount)
      return res.status(400).json({ error: "ไม่พบรหัสใหม่นี้ใน SML" });
    const smlCode = exists.rows[0].code;
    const workbook = await readDriveWorkbook();
    const tab = workbook.worksheets[0];
    const headers = workbookHeaders(tab);
    const skuColumn = headers.indexOf("รหัสสินค้า") + 1;
    const parentColumn = headers.indexOf("หลัก") + 1;
    if (!skuColumn) throw new Error("SKU_COLUMN_NOT_FOUND");
    const oldKey = oldCode.toLocaleLowerCase();
    const newKey = smlCode.toLocaleLowerCase();
    let target = 0;
    for (let row = 2; row <= tab.rowCount; row++) {
      const sku = tab.getCell(row, skuColumn).text.trim().toLocaleLowerCase();
      if (sku === newKey && newKey !== oldKey)
        return res
          .status(409)
          .json({ error: `รหัส ${smlCode} มีอยู่ในไฟล์แล้ว (แถว ${row})` });
      if (sku === oldKey) target = row;
    }
    if (!target)
      return res.status(404).json({ error: "ไม่พบรหัสเดิมในไฟล์ Excel" });
    tab.getCell(target, skuColumn).value = smlCode;
    // ตัวเลือกสินค้าที่อ้างรหัสแม่เดิมในคอลัมน์ "หลัก" ต้องเปลี่ยนตาม
    let children = 0;
    if (parentColumn)
      for (let row = 2; row <= tab.rowCount; row++) {
        const cell = tab.getCell(row, parentColumn);
        if (cell.text.trim().toLocaleLowerCase() === oldKey) {
          cell.value = smlCode;
          children++;
        }
      }
    temporaryPath = `${driveWorkbookPath}.${process.pid}.${Date.now()}.tmp`;
    await workbook.xlsx.writeFile(temporaryPath);
    await rename(temporaryPath, driveWorkbookPath);
    temporaryPath = null;
    console.log(`SKU updated: ${oldCode} -> ${smlCode} (row ${target}, ${children} children)`);
    res.json({ saved: true, oldCode, newCode: smlCode, row: target, children });
  } catch (error) {
    console.error("Update SKU failed:", error.code || error.message);
    res.status(500).json({ error: "แก้ไขรหัสใน Excel ไม่สำเร็จ" });
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => {});
    savingProduct = false;
  }
});

// สถานะ "ลงเว็บไซต์แล้ว" เก็บแยกในไฟล์ JSON (ไม่แก้ SML และไม่แก้ Excel)
// key = รหัสสินค้าตัวเล็ก, hash = ลายนิ้วมือข้อมูลสินค้าตอนลงเว็บ ใช้เตือนเมื่อข้อมูลเปลี่ยนภายหลัง
const webPostedPath = fileURLToPath(
  new URL("./data/web-posted.json", import.meta.url),
);
let webPosted = null;
let webPostedQueue = Promise.resolve();

async function loadWebPosted() {
  if (webPosted) return webPosted;
  try {
    webPosted = JSON.parse(await readFile(webPostedPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    webPosted = {};
  }
  return webPosted;
}

app.get("/api/web-posted", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    res.json({ items: await loadWebPosted() });
  } catch (error) {
    console.error("Read web-posted failed:", error.code || error.message);
    res.status(500).json({ error: "โหลดสถานะลงเว็บไม่สำเร็จ" });
  }
});

app.post("/api/web-posted", (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const posted = req.body?.posted;
  const hash = typeof req.body?.hash === "string" ? req.body.hash : "";
  if (
    !code ||
    code.length > 100 ||
    typeof posted !== "boolean" ||
    (posted && !/^[0-9a-f]{1,16}$/.test(hash))
  )
    return res.status(400).json({ error: "ข้อมูลสถานะลงเว็บไม่ถูกต้อง" });
  // เขียนทีละคำขอ กันไฟล์ทับกันเมื่อกดหลายแถวพร้อมกัน
  webPostedQueue = webPostedQueue.then(async () => {
    let temporaryPath;
    try {
      const items = { ...(await loadWebPosted()) };
      const key = code.toLocaleLowerCase();
      if (posted) items[key] = { code, postedAt: new Date().toISOString(), hash };
      else delete items[key];
      temporaryPath = `${webPostedPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(items, null, 2), "utf8");
      await rename(temporaryPath, webPostedPath);
      temporaryPath = null;
      webPosted = items;
      res.json({ saved: true, item: items[key] || null });
    } catch (error) {
      console.error("Save web-posted failed:", error.code || error.message);
      res.status(500).json({ error: "บันทึกสถานะลงเว็บไม่สำเร็จ" });
    } finally {
      if (temporaryPath) await unlink(temporaryPath).catch(() => {});
    }
  });
});

app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));
const server = app.listen(3002, "127.0.0.1", () =>
  console.log("Product sheet: http://localhost:3002"),
);
process.on("SIGINT", () =>
  server.close(async () => {
    await smlPool.end();
    process.exit(0);
  }),
);
