import express from "express";
import ExcelJS from "exceljs";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";

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
app.get("/download.csv", async (req, res, next) => {
  if (!existsSync(driveWorkbookPath)) return next();
  try {
    const csv = await (await readDriveWorkbook()).csv.writeBuffer();
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
