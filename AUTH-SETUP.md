# PR PLUS login

> ระบบปัจจุบันรองรับหลายบัญชี/RBAC/เขตการขายแล้ว ดู [ACCESS-CONTROL.md](ACCESS-CONTROL.md) สำหรับการจัดการผู้ใช้ การย้ายบัญชีเดิม และการทดสอบทั้งหมด

## สร้างบัญชีและเริ่มใช้งาน

รันจากโฟลเดอร์โปรเจกต์:

```powershell
node scripts/setup-auth.js
npm start
```

กรอกชื่อผู้ใช้และรหัสผ่านใหม่ตามนโยบายรหัสผ่านด้านล่าง (ซ่อนขณะพิมพ์) คำสั่งเก็บ bcrypt hash ใน `data/access.sqlite` ซึ่งถูกละเว้นจาก Git ไม่แก้ `.env` หรือฐาน SML ใช้คำสั่งเดิมเพื่อกู้บัญชี Super Admin หรือรีเซ็ตรหัสผ่าน เซสชัน อุปกรณ์ที่เชื่อถือ และการล็อกของบัญชีนั้นจะถูกยกเลิก เพิ่ม `--reset-2fa` (`node scripts/setup-auth.js --reset-2fa`) เมื่อโทรศัพท์และ Recovery Codes หายทั้งคู่ เพื่อล้าง 2FA ให้ตั้งค่าใหม่ตอน Login ครั้งถัดไป

เปิด `/login.html` ระบบจะกลับหน้าที่ขอไว้หลังเข้าสู่ระบบ หรือไป `/executive.html` เมื่อเปิดหน้าล็อกอินโดยตรง หากยังไม่ตั้งบัญชี ระบบจะปฏิเสธการเข้าถึงข้อมูลไว้ก่อน ไม่มีรหัสผ่านเริ่มต้น

## Cloudflare HTTPS

- ใช้ `AUTH_COOKIE_SECURE=true` (ค่าเริ่มต้น) สำหรับเว็บจริง Cookie มี Secure, HttpOnly, SameSite=Lax และใช้ชื่อแบบ __Host- โดยไม่กำหนด Domain จึงใช้งานได้เมื่อ Cloudflare รับ HTTPS แล้วส่ง HTTP ไปยัง origin โดยไม่ต้องเชื่อถือ X-Forwarded-Proto
- จำกัดการเข้าถึง origin ให้ผ่าน Cloudflare Tunnel หรือ firewall ของระบบที่ใช้งานจริง ถ้าเชื่อม Cloudflare ไป origin ด้วย TLS ให้ตั้ง SSL/TLS เป็น Full (strict)
- ตั้ง Cache Rule เป็น Bypass สำหรับ hostname ของแดชบอร์ด และล้าง cache เก่าก่อนเปิดใช้ โดยเฉพาะหากเคยใช้ Cache Everything ระบบส่ง Cache-Control: private, no-store และ Cloudflare-CDN-Cache-Control: no-store ทุกคำตอบอยู่แล้ว
- ถ้าทดสอบด้วย HTTP บนเครื่องตัวเอง ให้เพิ่ม `AUTH_COOKIE_SECURE=false` ใน `.env` แล้วรีสตาร์ต เปลี่ยนกลับเป็น true ก่อนใช้งานเว็บจริง

บัญชีเดิมใน `.env` ถูกนำเข้าเป็น Super Admin ครั้งแรกเท่านั้น เซสชันอายุ 8 ชั่วโมง เก็บเฉพาะ digest ใน SQLite และอยู่ต่อหลังรีสตาร์ต การแก้ผู้ใช้/Role/Permission จะยกเลิกเซสชันที่เกี่ยวข้อง รองรับการรันหนึ่ง process; หากขยายหลาย instances ต้องเปลี่ยนเป็น session/rate-limit store ที่ใช้ร่วมกันก่อน ไม่มี localhost bypass อีกต่อไป

จำกัดการเข้าสู่ระบบ 10 ครั้งต่อ 15 นาทีต่อ IP ของการเชื่อมต่อ origin โดยไม่เชื่อถือ forwarded headers ที่ปลอมได้ ผู้ใช้หลัง proxy/Tunnel เดียวกันอาจใช้โควตาร่วมกัน ตั้ง Cloudflare rate limiting เพิ่มที่ `/api/auth/login` ตามจำนวนผู้ใช้จริง

## Login Security

**นโยบายรหัสผ่าน (เฉพาะรหัสใหม่/เปลี่ยน/รีเซ็ต)** อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลขอย่างละ 1 ตัวขึ้นไป (อักขระพิเศษใช้ได้) ไม่เกิน 72 bytes ปฏิเสธรหัสเดาง่าย (รายการรหัสยอดนิยม, อักขระซ้ำ/เรียงลำดับ, มี Username อยู่ในรหัส) รหัสเดิมที่ไม่ผ่านนโยบายยังเข้าสู่ระบบได้ตามปกติ และไม่ถูกเปลี่ยน รหัสเดิมที่เป็น scrypt หรือ plain text จะถูกแปลงเป็น bcrypt อัตโนมัติเมื่อ Login สำเร็จครั้งแรก โดยไม่เปลี่ยนรหัสผ่านของผู้ใช้

**Lockout / Rate limit** Login ผิด 5 ครั้งติดกัน ล็อกบัญชี 15 นาที (ตาราง `login_lockouts`) Login สำเร็จจะรีเซ็ตตัวนับ ทุกกรณีล้มเหลว (ไม่พบผู้ใช้, รหัสผิด, ปิดใช้งาน, ถูกล็อก) ตอบข้อความเดียวกัน และยังจำกัด 10 ครั้ง/15 นาที/IP สำหรับ `/api/auth/login` และ `/api/auth/2fa` แยกกัน

**2FA (บังคับทุกบัญชี)** Password → ตรวจ Trusted Device → ถ้ายังไม่เชื่อถือ ให้กรอก TOTP 6 หลัก (Google/Microsoft Authenticator) บัญชีที่ยังไม่เคยตั้งค่าจะถูกพาไปสแกน QR ตอน Login ครั้งแรก แล้วได้ Recovery Codes 10 ชุด (แสดงครั้งเดียว) ไม่มีตัวเลือกปิด 2FA รายบัญชี Super Admin รีเซ็ต 2FA ของผู้อื่นได้จากหน้า System Admin Secret เข้ารหัส AES-256-GCM ด้วยคีย์จาก `AUTH_2FA_KEY` หรือไฟล์ `data/2fa.key` (สร้างเองครั้งแรก, ต้อง backup คู่กับ `access.sqlite` และห้าม commit) OTP ใช้ซ้ำไม่ได้ `AUTH_REQUIRE_2FA=false` มีไว้ใช้ทดสอบ/พัฒนาเท่านั้น อย่าตั้งบนเว็บจริง

**Trusted Device** ตัวเลือก "เชื่อถืออุปกรณ์นี้ N วัน" — N ขึ้นกับ role: Super Admin และผู้บริหาร (executive) = 30 วัน, Admin และ Sales = 7 วัน (ดู `trustDaysFor` ใน `src/services/twoFactorService.js`) ใช้ Token สุ่ม 256 บิตใน Cookie httpOnly, SameSite=Strict (Secure เมื่อ HTTPS, ชื่อ `__Host-prplus_trusted`) DB เก็บเฉพาะ SHA-256 ของ Token ถูกยกเลิกเมื่อ: เปลี่ยน/รีเซ็ตรหัสผ่าน, รีเซ็ต 2FA, "ออกจากระบบทุกอุปกรณ์" (`POST /api/auth/logout-all`), และ Revoke Session โดย Super Admin

**Recovery** ใช้ Recovery Code แทน OTP ได้รหัสละ 1 ครั้ง (เก็บเฉพาะ SHA-256) สร้างชุดใหม่: `POST /api/auth/recovery-codes` `{password}` (ชุดเก่าใช้ไม่ได้) Super Admin รีเซ็ต 2FA ของผู้อื่น: `POST /api/admin/users/:id/2fa/reset`

**Activity Log** บันทึก `login`, `login.failed` (พร้อมเหตุผล ไม่เก็บ Username ที่พิมพ์), `account.locked`, `user.password_change`/`user.password_reset`, `2fa.enrolled/verified/failed/recovery_used/recovery_regenerated/reset`, `trusted_device.add/revoke`, `auth.logout_all` ระบบตัด key ที่เป็น password/otp/secret/token/recovery/hash/cookie ออกก่อนบันทึกเสมอ

## ทดสอบ

```powershell
npm run test:access   # test-auth, test-rbac, test-security, test-2fa
node test-login-ui.js
node test-login-2fa-ui.js
```

UI test ต้องมี Playwright Chromium หรือใช้ Microsoft Edge ที่ติดตั้งไว้:

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
node test-login-ui.js
```

ภาพตรวจหน้าจอเก็บใน `test-results/login-desktop.png` และ `test-results/login-mobile.png` การทดสอบใช้บัญชีชั่วคราวและไม่แก้ไข `.env` หรือฐานข้อมูลจริง

อ้างอิงคุณสมบัติ cookie: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
