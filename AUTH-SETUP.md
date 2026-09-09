# PR PLUS login

## สร้างบัญชีและเริ่มใช้งาน

รันจากโฟลเดอร์โปรเจกต์:

```powershell
node scripts/setup-auth.js
npm start
```

กรอกชื่อผู้ใช้และรหัสผ่านอย่างน้อย 12 ตัวอักษร (ซ่อนขณะพิมพ์) คำสั่งเก็บเฉพาะ salted scrypt hash ใน `.env` ซึ่งถูกละเว้นจาก Git แล้ว ไม่แก้ไขค่าฐานข้อมูลเดิม ใช้คำสั่งเดิมเพื่อเปลี่ยนบัญชีหรือรีเซ็ตรหัสผ่าน จากนั้นรีสตาร์ตเซิร์ฟเวอร์

เปิด `/login.html` ระบบจะกลับหน้าที่ขอไว้หลังเข้าสู่ระบบ หรือไป `/executive.html` เมื่อเปิดหน้าล็อกอินโดยตรง หากยังไม่ตั้งบัญชี ระบบจะปฏิเสธการเข้าถึงข้อมูลไว้ก่อน ไม่มีรหัสผ่านเริ่มต้น

## Cloudflare HTTPS

- ใช้ `AUTH_COOKIE_SECURE=true` (ค่าเริ่มต้น) สำหรับเว็บจริง Cookie มี Secure, HttpOnly, SameSite=Lax และใช้ชื่อแบบ __Host- โดยไม่กำหนด Domain จึงใช้งานได้เมื่อ Cloudflare รับ HTTPS แล้วส่ง HTTP ไปยัง origin โดยไม่ต้องเชื่อถือ X-Forwarded-Proto
- จำกัดการเข้าถึง origin ให้ผ่าน Cloudflare Tunnel หรือ firewall ของระบบที่ใช้งานจริง ถ้าเชื่อม Cloudflare ไป origin ด้วย TLS ให้ตั้ง SSL/TLS เป็น Full (strict)
- ตั้ง Cache Rule เป็น Bypass สำหรับ hostname ของแดชบอร์ด และล้าง cache เก่าก่อนเปิดใช้ โดยเฉพาะหากเคยใช้ Cache Everything ระบบส่ง Cache-Control: private, no-store และ Cloudflare-CDN-Cache-Control: no-store ทุกคำตอบอยู่แล้ว
- ถ้าทดสอบด้วย HTTP บนเครื่องตัวเอง ให้เพิ่ม `AUTH_COOKIE_SECURE=false` ใน `.env` แล้วรีสตาร์ต เปลี่ยนกลับเป็น true ก่อนใช้งานเว็บจริง

ระบบรุ่นนี้มีบัญชีผู้ดูแลหนึ่งบัญชีและเซสชันอายุ 8 ชั่วโมง เก็บเซสชันในหน่วยความจำของ Node process จึงออกจากระบบทั้งหมดเมื่อรีสตาร์ต รองรับการรันหนึ่ง process; หากขยายหลาย instances ต้องเปลี่ยนเป็น session/rate-limit store ที่ใช้ร่วมกันก่อน

จำกัดการเข้าสู่ระบบ 10 ครั้งต่อ 15 นาทีต่อ IP ของการเชื่อมต่อ origin โดยไม่เชื่อถือ forwarded headers ที่ปลอมได้ ผู้ใช้หลัง proxy/Tunnel เดียวกันอาจใช้โควตาร่วมกัน ตั้ง Cloudflare rate limiting เพิ่มที่ `/api/auth/login` ตามจำนวนผู้ใช้จริง

## ทดสอบ

```powershell
node --test test-auth.js
node test-login-ui.js
```

UI test ต้องมี Playwright Chromium หรือใช้ Microsoft Edge ที่ติดตั้งไว้:

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
node test-login-ui.js
```

ภาพตรวจหน้าจอเก็บใน `test-results/login-desktop.png` และ `test-results/login-mobile.png` การทดสอบใช้บัญชีชั่วคราวและไม่แก้ไข `.env` หรือฐานข้อมูลจริง

อ้างอิงคุณสมบัติ cookie: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
