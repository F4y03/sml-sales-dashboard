# MARKETPLACE — ยอดขายออนไลน์ Shopee / Lazada / TikTok Shop

นำเข้าจากไฟล์ที่ export จาก Seller Center (ไม่ใช้ API) เก็บใน `data/access.sqlite` (migration `007-marketplace.sql`) — **ไม่แตะ SML**

## ไฟล์ที่เกี่ยวข้อง
- `src/services/marketplaceParser.js` — ตรวจ/อ่านไฟล์ (.xlsx, .csv) ตามหัวคอลัมน์ด้านล่าง
- `marketplace.js` — API `/api/marketplace/upload`, `/uploads`, `/summary`
- `public/marketplace-upload.html|js` — หน้าอัปโหลด (แอดมิน), `public/marketplace.html` + `marketplace-ui.js` — แดชบอร์ด (เจ้าของ), `public/marketplace.css`
- `test-marketplace.js` — ทดสอบ parser, กันออเดอร์ซ้ำ, สิทธิ์ (fixture สังเคราะห์ ไม่มีข้อมูลลูกค้าจริง)

## สิทธิ์
| Permission | ได้อะไร |
|---|---|
| `marketplace_upload` | หน้าอัปโหลด + ประวัติ (ชื่อไฟล์ แพลตฟอร์ม ผู้อัป เวลา) ตอบกลับแค่ "อัปโหลดสำเร็จ" ห้ามคืนตัวเลข/ออเดอร์ |
| `marketplace_view` | แดชบอร์ด `/api/marketplace/summary` (บัญชีจำกัดเขตถูกปฏิเสธเสมอ) |

- Super Admin ได้ทั้งสองสิทธิ์อัตโนมัติ, Role `admin` ได้ `marketplace_upload` (grant ครั้งเดียวด้วย flag `marketplace_upload_admin_v1`)
- ผู้บริหาร (`executive`) ไม่ได้ `marketplace_view` โดยอัตโนมัติ — Super Admin ติ๊กให้ได้ที่ System Admin › Role

## ไฟล์ที่รองรับ (ตรวจจากหัวคอลัมน์ ไม่ใช่ชื่อไฟล์ ทุกชีตในไฟล์)
| แพลตฟอร์ม | ชีต / ไฟล์ | คอลัมน์ที่อ่าน |
|---|---|---|
| TikTok | คำสั่งซื้อ (OrderSKUList) | Order ID, Order Status, Order Substatus, Cancelation/Return Type, SKU ID, Seller SKU, Product Name, Variation, Quantity, Sku Quantity of return, SKU Subtotal Before Discount, SKU Seller Discount, Order Refund Amount, Created Time (DD/MM/YYYY), Province |
| TikTok | การเงิน › รายละเอียดคำสั่งซื้อ | หมายเลขคำสั่งซื้อ/การปรับ, หมายเลขคำสั่งซื้อที่เกี่ยวข้อง, ค่าธรรมเนียมทั้งหมด, ยอดการชำระเงินทั้งหมด (มีชื่อภาษาอังกฤษสำรอง) |
| Lazada | คำสั่งซื้อ (1 แถว = 1 ชิ้น) | orderItemId, orderNumber, createTime, sellerSku, lazadaSku, itemName, variation, unitPrice, sellerDiscountTotal, status, refundAmount, shippingAddress3 → ถ้าถูกปิด `*` ใช้ billingAddr3 |
| Lazada | ใบแจ้งยอด Income Overview (การเงิน › ใบแจ้งยอด, 1 แถว = 1 รายการเงิน) | ระยะเวลาใบแจ้งยอด, รหัสรอบบิล, ชื่อรายการธุรกรรม, จำนวนเงิน(รวมภาษี), หมายเลขคำสั่งซื้อ → ต่อออเดอร์ต่อรอบบิล: ยอดโอนสุทธิ = Σ ทุกรายการ, ค่าธรรมเนียม = (ยอดรวมค่าสินค้า + หักเงินค่าสินค้า) − ยอดโอนสุทธิ; แถวที่ไม่มีหมายเลขคำสั่งซื้อถูกข้าม |
| Shopee | คำสั่งซื้อ (Order.all, 1 แถว = 1 สินค้าในออเดอร์) | หมายเลขคำสั่งซื้อ, สถานะการสั่งซื้อ, สถานะการคืนเงินหรือคืนสินค้า, วันที่ทำการสั่งซื้อ, เลขอ้างอิง SKU (ไม่มีใช้ Parent SKU), ชื่อสินค้า, ชื่อตัวเลือก, จำนวน, จำนวนที่ส่งคืน, ราคาขายสุทธิ, จังหวัด |
| Shopee | รายงานรายรับของฉัน (ชีต Income, หัวตารางแถว 6) | หมายเลขคำสั่งซื้อ, รหัสคืนสินค้า, วันที่ทำการสั่งซื้อ, สินค้าราคาปกติ, ส่วนลดสินค้าจากผู้ขาย, จำนวนเงินที่ทำการคืนให้ผู้ซื้อ, ค่าคอมมิชชั่น AMS, ค่าคอมมิชชั่น, ค่าบริการ, ค่าธรรมเนียมโครงสร้างพื้นฐานแพลตฟอร์ม, ค่าธรรมเนียม ของโปรแกรมประหยัดค่าจัดส่ง, ค่าธุรกรรมการชำระเงิน, จำนวนเงินทั้งหมดที่โอนแล้ว (฿) |

- ชีตที่รู้จักแต่ไม่มีออเดอร์ (Lazada Balance Transactions, Shopee Transaction Report) ถูกข้าม; ถ้าไฟล์มีแค่ชีตนั้นจะแจ้งให้ export ไฟล์ที่ถูก
- **ข้อมูลส่วนตัว**: อ่านเฉพาะคอลัมน์ข้างบน ไม่อ่าน/ไม่เก็บ ชื่อ เบอร์ ที่อยู่ อีเมล ชื่อผู้ใช้ผู้ซื้อ เก็บแค่ชื่อจังหวัด ไม่เก็บไฟล์ต้นฉบับ (เก็บแค่ SHA-256 ไว้บอกว่าเคยอัปแล้ว)
- ยังไม่รองรับ: .xls รุ่นเก่า — ต้องมีไฟล์ตัวอย่างจริงก่อนเพิ่ม อย่าเดาหัวคอลัมน์

## นิยามตัวเลข (อย่าเปลี่ยนโดยไม่ถามเจ้าของ)
- **วันที่** = วันที่สร้างคำสั่งซื้อ เก็บเป็น ค.ศ. `YYYY-MM-DD` (แปลง พ.ศ. อัตโนมัติ) ตัวกรองไม่เกิน 366 วัน
- **ยอดขายของออเดอร์** = ราคาสินค้าหลังหักส่วนลดจากร้าน ไม่รวมค่าส่ง (ส่วนลดจากแพลตฟอร์มไม่หัก)
  - TikTok: Σ(SKU Subtotal Before Discount − |SKU Seller Discount|)
  - Lazada: Σ(unitPrice − |sellerDiscountTotal|) ของชิ้นที่ไม่ถูกยกเลิก
  - Shopee: สินค้าราคาปกติ − |ส่วนลดสินค้าจากผู้ขาย| (รายงานรายรับ) = ราคาขายสุทธิ (ไฟล์คำสั่งซื้อ = ราคาขาย × จำนวน); โค้ดส่วนลด/ส่วนลด Shopee ไม่หัก
  - Shopee สถานะ (ไฟล์คำสั่งซื้อ): ยกเลิกแล้ว → ยกเลิก, มีสถานะคืนเงิน/คืนสินค้าที่ไม่ใช่ "ปฏิเสธ/ยกเลิก" หรือจำนวนที่ส่งคืน > 0 → คืนสินค้า, สำเร็จแล้ว → สำเร็จ, อื่น ๆ → กำลังดำเนินการ; อัปทั้ง 2 ไฟล์ได้ ออเดอร์ไม่ซ้ำ (ไฟล์ที่อัปทีหลังเป็นตัวกำหนดสถานะ/ยอด)
- **สถานะ** (ลำดับความสำคัญ): ยกเลิก → คืนสินค้า (มียอดคืนเงิน/จำนวนคืน/รหัสคืน) → สำเร็จ (TikTok เสร็จสมบูรณ์/จัดส่งสำเร็จ, Lazada delivered/confirmed, Shopee อยู่ในรายงานรายรับ = โอนเงินแล้ว) → กำลังดำเนินการ
  - Lazada เป็นรายชิ้น: ออเดอร์ = ยกเลิก เมื่อยกเลิกทุกชิ้น; ชิ้นที่ยกเลิกไม่นับยอด
- **ยอดขายรวม / จำนวนออเดอร์ / เฉลี่ยต่อออเดอร์** นับเฉพาะ สำเร็จ + กำลังดำเนินการ (ไม่รวมยกเลิกและคืนสินค้า)
- **สินค้าขายดี** จัดกลุ่มตาม Seller SKU (ไม่มีใช้ชื่อสินค้า) ข้ามแพลตฟอร์ม — Shopee รายงานรายรับไม่มีรายชื่อสินค้า จึงไม่อยู่ในอันดับ
- **ค่าธรรมเนียม / เงินที่ได้รับสุทธิ** มาจากไฟล์การเงิน (TikTok) / TikTok Finance API หรือรายงานรายรับ (Shopee) เท่านั้น ไม่มีข้อมูล = แสดง "ไม่มีข้อมูล" ไม่ใช่ 0 และแสดงความครอบคลุม (มีข้อมูล X จาก Y ออเดอร์) ยังไม่หักต้นทุนสินค้า **จึงไม่ใช่กำไรสุทธิ**

## กันออเดอร์ซ้ำ
- คีย์ `(platform, order_id)` อัปไฟล์ซ้ำหรือช่วงวันที่ทับกัน = แทนที่ของเดิม (ข้อมูลล่าสุดชนะ เช่นสถานะเปลี่ยน) รายการสินค้าของออเดอร์นั้นถูกแทนทั้งชุด
- ค่าธรรมเนียมคีย์ `(platform, txn_id)` — TikTok ใช้หมายเลขธุรกรรม (ไฟล์ = หมายเลขคำสั่งซื้อ/การปรับ, API = statement transaction id), Shopee ใช้ `income:<order id>`

## TikTok Shop API (ดึงอัตโนมัติ แทน/เสริมไฟล์ export)
แอป in-house "Proplus SML Analytics" ใน TikTok Shop Partner Center (หมวด นักพัฒนาผู้ขายภายในองค์กร, ตลาดไทย, ผู้ขายท้องถิ่น)
- ไฟล์: `src/services/tiktokShopApi.js` (เซ็นคำขอ, token, ค้นออเดอร์/คืนสินค้า, แปลงออเดอร์), `tiktok-shop.js` (routes + sync), `migrations/009-tiktok-api.sql`, `public/tiktok-api-panel.js` (การ์ดในหน้าอัปโหลด), `test-tiktok-api.js` (TikTok ปลอม ไม่ต่อเน็ต)
- `.env`: `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID` (เลข ID ที่หัวหน้าแอป), ตัวเลือก `TIKTOK_AUTO_SYNC_MINUTES` (≥ 30 ดึงย้อน 3 วันอัตโนมัติ)
- Redirect URL ใน Partner Center: `https://dashboard.sksales.app/api/tiktok/callback`
- Scopes ที่ขอ: `seller.order.info`, `seller.product.basic`, `seller.finance.info`, `seller.return_refund.basic`

| Route | สิทธิ์ | หน้าที่ |
|---|---|---|
| `GET /api/tiktok/status` | `tiktok_sync` (Super Admin เป็นค่าเริ่มต้น ให้ role อื่นได้ใน System Admin) | สถานะการเชื่อมต่อ (ไม่มีตัวเลขยอดขาย) |
| `GET /api/tiktok/connect?shop=` | Super Admin | ส่งไปหน้าอนุญาตของ TikTok พร้อม state (ใช้ครั้งเดียว 10 นาที ผูกกับผู้กด) |
| `GET /api/tiktok/callback` | Super Admin คนที่กด connect | แลก code เป็น token, ดึงรายชื่อร้าน, เก็บ token แบบเข้ารหัส (vault เดียวกับ 2FA) |
| `POST /api/tiktok/sync {start,end}` | `tiktok_sync` | ดึงออเดอร์ตามวันที่สร้าง (เวลาไทย) ≤ 92 วัน ตอบแค่ "สำเร็จ" |
| `DELETE /api/tiktok/connections/:id` | Super Admin | ลืม token (ข้อมูลที่ดึงแล้วยังอยู่) |

- ค่าธรรมเนียม/เงินที่ได้รับสุทธิ: sync ดึง statement (Finance API, scope `seller.finance.info`) ที่ statement_time ตั้งแต่วันเริ่มถึงตอนนี้ → ทุก transaction ที่มี order_id: fees = −fee_amount, net = settlement_amount (ตรงกับคอลัมน์ ค่าธรรมเนียมทั้งหมด / ยอดการชำระเงินทั้งหมด ในไฟล์) transaction ไม่มี order_id (ปรับยอดระดับร้าน) ข้าม
- แต่ละครั้งที่ sync = 1 แถวใน `marketplace_uploads` ชื่อ "TikTok API <start> ถึง <end> · <ร้าน>" จึงกันซ้ำด้วย `(platform, order_id)` และลบได้จากประวัติเหมือนไฟล์
- **นิยามเท่ากับไฟล์ export**: ยอดขาย = Σ(original_price − |seller_discount|) ต่อชิ้น (API 202309 ให้ 1 line item = 1 ชิ้น จึงรวมตาม sku_id เป็นจำนวน), ส่วนลดแพลตฟอร์มไม่หัก; สถานะ CANCELLED → ยกเลิก, มีคำขอคืน/คืนเงินที่ไม่ถูกยกเลิก/ปฏิเสธ → คืนสินค้า, COMPLETED/DELIVERED → สำเร็จ, อื่น ๆ → กำลังดำเนินการ
- เก็บแค่จังหวัด (`district_info` ระดับ L1) ไม่เก็บชื่อ เบอร์ ที่อยู่ อีเมลผู้ซื้อ
- ยังไม่ดึงค่าธรรมเนียม/ยอดโอนจาก API — ใช้ไฟล์ การเงิน › รายละเอียดคำสั่งซื้อ ตามเดิม
- **ก่อนเชื่อถือตัวเลข**: ชื่อฟิลด์ตามเอกสาร API 202309 ยังไม่ได้ทดสอบกับร้านจริง ให้ sync ช่วงที่เคยอัปไฟล์ไว้แล้วเทียบยอดก่อนใช้งาน

## Lazada API (ดึงอัตโนมัติ แทน/เสริมไฟล์ export)
แอปใน Lazada Open Platform (open.lazada.com, ประเทศไทย) — โฟลว์เดียวกับ TikTok Shop API ด้านบน
- ไฟล์: `src/services/lazadaApi.js` (เซ็นคำขอ HMAC-SHA256, token, ออเดอร์/รายการสินค้า/การเงิน, แปลงออเดอร์), `lazada-shop.js` (routes + sync), `migrations/010-lazada-api.sql`, `public/lazada-api-panel.js` (วิดเจ็ตบนแท็บ Lazada), `test-lazada-api.js` (Lazada ปลอม ไม่ต่อเน็ต)
- `.env`: `LAZADA_APP_KEY`, `LAZADA_APP_SECRET`, `LAZADA_REDIRECT_URI` (ต้องตรงกับ Callback URL ในแอป เช่น `https://dashboard.sksales.app/api/lazada/callback`), ตัวเลือก `LAZADA_AUTO_SYNC_MINUTES` (≥ 30 ดึงย้อน 3 วันอัตโนมัติ)
- Permission ใหม่ `lazada_sync` (Super Admin เป็นค่าเริ่มต้น ให้ role อื่นได้ใน System Admin)

| Route | สิทธิ์ | หน้าที่ |
|---|---|---|
| `GET /api/lazada/status` | `lazada_sync` | สถานะการเชื่อมต่อ (ไม่มีตัวเลขยอดขาย) |
| `GET /api/lazada/connect?shop=` | Super Admin | ส่งไปหน้าอนุญาตของ Lazada พร้อม state (ใช้ครั้งเดียว 10 นาที ผูกกับผู้กด) |
| `GET /api/lazada/callback` | Super Admin คนที่กด connect | แลก code เป็น token, อ่านชื่อร้าน (`/seller/get`), เก็บ token แบบเข้ารหัส |
| `POST /api/lazada/sync {start,end}` | `lazada_sync` | ดึงออเดอร์ตามวันที่สร้าง (เวลาไทย) ≤ 92 วัน ตอบแค่ "สำเร็จ" |
| `DELETE /api/lazada/connections/:id` | Super Admin | ลืม token (ข้อมูลที่ดึงแล้วยังอยู่) |

- API ที่ใช้: `/orders/get` (created_after/created_before), `/orders/items/get` (ครั้งละ 50 ออเดอร์), `/finance/transaction/details/get` (วันที่เริ่มถึงวันนี้), `/seller/get`; ถูก rate limit จะรอแล้วลองใหม่ (1–16 วินาที)
- **นิยามเท่ากับไฟล์ export**: 1 order item = 1 ชิ้น, ยอดขาย = Σ(item_price − |voucher_seller|) ของชิ้นที่ไม่ถูกยกเลิก (voucher แพลตฟอร์มไม่หัก), สถานะใช้ฟังก์ชันเดียวกับไฟล์ (`lazadaItemStatus`); API ไม่มียอดคืนเงินต่อชิ้น จึงเก็บ refund = 0 และจัดเป็นคืนสินค้าจากสถานะ returned/failed
- ค่าธรรมเนียม/เงินที่ได้รับสุทธิ: เก็บรายการเงินทีละบรรทัด (`txn_id = api:<transaction_number>:<orderItem_no>`) ผลรวมต่อออเดอร์ = สูตรเดียวกับใบแจ้งยอด (net = Σ amount, fees = บรรทัดค่าสินค้า − net) บรรทัดไม่มีเลขออเดอร์ข้าม
  - ⚠️ อย่าอัปไฟล์ใบแจ้งยอด (Income Overview) ช่วงเดียวกับที่ดึงจาก API — คีย์ต่างกัน ค่าธรรมเนียมจะนับซ้ำ (ออเดอร์ไม่ซ้ำ เพราะคีย์ `(platform, order_id)`)
- เก็บแค่จังหวัด (`address_shipping.address3`, ถูกปิด `*` = ไม่เก็บ) ไม่เก็บชื่อ เบอร์ ที่อยู่ อีเมล; short_code ร้านถูกบันทึกใน `marketplace_shop_codes` เหมือนไฟล์
- **ก่อนเชื่อถือตัวเลข**: ชื่อฟิลด์ตามเอกสาร Lazada Open Platform ยังไม่ได้ทดสอบกับร้านจริง (โดยเฉพาะ `voucher_seller` และ `fee_name` ของบรรทัดค่าสินค้า) ให้ sync ช่วงที่เคยอัปไฟล์ไว้แล้วเทียบยอดก่อนใช้งาน
