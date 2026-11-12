# แคตตาล็อกสินค้า (E-Catalog)

หน้า `catalog.html` — ตัวอ่าน PDF แบบพลิกหน้า ไม่แตะฐาน SML

## ไฟล์
- รายการเล่ม: เพิ่มจากหน้าเว็บ → `data/catalogs/catalogs.json`; เล่มถาวร (ถ้ามี) → `src/config/catalogs.js` — `{ id, title, pdf, drive? }`
- ไฟล์ PDF: `data/catalogs/` (นอก Git; เปลี่ยนได้ด้วย env `CATALOG_DIR`) เสิร์ฟ same-origin ที่ `/catalogs/<pdf>`
- Route: `src/routes/catalog.js` (`GET /api/catalogs`, `GET /catalogs/:file`, `/vendor/pdfjs/*`)
- หน้า: `public/catalog.html`, `catalog.css`, `catalog.js`
- pdf.js: npm `pdfjs-dist@3.11.174` (pinned) เปิด `isEvalSupported:false` เสมอ (CVE-2024-4367)

## สิทธิ์
- เปิดได้ทุกคน รวมถึงลูกค้าที่ไม่มีบัญชี (ส่งลิงก์ให้ลูกค้าได้) และทุก role รวม Reviewer — ไม่มี permission แยก
- ล็อกอินอยู่: หน้าเต็มพร้อม sidebar · ไม่ได้ล็อกอิน: server ส่งหน้าเดียวกันแต่ตัด sidebar ออก (`body.ecat-public`)
- ที่เปิดสาธารณะมีเท่านี้ (GET/HEAD): `/catalog.html|css|js`, `/api/catalogs`, `/catalogs/<pdf>`, `/vendor/pdfjs/{build,cmaps,standard_fonts}` — `isCatalogPublicRead` ใน `src/routes/catalog.js` ใช้ทั้งใน auth.js และ access.js
- เสิร์ฟเฉพาะไฟล์ที่อยู่ใน config ไม่รับ path จาก request · อย่าใส่ PDF ที่เป็นข้อมูลภายในในรายการนี้ เพราะทุกคนเปิดได้

## เพิ่มเล่มใหม่
จากหน้าเว็บ (แนะนำ) — ปุ่ม "＋ เพิ่มแคตตาล็อก" ข้างแท็บ เห็นเฉพาะคนที่มีสิทธิ์ `catalog_manage` (Super Admin เสมอ; ให้ role/คนอื่นได้ในหน้า System Admin)
1. กรอกชื่อเล่ม + ลิงก์ Google Drive (ไฟล์ต้องแชร์ "ทุกคนที่มีลิงก์") → บันทึก — เก็บใน `data/catalogs/catalogs.json` ไม่ต้องรีสตาร์ต
2. id/ลิงก์ `#...` สร้างจากชื่อภาษาอังกฤษ (เช่น "Car Audio" → `#car-audio`) · ชื่อไทยล้วนได้ `#catalog`, `#catalog-2`
3. ปุ่ม "ลบเล่ม" ลบได้เฉพาะเล่มที่เพิ่มจากหน้าเว็บ (ไม่ลบไฟล์ใน Drive)
4. Super Admin ใช้ปุ่ม "แก้ไขเล่ม" เพื่อแก้ชื่ออย่างเดียว (ใช้ไฟล์/ลิงก์เดิม), อัปโหลด PDF ทดแทน หรือเปลี่ยนลิงก์ Drive ผ่าน `PUT /api/catalogs/:id/details` โดยคง id และลิงก์แชร์เดิม เปลี่ยนแหล่งไฟล์แล้วจะล้างหมวดหมู่ที่กำหนดเองเพื่อสร้างจาก PDF ใหม่ ไฟล์เดิมยังเก็บบนดิสก์แต่ไม่อยู่ในรายการที่เสิร์ฟ

แก้ไฟล์ config (เล่มถาวร ลบจากหน้าเว็บไม่ได้):
แบบลิงก์ Google Drive (ไม่ต้องอัปโหลดไฟล์)
1. ใน Drive ตั้งแชร์ไฟล์ PDF เป็น "ทุกคนที่มีลิงก์ (ผู้มีสิทธิ์อ่าน)" แล้วคัดลอกลิงก์
2. เพิ่มบรรทัดใน `src/config/catalogs.js` เช่น `{ id: 'pro-audio', title: 'Pro Audio', pdf: 'pro-audio-web.pdf', drive: 'https://drive.google.com/file/d/<id>/view' }`
3. รีสตาร์ต Dashboard — เซิร์ฟเวอร์ดาวน์โหลดไฟล์มาเก็บที่ `data/catalogs/<pdf>` ตอนมีคนเปิดครั้งแรก และเช็กไฟล์ใหม่จาก Drive ทุก 6 ชม. (แก้ไฟล์ใน Drive แล้วไม่ต้องทำอะไร)
- ไฟล์ที่ไม่ได้แชร์ → หน้าแจ้ง "ดึงไฟล์จาก Google Drive ไม่สำเร็จ" (502) · จำกัดขนาด 400 MB

แบบวางไฟล์เอง
1. วางไฟล์ PDF (ชื่อเป็น a-z 0-9 . _ -) ใน `data/catalogs/`
2. เพิ่มบรรทัดใน `src/config/catalogs.js` (ไม่มี `drive`) แล้วรีสตาร์ต — ลิงก์ `catalog.html#<id>` ใช้ได้ทันที

## ทดสอบ
`node --test tests/test-catalog.js`
