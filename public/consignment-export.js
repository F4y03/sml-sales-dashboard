let library;
function loadExcel() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!library)
    library = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "assets/exceljs.min.js";
      script.onload = () => resolve(globalThis.ExcelJS);
      script.onerror = () => {
        library = null;
        script.remove();
        reject(new Error("Excel unavailable"));
      };
      document.head.append(script);
    });
  return library;
}
export function buildWorkbook(ExcelJS, products, filters, source) {
  const book = new ExcelJS.Workbook();
  book.creator = "SML Dashboard";
  book.created = new Date();
  const summary = book.addWorksheet("สรุปสินค้าฝาก");
  summary.columns = [
    ["รหัสสินค้า", "code", 25],
    ["ชื่อสินค้า", "product", 55],
    ["รหัสฝาก (3 ตัว)", "prefix", 20],
    ["รหัสฝากจากสินค้า", "customer", 23],
    ["ภูมิภาค", "region", 20],
    ["เคลื่อนไหวล่าสุด", "last", 22],
    ["รับเข้า / ยกมา", "in", 19],
    ["เบิกออก", "out", 18],
    ["คงเหลือ", "balance", 18],
    ["หน่วย", "unit", 15],
  ].map(([header, key, width]) => ({ header, key, width }));
  for (const p of products)
    summary.addRow({
      ...p,
      prefix: p.customer.slice(0, 3),
      last: new Date(p.last + "T00:00:00Z"),
    });
  const history = book.addWorksheet("ประวัติรับเบิก");
  history.columns = [
    ["วันที่", "date", 18],
    ["เลขที่เอกสาร", "docNo", 25],
    ["รหัสสินค้า", "code", 25],
    ["ชื่อสินค้า", "product", 55],
    ["รหัสฝาก", "customer", 20],
    ["รายการ", "type", 25],
    ["จำนวน", "quantity", 18],
    ["คงเหลือหลังรายการ", "balance", 24],
    ["หน่วย", "unit", 15],
  ].map(([header, key, width]) => ({ header, key, width }));
  for (const p of products)
    for (const r of [...p.rows].sort((a, b) => b.index - a.index))
      history.addRow({
        date: new Date(r.date + "T00:00:00Z"),
        docNo: r.docNo || "",
        code: p.code,
        product: p.product,
        customer: p.customer,
        type:
          r.flag === 54
            ? "รับเข้า / ยกมา"
            : r.flag === 44
              ? "เบิกออก (ขาย)"
              : r.flag === 58
                ? "รับคืนจากเบิก"
                : r.type,
        quantity: r.quantity,
        balance: r.balance,
        unit: p.unit,
      });
  for (const sheet of [summary, history]) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF9D1717" },
    };
    sheet.getRow(1).height = 26;
    for (const key of ["in", "out", "balance", "quantity"]) {
      const col = sheet.columns.find((c) => c.key === key);
      if (col)
        col.eachCell((cell, row) => {
          if (row > 1)
            cell.numFmt = Number.isInteger(cell.value)
              ? "#,##0"
              : "#,##0.##########";
        });
    }
  }
  summary.getColumn("last").numFmt = "dd/mm/yyyy";
  history.getColumn("date").numFmt = "dd/mm/yyyy";
  const info = book.addWorksheet("เงื่อนไขการส่งออก");
  info.columns = [
    { header: "หัวข้อ", width: 30 },
    { header: "ค่า", width: 100 },
  ];
  info.addRow(["แหล่งข้อมูล", source]);
  info.addRow(["จำนวนสินค้า", products.length]);
  const labels = {
      search: "คำค้นหา",
      region: "ภูมิภาค",
      customer: "รหัสฝาก 3 ตัว",
      unit: "หน่วย",
      stock: "สถานะสินค้า",
      sort: "เรียงตาม",
    },
    values = {
      positive: "มีคงเหลือ",
      zero: "หมดแล้ว",
      negative: "คงเหลือติดลบ",
      recent: "เคลื่อนไหวล่าสุด",
      out: "เบิกออกมากที่สุด",
      balance: "คงเหลือมากที่สุด",
    };
  for (const [key, value] of filters)
    info.addRow([
      labels[key] || key,
      (key === "stock" || key === "sort" ? values[value] : value) || "ทั้งหมด",
    ]);
  info.addRow([
    "ขอบเขต",
    "สินค้าทั้งหมดที่ตรงตัวกรอง ไม่จำกัดหน้าตาราง พร้อมประวัติทั้งหมดของสินค้าที่เลือก",
  ]);
  info.addRow([
    "หมายเหตุ",
    "จำนวนแยกตามหน่วยของสินค้า เบิกออกรวมการขายที่ตัดสต็อก",
  ]);
  return book;
}
export async function exportConsignment(products, filters, source) {
  const ExcelJS = await loadExcel(),
    book = buildWorkbook(ExcelJS, products, filters, source),
    buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `consignment-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
