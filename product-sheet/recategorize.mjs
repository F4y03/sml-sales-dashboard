// จัดหมวดหมู่สินค้า WooCommerce ใหม่จากชื่อสินค้า (1 สินค้าอยู่ได้หลายหมวด)
// รัน: node product-sheet/recategorize.mjs           -> ดูผล + เขียน test-results/recategorize-preview.csv
//      node product-sheet/recategorize.mjs --write   -> สำรองไฟล์เดิมแล้วเขียนคอลัมน์ "หมวดหมู่" ใหม่
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";

const workbookPath = fileURLToPath(
  new URL(
    "../product-image-drive-output/products-with-individual-drive-links.xlsx",
    import.meta.url,
  ),
);
const previewPath = fileURLToPath(
  new URL("../test-results/recategorize-preview.csv", import.meta.url),
);

// หมวดหลัก (ตามหน้า "สินค้า" ใน artifact)
const OUTDOOR = "เครื่องเสียงกลางแจ้ง";
const UNIT = "ดอกลำโพง & ยูนิต";
const BOX = "ตู้ลำโพง";
const AMP = "แอมป์ & มิกเซอร์";
const MIC = "ไมโครโฟน";
const RACK = "ตู้แร็ค & ขาตั้ง";
const CAR = "เครื่องเสียงรถยนต์";
const CABLE = "สายสัญญาณ & ปลั๊ก";
const PART = "อะไหล่ & อุปกรณ์ช่าง";

// WooCommerce ใช้ "," คั่นหมวด จึงห้ามมี "," ในชื่อหมวด
const SPK = "ดอกลำโพง";
const speakerSize = (name) => {
  const inch = Number(name.match(/(\d+(?:\.\d+)?)\s*(?:นิ้ว|")/)?.[1]);
  if (!inch) return null;
  if (inch <= 8) return 'ดอกลำโพง 4" / 6" / 8"';
  if (inch <= 10) return 'ดอกลำโพง 10"';
  if (inch <= 12) return 'ดอกลำโพง 12"';
  if (inch <= 15) return 'ดอกลำโพง 15"';
  return 'ดอกลำโพง 18"';
};
const path = (...parts) => parts.filter(Boolean).join(" > ");
const has = (name, ...words) => words.some((w) => name.includes(w));

// คืนรายการ path หมวด; ลำดับกฎสำคัญ (เฉพาะเจาะจงก่อน)
function classify(rawName, oldCategory = "") {
  const name = rawName.replace(/\s+/g, " ").trim();
  const n = name.toUpperCase();
  const out = [];

  // --- อะไหล่ว้อยส์ (ต้องมาก่อนดอกลำโพง/ไมค์) ---
  if (has(name, "ว้อยส์", "วอยส์") && !has(name, "ว้อยส์คู่")) {
    if (has(name, "ไมโครโฟน", "ไมล์ลอย", "ไมค์ลอย"))
      return [path(MIC, "ไมโครโฟน", "วอยส์ไมค์"), path(OUTDOOR, "ไมโครโฟน", "วอยส์ไมค์")];
    return [path(UNIT, SPK, "วอยส์ลำโพง"), path(OUTDOOR, SPK, "วอยส์ลำโพง")];
  }

  // --- อะไหล่เครื่องซักผ้า ---
  if (has(name, "เครื่องซักผ้า", "ซิลลูกยาง", "ซีลถังปั่น", "ซีลยางถังปั่น", "มู่เล่ย์"))
    return [path(PART, "อะไหล่เครื่องซักผ้า")];

  // --- คาปาซิเตอร์ ---
  if (/^(คาปาซิเตอร์ )?C /.test(name)) {
    const sub = has(name, "พัดลม")
      ? "พัดลม"
      : has(name, "อลูมิเนียม")
        ? "อลูมิเนียม"
        : has(name, "กระบอกขาว")
          ? "กระบอกขาว"
          : has(name, "กระบอกดำ")
            ? "กระบอกดำ"
            : n.includes("MPT")
              ? "MPT คาปาซิเตอร์"
              : "MET คาปาซิเตอร์";
    return [path(PART, "คาปาซิเตอร์", sub)];
  }

  // --- เครื่องมือช่าง ---
  if (has(name, "สเปรย์")) return [path(PART, "อุปกรณ์ช่าง", "สเปรย์")];
  if (has(name, "มิเตอร์")) return [path(PART, "อุปกรณ์ช่าง", "มัลติมิเตอร์")];
  if (/^คีม/.test(name)) return [path(PART, "อุปกรณ์ช่าง", "คีม")];
  if (has(name, "ปืนยิงกาว", "กาวแท่ง")) return [path(PART, "อุปกรณ์ช่าง", "ปืนยิงกาว")];
  if (has(name, "หัวแร้ง")) return [path(PART, "อุปกรณ์ช่าง", "หัวแร้ง")];
  if (has(name, "ดูดตะกั่ว")) return [path(PART, "อุปกรณ์ช่าง", "ที่ดูดตะกั่ว")];

  // --- อะไหล่ทั่วไป ---
  if (has(name, "สวิทช์")) {
    const sub = has(name, "กดติดปล่อยดับ", "กดติดกดดับ")
      ? "สวิทช์กดติดปล่อยดับ"
      : has(name, "EDK", "กระดก")
        ? "สวิทช์ EDK"
        : has(name, "กระจก")
          ? "สวิทช์กระจก"
          : has(name, "แลมป์", "โคมไฟ")
            ? "สวิทช์แลมป์"
            : "สวิทช์โยก";
    return [path(PART, "สวิทช์", sub)];
  }
  if (has(name, "ปากคีบ")) {
    out.push(path(PART, "ปากคีบ"));
    if (has(name, "แบตเตอรี่")) out.push(path(CAR, "เครื่องเสียงรถยนต์"));
    return out;
  }
  if (has(name, "ฟิวส์")) {
    out.push(path(PART, "กระบอกฟิวส์"));
    if (has(name, "รถยนต์", "ANL")) out.push(path(CAR, "เครื่องเสียงรถยนต์"));
    return out;
  }
  if (/^แบตเตอรี่/.test(name)) return [path(PART, "แบตเตอรี่")];
  if (/^พัดลม/.test(name)) return [path(PART, "พัดลมระบายอากาศ")];
  if (has(name, "หลอดหน้าปัด", "หลอด LED")) return [path(PART, "หลอดหน้าปัด")];
  if (has(name, "อแด็ปเตอร์")) return [path(PART, "อุปกรณ์ช่าง")];

  // --- สายรัด / ท่อหด / หางปลา ---
  if (has(name, "เคเบิ้ลไทร์", "สายรัดพลาสติก")) return [path(CABLE, "สายรัดพลาสติก")];
  if (/^ท่อหด/.test(name)) return [path(CABLE, "ท่อหด")];
  if (has(name, "หางปลา", "หัวเสียบ", "ปลอกพลาสติก")) return [path(CABLE, "หางปลา")];

  // --- สายสัญญาณ ---
  if (/^สาย/.test(name) || has(name, "สายย้ายเสา")) {
    if (has(name, "ไมค์ลอย")) return [path(MIC, "ไมโครโฟน", "อุปกรณ์")];
    const sub = has(name, "สำเร็จ", "RCA")
      ? "สายสำเร็จรูป"
      : has(name, "โทรศัพท์")
        ? "สายโทรศัพท์"
        : has(name, "แลน")
          ? "สายแลน"
          : has(name, "แบตเตอรี่")
            ? "สายแบตเตอรี่"
            : has(name, "ไมค์")
              ? "สายไมค์"
              : has(name, "ลำโพง")
                ? "สายลำโพง"
                : null;
    out.push(path(CABLE, "สายสัญญาณ", sub));
    if (sub === "สายแบตเตอรี่") out.push(path(CAR, "เครื่องเสียงรถยนต์"));
    return out;
  }
  if (has(name, "หัวแจ๊ค") && has(name, "8P8C")) return [path(CABLE, "สายสัญญาณ", "สายแลน")];
  if (has(name, "หัวแจ๊ค") && has(name, "6P4C")) return [path(CABLE, "สายสัญญาณ", "สายโทรศัพท์")];

  // --- อะไหล่ตู้ลำโพง ---
  if (has(name, "หน้ากากลำโพง")) return [path(BOX, "อะไหล่ตู้ลำโพง", "หน้ากากลำโพง")];
  if (has(name, "ด้ามจับตู้ลำโพง")) return [path(BOX, "อะไหล่ตู้ลำโพง", "หูจับตู้ลำโพง")];
  if (has(name, "แท็ปลำโพง")) return [path(BOX, "อะไหล่ตู้ลำโพง", "แท็ปหลังตู้ลำโพง")];
  if (has(name, "เบ้าเสียบตู้ลำโพง")) return [path(BOX, "อะไหล่ตู้ลำโพง", "เบ้าเสียบตู้ลำโพง")];
  if (has(name, "เน็ตเวิร์ค")) {
    out.push(path(BOX, "อะไหล่ตู้ลำโพง", "เน็ตเวิร์ค"));
    if (has(name, "รถยนต์")) out.push(path(CAR, "เครื่องเสียงรถยนต์"));
    return out;
  }
  if (has(name, "ไบติ้ง")) {
    out.push(path(CABLE, "ปลั๊ก & แจ๊ค", "ไบติ้งโพสต์"));
    if (has(name, "บอร์ด")) out.push(path(BOX, "อะไหล่ตู้ลำโพง", "แท็ปหลังตู้ลำโพง"));
    return out;
  }

  // --- ปลั๊ก & แจ๊ค ---
  if (/^(ปลั๊ก|แจ๊ค)/.test(name)) {
    const subs = [];
    if (has(name, "แคนนอน", "XLR")) subs.push("แคนนอน");
    if (has(name, "75 โอห์ม")) subs.push("75 โอห์ม");
    if (/BNC|TNC/.test(n)) subs.push("BNC / TNC");
    if (/(^|[^A-Z])DC([^A-Z]|$)/.test(n)) subs.push("DC");
    if (/(ปลั๊ก|แจ๊ค) F[ -]|F-TYPE|แจ๊ค F$/.test(n)) subs.push("F");
    if (has(name, "จุดบุหรี่")) subs.push("จุดบุหรี่");
    if (has(name, "อากาศ")) subs.push("อากาศกล้วย");
    if (has(name, "ไมค์", "TR-", "TR ", "TRRS")) subs.push("ไมค์ 6.35 มม.");
    if (n.includes("RCA")) subs.push("RCA");
    if (has(name, "ปลั๊กลำโพง", "แจ๊คลำโพง")) subs.push("สเปคคอน");
    if (has(name, "TRRS")) subs.push("โฟน 3.5 มม.");
    if (has(name, "เยอรมัน", "คอมโบ้", "เม้าท์")) subs.push(null);
    for (const sub of new Set(subs.length ? subs : [null]))
      out.push(path(CABLE, "ปลั๊ก & แจ๊ค", sub));
    if (has(name, "จุดบุหรี่", "รถยนต์")) out.push(path(CAR, "เครื่องเสียงรถยนต์"));
    return out;
  }

  // --- ขาแขวน / ขาตั้ง / แร็ค ---
  if (has(name, "ตู้แร็ค")) return [path(RACK, "ตู้แร็ค")];
  if (has(name, "ขาแขวนทีวี", "ขาแขวนจอ", "LCD-") || has(name, "ขาเสริม LCD"))
    return [path(RACK, "ขาแขวนทีวี")];
  if (has(name, "ขายึดตู้ลำโพง"))
    return [path(RACK, "ขาตั้ง & ขาแขวน", "ขาแขวนตู้ลำโพงติดผนัง")];
  if (has(name, "ขาตั้งไฟพาร์")) return [path(RACK, "ขาตั้ง & ขาแขวน", "ขาตั้งไฟพาร์")];
  if (has(name, "ขาตั้งตู้ลำโพง"))
    return [path(RACK, "ขาตั้ง & ขาแขวน", "ขาตั้งตู้ลำโพง")];
  if (has(name, "ขาไมค์"))
    return [path(RACK, "ขาตั้ง & ขาแขวน", "ขาตั้งไมค์"), path(MIC, "ไมโครโฟน", "อุปกรณ์")];

  // --- ไมโครโฟน ---
  if (has(name, "คอสวมไมค์", "คอหนีบไมค์", "ฟองน้ำสวมหัวไมค์", "กันไมค์กลิ้ง", "กล่องอลูมิเนียมใส่ไมค์"))
    return [path(MIC, "ไมโครโฟน", "อุปกรณ์")];
  if (has(name, "ห้องประชุม")) return [path(MIC, "ไมค์ห้องประชุม")];
  if (has(name, "โทรโข่ง")) return [path(MIC, "โทรโข่ง")];
  if (has(name, "ไซเรน")) return [path(OUTDOOR, "ลำโพงฮอร์น & ยูนิต"), path(UNIT, "ไดร์เวอร์ & ทวิตเตอร์")];
  if (has(name, "ไมค์ลอย", "ไมโครโฟนไร้สาย"))
    return [path(MIC, "ไมโครโฟน", "ไมค์ลอย"), path(OUTDOOR, "ไมโครโฟน", "ไมค์ลอย")];
  if (has(name, "เครื่องขยายเสียงคาดเอว"))
    return [path(MIC, "ไมโครโฟน", "อุปกรณ์"), path(AMP, "เพาเวอร์แอมป์")];
  if (/^ไมโครโฟน/.test(name))
    return [path(MIC, "ไมโครโฟน", "ไมโครโฟนสาย"), path(OUTDOOR, "ไมโครโฟน", "ไมโครโฟนสาย")];

  // --- แอมป์ / มิกเซอร์ ---
  if (has(name, "เพาเวอร์มิกซ์"))
    return [path(AMP, "เพาเวอร์มิกเซอร์"), path(OUTDOOR, "เพาเวอร์มิกเซอร์")];
  if (has(name, "มิกเซอร์")) return [path(AMP, "มิกเซอร์"), path(OUTDOOR, "มิกเซอร์")];
  if (has(name, "ครอสโอเวอร์", "อีควอไรเซอร์") || (has(name, "ปรีแอมป์") && has(name, "แบนด์"))) {
    out.push(path(AMP, "ครอสโอเวอร์ & อีคิว"), path(OUTDOOR, "ครอสโอเวอร์ & อีคิว"));
    if (has(name, "USB")) out.push(path(CAR, "เครื่องเสียงรถยนต์"));
    return out;
  }
  if (has(name, "คาราโอเกะ") && !has(name, "ตู้ลำโพง"))
    return [path(AMP, "แอมป์คาราโอเกะ"), path(OUTDOOR, "แอมป์คาราโอเกะ")];
  if (has(name, "เครื่องขยายแอมป์"))
    return [path(AMP, "แอมป์คาราโอเกะ"), path(OUTDOOR, "แอมป์คาราโอเกะ")];
  if (has(name, "เพาเวอร์แอมป์")) {
    if (has(name, "UNITY-X", "FULL RANGE")) return [path(CAR, "เครื่องเสียงรถยนต์")];
    return [path(AMP, "เพาเวอร์แอมป์"), path(OUTDOOR, "เพาเวอร์แอมป์")];
  }

  // --- ตู้ลำโพง ---
  if (/^(ตู้ลำโพง|ลำโพงติดเพดาน)/.test(name)) {
    if (has(name, "เพดาน")) return [path(BOX, "ลำโพงเพดาน")];
    if (has(name, "คอลัมน์")) return [path(BOX, "ตู้ลำโพงคอลัมน์"), path(OUTDOOR, "ตู้ลำโพงคอลัมน์")];
    if (has(name, "ตู้ลำโพงไม้")) return [path(BOX, "ตู้ลำโพงไม้"), path(BOX, "ตู้ลำโพงพาสซีฟ"), path(OUTDOOR, "ตู้ลำโพงพาสซีฟ")];
    if (has(name, "ขยาย", "แอคทีฟ")) return [path(BOX, "ตู้ลำโพงแอคทีฟ"), path(BOX, "ตู้ลำโพงอเนกประสงค์"), path(OUTDOOR, "ตู้ลำโพงอเนกประสงค์")];
    if (has(name, "คาราโอเกะ")) return [path(BOX, "ตู้ลำโพงพาสซีฟ"), path(OUTDOOR, "ตู้ลำโพงพาสซีฟ")];
    const inch = Number(name.match(/(\d+(?:\.\d+)?)\s*(?:นิ้ว|")/)?.[1]);
    if (inch >= 10) return [path(BOX, "ตู้ลำโพงพาสซีฟ"), path(OUTDOOR, "ตู้ลำโพงพาสซีฟ")];
    return [path(BOX, "ตู้ลำโพงติดผนัง")];
  }

  // --- ฮอร์น / ยูนิต / ทวีทเตอร์ ---
  if (has(name, "ฮอร์น"))
    return [path(UNIT, "ลำโพงฮอร์น & ยูนิต"), path(OUTDOOR, "ลำโพงฮอร์น & ยูนิต")];
  if (/^ยูนิต/.test(name))
    return [path(UNIT, "ไดร์เวอร์ & ทวิตเตอร์"), path(OUTDOOR, "ไดร์เวอร์ & ทวิตเตอร์")];
  if (has(name, "ทวีทเตอร์", "ทวิสเตอร์")) {
    if (has(name, "รถยนต์")) return [path(CAR, "เครื่องเสียงรถยนต์"), path(UNIT, "ไดร์เวอร์ & ทวิตเตอร์")];
    return [path(UNIT, "ไดร์เวอร์ & ทวิตเตอร์"), path(OUTDOOR, "ไดร์เวอร์ & ทวิตเตอร์")];
  }

  // --- ดอกลำโพง ---
  if (/^ดอกลำโพง/.test(name)) {
    const size = speakerSize(name);
    // ดอกรถยนต์: ชื่อระบุรถยนต์ หรือหมวดเดิมอยู่ใต้ "เครื่องเสียงรถยนต์"
    if (has(name, "รถยนต์", "ว้อยส์คู่", "SCORPION") || oldCategory.includes(CAR))
      return [path(UNIT, SPK, size), path(CAR, "เครื่องเสียงรถยนต์")];
    return [path(UNIT, SPK, size), path(OUTDOOR, SPK, size)];
  }

  return [];
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);
const tab = workbook.worksheets[0];
const headers = Array.from({ length: tab.columnCount }, (_, c) =>
  tab.getCell(1, c + 1).text.trim(),
);
const col = (name) => {
  const index = headers.indexOf(name) + 1;
  if (!index) throw new Error(`ไม่พบคอลัมน์ ${name}`);
  return index;
};
const [typeCol, skuCol, nameCol, catCol] = ["ชนิด", "รหัสสินค้า", "ชื่อ", "หมวดหมู่"].map(col);

const preview = [["แถว", "รหัสสินค้า", "ชื่อ", "หมวดเดิม", "หมวดใหม่"]];
const unmatched = [];
const counts = new Map();
let changed = 0;
for (let row = 2; row <= tab.rowCount; row++) {
  if (tab.getCell(row, typeCol).text.trim() === "variation") continue; // ใช้หมวดของสินค้าแม่
  const name = tab.getCell(row, nameCol).text;
  if (!name.trim()) continue;
  const before = tab.getCell(row, catCol).text;
  const leaves = [...new Set(classify(name, before))];
  if (!leaves.length) {
    unmatched.push(`${row}\t${name}`);
    continue; // ไม่เดาหมวด เก็บค่าเดิมไว้
  }
  // WooCommerce: ใส่ทั้ง path ย่อยและหมวดแม่ทุกชั้น
  const all = new Set();
  for (const leaf of leaves) {
    const parts = leaf.split(" > ");
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join(" > "));
  }
  const after = [...all].join(", ");
  for (const leaf of leaves) counts.set(leaf, (counts.get(leaf) || 0) + 1);
  if (after !== before) changed++;
  preview.push([row, tab.getCell(row, skuCol).text, name, before, after]);
  if (process.argv.includes("--write")) tab.getCell(row, catCol).value = after;
}

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
await mkdir(fileURLToPath(new URL("../test-results/", import.meta.url)), { recursive: true });
await writeFile(previewPath, "﻿" + preview.map((r) => r.map(csvCell).join(",")).join("\r\n"));

console.log(`จัดหมวดได้ ${preview.length - 1} รายการ, เปลี่ยน ${changed}, ไม่เข้ากฎ ${unmatched.length}`);
if (unmatched.length) console.log("ไม่เข้ากฎ (คงหมวดเดิม):\n" + unmatched.join("\n"));
console.log("\nจำนวนต่อหมวด:");
for (const [leaf, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0], "th")))
  console.log(`${String(count).padStart(4)}  ${leaf}`);
console.log(`\nตัวอย่างผล: ${previewPath}`);

if (process.argv.includes("--write")) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const backup = workbookPath.replace(/\.xlsx$/, `.backup-${stamp}.xlsx`);
  await copyFile(workbookPath, backup);
  const temporary = `${workbookPath}.${process.pid}.tmp`;
  await workbook.xlsx.writeFile(temporary);
  await rename(temporary, workbookPath);
  console.log(`เขียนไฟล์แล้ว (สำรองไว้ที่ ${backup})`);
}
