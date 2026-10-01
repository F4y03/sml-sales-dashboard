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
export function buildWorkbook(ExcelJS, products) {
  const book = new ExcelJS.Workbook();
  book.creator = "SML Dashboard";
  book.created = new Date();
  const summary = book.addWorksheet("สรุปสินค้าฝาก");
  summary.columns = [
    ["รหัสสินค้า", "code", 25],
    ["ชื่อสินค้า", "product", 55],
    ["คงเหลือ", "balance", 18],
    ["หน่วย", "unit", 15],
  ].map(([header, key, width]) => ({ header, key, width }));
  for (const p of products) summary.addRow(p);
  summary.views = [{ state: "frozen", ySplit: 1 }];
  summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF9D1717" },
  };
  summary.getRow(1).height = 26;
  summary.getColumn("balance").eachCell((cell, row) => {
    if (row > 1)
      cell.numFmt = Number.isInteger(cell.value) ? "#,##0" : "#,##0.##########";
  });
  return book;
}
export async function exportConsignment(products, filters, source) {
  const ExcelJS = await loadExcel(),
    book = buildWorkbook(ExcelJS, products),
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
