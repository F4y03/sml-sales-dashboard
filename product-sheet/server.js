import express from 'express';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const workbook = new ExcelJS.Workbook();
const sheet = await workbook.csv.readFile(fileURLToPath(new URL('./data/products.csv', import.meta.url)), { map: value => value.replace(/\r\n?/g, '\n') });
sheet.name = 'สินค้า';
sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
sheet.columns.forEach((column, i) => { column.width = i === 4 ? 48 : [8,9,30].includes(i) ? 60 : 24; });
sheet.eachRow((row, rowNumber) => {
  row.height = rowNumber === 1 ? 44 : 36;
  row.eachCell({ includeEmpty: true }, cell => {
    cell.numFmt = '@';
    cell.font = { name: 'Tahoma', size: 11, color: { argb: rowNumber === 1 ? 'FFFFFFFF' : 'FF24332D' }, bold: rowNumber === 1 };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber === 1 ? 'FF217346' : rowNumber % 2 === 0 ? 'FFFFFFFF' : 'FFF3F8F5' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFDFE8E2' } }, right: { style: 'thin', color: { argb: 'FFDFE8E2' } } };
  });
});
const rows = Array.from({ length: sheet.rowCount }, (_, i) => Array.from({ length: sheet.columnCount }, (_, j) => String(sheet.getCell(i+1,j+1).value ?? '')));
const file = await workbook.xlsx.writeBuffer();
const app = express();
app.disable('x-powered-by');
const driveWorkbookPath = fileURLToPath(new URL('../product-image-drive-output/products-with-individual-drive-links.xlsx', import.meta.url));
app.get('/api/sheet', async (req, res, next) => {
  if (!existsSync(driveWorkbookPath)) return next();
  try {
    const updated = new ExcelJS.Workbook();
    await updated.xlsx.readFile(driveWorkbookPath);
    const tab = updated.worksheets[0];
    const values = Array.from({ length: tab.rowCount }, (_, r) =>
      Array.from({ length: tab.columnCount }, (_, c) => tab.getCell(r + 1, c + 1).text));
    res.json({ title: 'WooCommerce', headers: values[0], rows: values.slice(1) });
  } catch (error) { next(error); }
});
app.get('/download.xlsx', (req, res, next) => {
  if (!existsSync(driveWorkbookPath)) return next();
  res.download(driveWorkbookPath, 'products-with-individual-drive-links.xlsx');
});
app.get('/api/sheet', (req,res) => res.json({ title: 'รายการสินค้า WooCommerce', headers: rows[0], rows: rows.slice(1) }));
app.get('/download.xlsx', (req,res) => {
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="woocommerce-products.xlsx"' });
  res.send(Buffer.from(file));
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.listen(3002, '127.0.0.1', () => console.log('Product sheet: http://localhost:3002'));
