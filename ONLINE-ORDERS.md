# จัดการออเดอร์ออนไลน์ (WooCommerce · proplusaudio.com)

หน้า `/online-orders.html` (เมนู WORKSPACE ต่อจาก "ยอดขายออนไลน์") — ออเดอร์และยอดขายของเว็บไซต์ ไม่แตะ SML

## สิทธิ์
- `orders_view` = ดูออเดอร์อย่างเดียว, `orders_update` = ดู + เปลี่ยนสถานะ / ใส่เลขพัสดุ / โน้ต (update ถือว่าดูได้ด้วย)
- Super Admin มีเสมอ; role `admin` ได้ทั้งสองสิทธิ์เป็นค่าเริ่มต้น (`orders_admin_v1` ใน accessStore; ถอดได้ที่ System Admin → Roles)
- ผู้ใช้อื่น: Super Admin เปิดรายคนที่ `/order-permissions.html` (เก็บเป็น `user_permissions`) — มีผลทันที ไม่ต้อง login ใหม่
- บันทึกการเปลี่ยนสิทธิ์ใน `activity_logs` action `orders.permission` {userId, from, to}; เปลี่ยนสถานะ = `orders.status`, โน้ต = `orders.note`
- Backend: `src/middleware/access.js` ตอบ 403 ทุก `/api/online-orders/*` และหน้า ถ้าไม่มีสิทธิ์; route เขียนต้อง `orders_update`; `/api/admin/order-permissions` และหน้า permission = Super Admin เท่านั้น
- ข้อมูลเว็บเป็นของทั้งบริษัท ไม่จำกัดเขตการขาย — ให้สิทธิ์ Sales ได้ แต่จะเห็นออเดอร์ทั้งหมด

## WooCommerce
- `src/services/wooCommerceApi.js` Basic Auth ด้วย `WC_KEY` / `WC_SECRET` (server เท่านั้น, https เท่านั้น); `WC_BASE_URL` ไม่บังคับ (ค่าเริ่มต้น `https://proplusaudio.com/wp-json/wc/v3/`)
- คีย์ต้องเป็น Read/Write (เปลี่ยนสถานะ/เพิ่มโน้ต); ป้ายผู้ส่งบนใบปะหน้าใช้ `WC_SENDER_NAME` / `WC_SENDER_PHONE` + ที่อยู่ร้านจาก `settings/general`
- การ์ด: รอชำระ = pending + on-hold, รอจัด = processing, ส่งแล้ววันนี้ = completed ที่ `date_completed_gmt` ≥ 00:00 เวลาไทย, ค้างเกิน 2 วัน = processing ที่สั่งก่อน 48 ชม.
- ยอดขาย: การ์ดจาก `reports/sales` (ยอดเฉลี่ย = total_sales ÷ total_orders), กราฟรายวันจาก `wc-analytics/reports/revenue/stats?interval=day` (ถ้าล้มเหลวใช้ totals รายวันจาก `reports/sales`), ขายดีจาก `reports/top_sellers` (เรียงตามจำนวนชิ้น)
- เลขพัสดุ = โน้ต `customer_note: true` (ลูกค้าได้อีเมล); โน้ตทีม / Serial = `customer_note: false`

## ทดสอบ
`node --test tests/test-online-orders.js` (fake fetch, ไม่เรียกเว็บจริง)
