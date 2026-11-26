# จัดการออเดอร์ออนไลน์ (WooCommerce · proplusaudio.com)

หน้า `/online-orders.html` (เมนู WORKSPACE ต่อจาก "ยอดขายออนไลน์") — ออเดอร์และยอดขายของเว็บไซต์ ไม่แตะ SML

## สิทธิ์
- `orders_view` = ดูออเดอร์อย่างเดียว, `orders_update` = ดู + เปลี่ยนสถานะ / ใส่เลขพัสดุ / โน้ต (update ถือว่าดูได้ด้วย)
- Super Admin มีเสมอ; role `admin` **ไม่ได้**เป็นค่าเริ่มต้นแล้ว (ถอดออก 2026-11-23 ด้วย `orders_admin_revoke_v1` ใน accessStore) — ทั้งสองเมนูซ่อนจากทุกคนจนกว่า Super Admin จะเปิดให้รายคน
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

# เว็บไซต์ (`/exec-sales.html`, เดิมชื่อ "ยอดขายผู้บริหาร")

- สิทธิ์ `exec_sales_view`: Super Admin เสมอ; คนอื่นต้องได้สิทธิ์รายบุคคลจาก Super Admin (คอลัมน์ "เห็นเมนูเว็บไซต์" ใน `/order-permissions.html`) — `canViewExecSales` **ไม่นับสิทธิ์จาก role** เพื่อไม่ให้คนที่มี roles_manage แจกเองได้
- Log: `activity_logs` action `exec_sales.permission` {userId, from, to}
- API (`src/routes/exec-sales.js`, แคชในหน่วยความจำ 1 นาทีต่อช่วงวันที่ (หน้าเว็บรีเฟรชเองทุก 1 นาที)): `/api/exec-sales/overview`, `/timeline?interval=hour|day|week|month` (รายชั่วโมงเฉพาะช่วง ≤ 7 วัน), `/export?format=xlsx|csv`
- ช่วงก่อนหน้า = จำนวนวันเท่ากัน ต่อท้ายก่อนวันเริ่ม; การ์ดจาก `wc-analytics/reports/revenue/stats` (ยอดสุทธิ = net_revenue, ส่วนลด = coupons) — ส่วนลด/คืนเงินที่เพิ่มขึ้นแสดงสีแดง
- กราฟ (5 อัน): ยอดขายตามเวลา, ออเดอร์ตามสถานะ, สินค้าขายดี, หมวดหมู่, จังหวัด/ภาค — เอาวิธีชำระ / heatmap / ลูกค้าใหม่-เก่า / รายเดือนปีต่อปี ออกตามที่ผู้ใช้สั่ง (2026-11-20)
- กราฟสถานะ / จังหวัด คำนวณจาก `wc/v3/orders` (สูงสุด 5,000 ออเดอร์ต่อช่วง; เกินนั้นมีหมายเหตุ); จังหวัดจากรหัสไปรษณีย์ (`thaiPostcode.js`), ภาคจากรายชื่อจังหวัดใน `REGIONS`; จังหวัดนับเฉพาะ processing/completed/on-hold และใช้ยอดออเดอร์ (รวมค่าส่ง)
- คลิกกราฟ → `online-orders.html?start=&end=&product=&status=` (เฉพาะคนที่มีสิทธิ์ดูออเดอร์)
- ทดสอบ: `node --test tests/test-exec-sales.js`

## ตรวจการชำระเงิน
- แท็บ/การ์ด "ตรวจชำระ" = pending + on-hold + processing ที่จ่ายด้วยโอนเงิน (bacs / ชื่อมี "โอน") แต่ยังไม่มีใครยืนยันใน Dashboard (ไม่มี meta `prplus_payment_verified`) — เป็นแท็บเริ่มต้นเมื่อเปิดหน้า; "รอจัดส่ง" = processing ที่เหลือ (สแกนสูงสุด 1,000 ออเดอร์)
- หน้ารายละเอียดแสดงยอดที่ต้องได้รับ + ธนาคารที่ลูกค้าแจ้ง (`_pp_from_bank`) + รูปสลิป
  - สลิป Seed Confirm: Code Snippet "PRPLUS Dashboard – slip" บนเว็บ เพิ่ม `wc/v3/prplus-slips/<order>` (หา `seed_confirm_log` ที่ `seed_confirm_order` = ออเดอร์) และ `wc/v3/prplus-slip-image/<id>` (ส่งต่อให้ `admin_post_seed_confirm_slip`) — ต้อง `edit_shop_orders`; ถ้า snippet ปิด = ไม่พบสลิป
  - Dashboard proxy รูปที่ `GET /api/online-orders/:id/slip/:slip` (ตรวจว่าสลิปเป็นของออเดอร์นั้นก่อน; คีย์อยู่ server เท่านั้น)
  - สำรอง `findSlips`: URL รูป https จาก meta ที่ชื่อเกี่ยวกับ slip/payment หรือจากโน้ต
- `POST /api/online-orders/:id/payment` (orders_update): confirm = `set_paid` + processing + โน้ตภายในว่าใครตรวจ; reject = โน้ต (เลือกแจ้งลูกค้าได้) สถานะคงเดิม; log `orders.payment_confirm|reject`
