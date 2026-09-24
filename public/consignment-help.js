const topics = {
  products: [
    "สินค้าที่แสดง",
    "จำนวนรหัสสินค้าที่ตรงกับคำค้นหาและตัวกรองทั้งหมด นับรหัสละ 1 ครั้ง แม้สินค้านั้นจะมีหลายรายการรับ–เบิก",
    "เช่น แสดง 13 หมายถึงสินค้า 13 รหัส ไม่ใช่สินค้า 13 ชิ้น และนับครบทุกหน้าตาราง",
  ],
  stock: [
    "มีสินค้าคงเหลือ",
    "จำนวนรหัสสินค้าในผลลัพธ์ที่มียอดคงเหลือมากกว่า 0 ไม่ใช่ผลรวมจำนวนสินค้าที่เหลือ",
    "ถ้าเลือกสถานะ “มีคงเหลือ” ตัวเลขนี้จะเท่ากับ “สินค้าที่แสดง” เพราะทุกสินค้าที่เลือกมีของเหลือ",
  ],
  flow: [
    "เบิกออก / คงเหลือ",
    "ตัวเลขหลักคือเบิกออกสะสมของสินค้าที่ตรงตัวกรอง ส่วนคงเหลือคือยอดหลังรายการล่าสุดของแต่ละรหัสรวมกัน อัตราคงเหลือ = คงเหลือ ÷ เบิกออก",
    "ถ้าสินค้าที่แสดงมีหลายหน่วย ยอดรวมจะปนหน่วยกัน (เช่น ตัว + คู่) ให้เลือกตัวกรอง “หน่วย” ก่อนเปรียบเทียบ ไม่ควรอ่านเป็นจำนวนชิ้นเดียวกัน",
  ],
  recent: [
    "เคลื่อนไหวล่าสุด",
    "วันที่ทำรายการล่าสุดของสินค้าที่ตรงตัวกรอง อาจเป็นการรับเข้า ยกมา เบิกออก หรือขายที่ตัดสต็อก",
    "วันที่นี้อาจเก่ากว่าวันนี้ หากสินค้าที่เลือกไม่มีรายการใหม่ ส่วนเวลา “อัปเดต” ด้านบนคือเวลาที่โหลดข้อมูลจาก SML",
  ],
  code: [
    "สินค้า / รหัสฝาก",
    "ชื่อและรหัสสินค้าเต็มใช้ระบุสินค้าแต่ละรายการ รหัสฝากแยกมาจากต้นรหัสสินค้า ส่วนตัวกรองรหัสฝากใช้เพียง 3 ตัวแรก",
    "ตัวอย่าง ฝหย055UK12 → กลุ่มรหัสฝาก ฝหย เลือก ฝหย จะรวมสินค้าทั้งหมดที่ขึ้นต้นด้วย ฝหย คลิกแถวเพื่อดูประวัติ วันที่ และเลขที่เอกสาร",
  ],
  incoming: [
    "รับเข้า / ยกมา",
    "จำนวนเพิ่มสต็อกสะสมจากประวัติทั้งหมดที่โหลดของสินค้านั้น รวมยอดยกมาและรับคืนที่เพิ่มสต็อก แสดงในหน่วยมาตรฐานของสินค้า",
    "เช่น ยกมา 100 แล้วรับเพิ่ม 20 ช่องนี้แสดง 120 ไม่ได้หมายถึงรับเข้าเฉพาะวันนี้",
  ],
  outgoing: [
    "เบิกออก",
    "จำนวนลดสต็อกสะสมจากประวัติทั้งหมดที่โหลด รวมรายการขายที่ตัดสต็อกสินค้าฝาก ไม่ได้จำกัดเฉพาะเอกสารใบเบิก",
    "เช่น เบิกหรือขายออก 10 และ 15 ช่องนี้แสดง 25 กดแถวสินค้าเพื่อดูวันที่และเอกสารของแต่ละรายการ",
  ],
  balance: [
    "คงเหลือ",
    "ยอดหลังรายการล่าสุดของสินค้านั้น คำนวณสะสมจากจำนวนเพิ่มและลดตามรายงาน SML รวมทุกคลัง ไม่ใช่การบวกยอดคงเหลือทุกแถวในประวัติ",
    "ตัวอย่าง รับเข้า/ยกมา 120 − เบิกออก 25 = คงเหลือ 95 ถ้าเป็น 0 คือหมดแล้ว ถ้าติดลบควรตรวจรายการต้นทาง",
  ],
  unit: [
    "หน่วยสินค้า",
    "จำนวนแต่ละแถวแสดงตามหน่วยมาตรฐานของสินค้านั้น เช่น ตัว คู่ ชุด หรือกป. โดยแปลงหน่วยตาม SML แล้ว",
    "เลือกตัวกรอง “หน่วย” เพื่อเปรียบเทียบสินค้าในหน่วยเดียวกัน ไม่ควรนำจำนวนต่างหน่วยมารวมเป็นยอดชิ้นเดียว",
  ],
  filters: [
    "ค้นหาและเลือกข้อมูล",
    "ค้นหาด้วยชื่อสินค้า รหัสสินค้าเต็ม หรือรหัสฝาก แล้วเลือกภูมิภาค รหัสฝาก 3 ตัว หน่วย และสถานะได้พร้อมกัน สินค้าต้องตรงทุกเงื่อนไขที่เลือก",
    "“ทั้งหมด” คือไม่จำกัดเงื่อนไขนั้น “ล้างตัวกรอง” กลับไปดูทั้งหมด ตัวเลขสรุป ตาราง และ Excel จะอิงสินค้าที่ตรงตัวกรองครบทุกหน้า",
  ],
  exporting: [
    "ส่งออก Excel",
    "ส่งออกสินค้าทั้งหมดที่ตรงคำค้นหาและตัวกรองในขณะกด ไม่จำกัดเฉพาะ 25 แถวที่เห็นในหน้านี้ โดยเรียงเหมือนตาราง",
    "ไฟล์มี 3 ชีต: สรุปสินค้าฝาก, ประวัติรับเบิกทั้งหมดของสินค้าที่เลือก และเงื่อนไขการส่งออก จำนวนเต็มไม่แสดง .00 และจำนวนที่มีเศษยังคงทศนิยม",
  ],
  history: [
    "คงเหลือหลังรายการ",
    "ยอดสินค้าที่เหลือทันทีหลังทำรายการในแถวนั้น รวมทุกคลัง ประวัติเรียงรายการล่าสุดไว้ด้านบน",
    "เช่น รับเข้า 100 แล้วเบิก 20 แถวรับเข้าแสดงคงเหลือ 100 ส่วนแถวเบิกแสดง 80 อย่าบวก 100 กับ 80 เพราะเป็นยอดคนละช่วงเวลา",
  ],
  regional: [
    "เบิกออกและคงเหลือ แยกตามภาค",
    "เปรียบเทียบยอดเบิกออกสะสมกับยอดคงเหลือล่าสุดของสินค้าที่ตรงกับตัวกรองปัจจุบัน โดยรวมตามภูมิภาค",
    "แท่งสีแดงคือเบิกออกสะสม แท่งสีฟ้าคือคงเหลือล่าสุด เบิกออกเป็นยอดสะสมจากรายการที่ลดสต็อก ส่วนคงเหลือเป็นยอดล่าสุด ไม่ควรนำสองแท่งมาบวกกัน และควรเลือกหน่วยเดียวกันก่อนเปรียบเทียบ",
  ],
};
const dialog = document.createElement("dialog");
dialog.id = "consignment-help";
dialog.setAttribute("aria-labelledby", "consignment-help-title");
const heading = document.createElement("div");
heading.className = "section-heading";
const title = document.createElement("h2");
title.id = "consignment-help-title";
const close = document.createElement("button");
close.type = "button";
close.textContent = "ปิด ×";
close.setAttribute("aria-label", "ปิดคำอธิบาย");
heading.append(title, close);
const description = document.createElement("p"),
  example = document.createElement("p"),
  data = document.createElement("section");
example.className = "help-example";
data.className = "help-data";
data.setAttribute("aria-label", "ข้อมูลตอนนี้");
dialog.append(heading, description, data, example);
document.body.append(dialog);
close.onclick = () => dialog.close();
// Clicking the backdrop (outside the dialog's own padding) closes it, same as the × button.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
// The page registers a provider returning { rows: [[label, value]], table: { head, rows }, note } for a topic, or null.
let dataProvider = null;
export function setHelpData(provider) {
  dataProvider = provider;
}
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
function renderData(info) {
  data.replaceChildren();
  data.hidden = !info;
  if (!info) return;
  data.append(node("h3", "", "ข้อมูลตอนนี้ · ตามตัวกรองที่เลือก"));
  if (info.note) data.append(node("p", "help-data-note", info.note));
  if (info.rows?.length) {
    const list = node("dl");
    for (const [label, value] of info.rows)
      list.append(node("dt", "", label), node("dd", "", value));
    data.append(list);
  }
  if (info.table?.rows.length) {
    const wrap = node("div", "table-scroll"),
      table = node("table"),
      head = node("tr"),
      body = node("tbody");
    for (const h of info.table.head) head.append(node("th", "", h));
    for (const r of info.table.rows) {
      const tr = node("tr");
      for (const v of r) tr.append(node("td", "", v));
      body.append(tr);
    }
    table.append(node("thead"), body);
    table.tHead.append(head);
    if (info.table.caption) data.append(node("p", "help-data-caption", info.table.caption));
    wrap.append(table);
    data.append(wrap);
  }
}
export function showHelp(key) {
  if (!topics[key]) return;
  [title.textContent, description.textContent, example.textContent] =
    topics[key];
  renderData(dataProvider?.(key) || null);
  dialog.showModal();
}
function attach(selector, key) {
  const target = document.querySelector(selector);
  if (!target) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "consignment-help-button";
  b.textContent = "ⓘ";
  b.setAttribute("aria-label", "คำอธิบาย " + topics[key][0]);
  b.setAttribute("aria-haspopup", "dialog");
  b.onclick = (event) => {
    event.stopPropagation();
    showHelp(key);
  };
  target.append(b);
}
// KPI cards and the filter bar carry their own [data-help] icons.
document.querySelectorAll("[data-help]").forEach((b) =>
  b.addEventListener("click", (event) => {
    event.stopPropagation();
    showHelp(b.dataset.help);
  }),
);
for (const [selector, key] of [
  [".movement-table thead th:nth-child(1)", "code"],
  [".movement-table thead th:nth-child(2)", "recent"],
  [".movement-table thead th:nth-child(3)", "incoming"],
  [".movement-table thead th:nth-child(4)", "outgoing"],
  [".movement-table thead th:nth-child(5)", "balance"],
  [".movement-table thead th:nth-child(6)", "unit"],
  [".consignment-table-actions", "exporting"],
  ["#history thead th:last-child", "history"],
  ["#regional-title", "regional"],
])
  attach(selector, key);
