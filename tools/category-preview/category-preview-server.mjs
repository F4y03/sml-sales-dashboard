// เปิดหน้าจำลองหมวดสินค้าให้คนในวงแลนตรวจและแก้หมวด/ราคา (เฉพาะหน้านี้หน้าเดียว)
// รัน: node category-preview-server.mjs   → http://127.0.0.1:3010/ (เปิดให้วงแลน: ตั้ง CATEGORY_HOST=0.0.0.0)
// การแก้ไข: <CATEGORY_DATA_DIR>/category-edits.json (ค่าล่าสุดต่อรหัส)
// ประวัติ:   <CATEGORY_DATA_DIR>/category-edit-log.jsonl (หนึ่งบรรทัดต่อการแก้ หนึ่งช่อง)
import { createServer } from "node:http";
import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync, copyFileSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

// Program files sit next to this script (in Git); team edits and CSVs live in CATEGORY_DATA_DIR (not in Git).
const DATA = pathToFileURL((process.env.CATEGORY_DATA_DIR || "C:/category-preview").replace(/[\\/]*$/, "/"));
const PAGE = new URL("./category-preview.html", import.meta.url);
const TREE = new URL("./category-plan-tree.txt", import.meta.url);
const EDITS = new URL("./category-edits.json", DATA);
const LOG = new URL("./category-edit-log.jsonl", DATA);
const IMPORT_CSV = new URL("./all-categories-import.csv", DATA);
const PRICE_CSV = new URL("./all-price-updates.csv", DATA);
const PRODUCTS_CSV = new URL("./products-ALL_2026-10-30_TH.csv", DATA);
const PORT = Number(process.env.CATEGORY_PORT) || 3010;
// A new server has no data folder yet: create it, and name the files that still have to be copied in.
mkdirSync(DATA, { recursive: true });
const missingFiles = () => [IMPORT_CSV, PRICE_CSV, PRODUCTS_CSV].filter((u) => !existsSync(u)).map((u) => decodeURIComponent(u.pathname.split("/").pop()));
if (missingFiles().length) console.warn("ยังไม่มีไฟล์ข้อมูลใน", fileURLToPath(DATA) + ":", missingFiles().join(", "));

// ---- เขียนผลการแก้ลง CSV ทันที ----
const parseCsv = (t) => { t = t.replace(/^﻿/, ""); const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; } else f += ch; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows; };
const csvText = (rows) => "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
const writeAtomic = (url, text) => { const tmp = new URL(url.href + ".tmp"); writeFileSync(tmp, text); renameSync(tmp, url); };
const backupOnce = (url) => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const bak = new URL(url.href.replace(/\.csv$/, `.before-web-edit-${day}.csv`));
  if (existsSync(url) && !existsSync(bak)) copyFileSync(url, bak);
};
// WooCommerce: ใส่ทุกชั้นของหมวด และ escape คอมมาในชื่อหมวดเป็น \,
const wooCats = (leafPaths) => {
  const set = new Set();
  for (const leaf of leafPaths) {
    const parts = leaf.split(" > ").map((p) => p.replace(/,/g, "\\,"));
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join(" > "));
  }
  return [...set].join(", ");
};
function writeCategoryCsv(sku, cats) {
  backupOnce(IMPORT_CSV);
  const rows = parseCsv(readFileSync(IMPORT_CSV, "utf8"));
  const row = rows.find((r, i) => i > 0 && r[0] === sku);
  if (row) row[1] = wooCats(cats); else rows.push([sku, wooCats(cats)]);
  writeAtomic(IMPORT_CSV, csvText(rows.filter((r) => r.length > 1 || r[0])));
}
function writePriceCsv(edits) {
  backupOnce(PRICE_CSV);
  const rows = [["รหัสสินค้า", "ราคาปกติ"]];
  for (const [sku, e] of Object.entries(edits)) if (e.priceChanged && e.price !== "") rows.push([sku, e.price]);
  writeAtomic(PRICE_CSV, csvText(rows));
}

const leaves = new Set(readFileSync(TREE, "utf8").split("\n").map((s) => s.trim()).filter(Boolean));
const loadEdits = () => (existsSync(EDITS) ? JSON.parse(readFileSync(EDITS, "utf8")) : {});
const saveEdits = (edits) => {
  const tmp = new URL("./category-edits.json.tmp", DATA);
  writeFileSync(tmp, JSON.stringify(edits, null, 2));
  renameSync(tmp, EDITS);
};
const readLog = () =>
  existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse() : [];

createServer((req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };
  const json = (code, data) => send(code, "application/json; charset=utf-8", JSON.stringify(data));
  const path = new URL(req.url, "http://x").pathname;
  if (req.method === "GET" && path === "/") return send(200, "text/html; charset=utf-8", readFileSync(PAGE));
  if (req.method === "GET" && path === "/api/edits") return json(200, loadEdits());
  if (req.method === "GET" && path === "/api/log") return json(200, readLog());
  // CSV สินค้าทั้งหมด = ไฟล์สินค้าต้นฉบับทุกคอลัมน์ แทนหมวดด้วยหมวดใหม่ และราคาด้วยราคาที่แก้ในหน้านี้
  if (req.method === "GET" && path === "/download/all.csv") {
    try {
      const rows = parseCsv(readFileSync(PRODUCTS_CSV, "utf8")).filter((r) => r.length > 1 || r[0]);
      const head = rows[0];
      const [skuCol, catCol, priceCol] = ["รหัสสินค้า", "หมวดหมู่", "ราคาปกติ (บาท)"].map((n) => head.indexOf(n));
      const cats = new Map(parseCsv(readFileSync(IMPORT_CSV, "utf8")).slice(1).map((r) => [r[0], r[1]]));
      const edits = loadEdits();
      for (const r of rows.slice(1)) {
        if (cats.has(r[skuCol])) r[catCol] = cats.get(r[skuCol]);
        if (edits[r[skuCol]]?.priceChanged && edits[r[skuCol]].price !== "") r[priceCol] = edits[r[skuCol]].price;
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="products-all-${stamp}.csv"`, "Cache-Control": "no-store" });
      return res.end(csvText(rows));
    } catch {
      return send(500, "text/plain; charset=utf-8", "สร้างไฟล์ไม่สำเร็จ");
    }
  }
  // ดาวน์โหลดไฟล์ CSV ล่าสุด (รวมการแก้ในหน้านี้แล้ว)
  const downloads = { "/download/categories.csv": IMPORT_CSV, "/download/prices.csv": PRICE_CSV };
  if (req.method === "GET" && downloads[path]) {
    if (!existsSync(downloads[path])) return send(404, "text/plain; charset=utf-8", "ยังไม่มีไฟล์");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const fname = (path.includes("prices") ? "price-updates-" : "categories-import-") + stamp + ".csv";
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fname}"`, "Cache-Control": "no-store" });
    return res.end(readFileSync(downloads[path]));
  }
  if (req.method !== "POST" || !["/api/edit", "/api/revert", "/api/log/delete"].includes(path)) return send(404, "text/plain", "not found");
  let body = "";
  req.on("data", (d) => {
    body += d;
    if (body.length > 20000) req.destroy();
  });
  req.on("end", () => {
    let input;
    try { input = JSON.parse(body); } catch { return json(400, { error: "ข้อมูลไม่ถูกต้อง" }); }
    const name = String(input.who || "").trim().slice(0, 40);
    if (!name) return json(400, { error: "กรุณาใส่ชื่อผู้แก้ไขก่อน" });
    const { sku, before } = input;
    if (typeof sku !== "string" || !/^[\w.\-/ ก-๙]{1,40}$/.test(sku)) return json(400, { error: "รหัสสินค้าไม่ถูกต้อง" });
    const at = new Date().toISOString();
    const origCats = Array.isArray(before?.cats) ? before.cats.filter((c) => leaves.has(c)) : [];
    const origPrice = String(before?.price ?? "");
    const sameSet = (a, b) => a.length === b.length && a.every((c) => b.includes(c));
    const log = (changes) => { for (const c of changes) appendFileSync(LOG, JSON.stringify({ at, who: name, sku, ...c }) + "\n"); };
    // เขียน CSV ก่อน แล้วค่อยเก็บ edits — ถ้าเขียนไฟล์ไม่ได้ (เช่น เปิดค้างใน Excel) จะแจ้งและไม่บันทึกครึ่งๆ กลางๆ
    const commit = (edits, catsToWrite) => {
      try {
        if (catsToWrite) writeCategoryCsv(sku, catsToWrite);
        writePriceCsv(edits);
      } catch {
        const missing = missingFiles();
        json(500, { error: missing.length
          ? `ไม่พบไฟล์ข้อมูลในโฟลเดอร์ ${fileURLToPath(DATA)} (${missing.join(", ")}) — ยังไม่ได้บันทึก`
          : "เขียนไฟล์ CSV ไม่ได้ (ปิดไฟล์ใน Excel ก่อน) — ยังไม่ได้บันทึก" });
        return false;
      }
      saveEdits(edits);
      return true;
    };

    if (path === "/api/log/delete") {
      // ลบแถวประวัติ — เก็บแถวที่ถูกลบไว้ใน category-edit-log-deleted.jsonl
      const lines = existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : [];
      const i = lines.findIndex((l) => { const e = JSON.parse(l); return e.at === input.at && e.sku === sku && e.field === input.field; });
      if (i < 0) return json(404, { error: "ไม่พบแถวนี้ (อาจถูกลบไปแล้ว)" });
      appendFileSync(new URL("./category-edit-log-deleted.jsonl", DATA), JSON.stringify({ ...JSON.parse(lines[i]), deletedBy: name, deletedAt: at }) + "\n");
      lines.splice(i, 1);
      writeAtomic(LOG, lines.length ? lines.join("\n") + "\n" : "");
      console.log(new Date().toLocaleTimeString(), name, "ลบประวัติ", sku, input.field);
      return json(200, { edits: loadEdits(), log: readLog() });
    }

    const edits = loadEdits();
    const prev = edits[sku];
    if (path === "/api/revert") {
      if (!prev) return json(200, { edits, log: readLog() });
      if (!origCats.length) return json(400, { error: "ไม่พบหมวดเดิมของสินค้านี้" });
      delete edits[sku];
      if (!commit(edits, sameSet(prev.cats, origCats) ? null : origCats)) return;
      const changes = [];
      if (!sameSet(prev.cats, origCats)) changes.push({ field: "คืนค่าเดิม (หมวดหมู่)", before: prev.cats.join(" + "), after: origCats.join(" + ") });
      if (String(prev.price) !== origPrice) changes.push({ field: "คืนค่าเดิม (ราคา)", before: String(prev.price), after: origPrice });
      log(changes.length ? changes : [{ field: "คืนค่าเดิม", before: "", after: "" }]);
      console.log(new Date().toLocaleTimeString(), name, "คืนค่าเดิม", sku);
      return json(200, { edits, log: readLog() });
    }

    // /api/edit
    const { cats } = input;
    if (!Array.isArray(cats) || !cats.length || cats.length > 8 || cats.some((c) => !leaves.has(c)))
      return json(400, { error: "หมวดไม่ถูกต้อง (ต้องเลือกจากรายการ อย่างน้อย 1 หมวด)" });
    const priceText = String(input.price ?? "").trim();
    if (priceText && !/^\d{1,8}(\.\d{1,2})?$/.test(priceText)) return json(400, { error: "ราคาต้องเป็นตัวเลข เช่น 1290 หรือ 1290.50" });
    const oldCats = prev?.cats || origCats;
    const oldPrice = String(prev?.price ?? origPrice);
    const changes = [];
    const sameCats = sameSet(oldCats, cats);
    if (!sameCats) changes.push({ field: "หมวดหมู่", before: oldCats.join(" + "), after: cats.join(" + ") });
    if (priceText !== oldPrice) changes.push({ field: "ราคา", before: oldPrice, after: priceText });
    if (!changes.length) return json(200, { edits, log: readLog(), changed: 0 });
    // แก้กลับจนตรงค่าเดิมทั้งหมด = ไม่ถือว่าแก้
    if (sameSet(cats, origCats) && priceText === origPrice) delete edits[sku];
    else edits[sku] = { cats, price: priceText, priceChanged: priceText !== origPrice, who: name, at };
    if (!commit(edits, sameCats ? null : cats)) return;
    log(changes);
    console.log(new Date().toLocaleTimeString(), name, "แก้", sku, changes.map((c) => c.field).join(", "));
    json(200, { edits, log: readLog(), changed: changes.length });
  });
}).listen(PORT, process.env.CATEGORY_HOST || "127.0.0.1", () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log("เปิดแล้ว:", ips.map((ip) => `http://${ip}:${PORT}/`).join("  "));
});
