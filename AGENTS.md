# AGENTS

## หลักการทั่วไป
- ทำตามคำขอของผู้ใช้ และอย่าเขียนทับงานที่ผู้ใช้แก้ค้างไว้
- อย่าเปิดเผยหรือแก้ `.env` โดยพลการ
- ห้ามเผยข้อมูลลับ: credentials, hashes, cookies, tokens, SSH keys, connection strings, secrets หรือส่งต่อให้ browser/Git
- ถ้าไม่แน่ใจ ให้ตรวจ code จาก symbol/usage ก่อนอ่านไฟล์เต็ม

## Context-efficient workflow
- งานเล็กหรือเมื่อผู้ใช้ระบุไฟล์ชัดเจน ให้เปิดเฉพาะไฟล์ที่เกี่ยวข้องและแก้โดยตรง
- ใช้ Serena เฉพาะเมื่อจำเป็นต้องค้นหา symbol, references หรือวิเคราะห์หลายไฟล์
- ไม่ต้อง activate_project ซ้ำหาก project พร้อมใช้งานแล้ว
- ดึงเฉพาะ context/code ที่จำเป็น
- หลีกเลี่ยง broad repo search
- ใช้ rg/file search เมื่อเร็วและตรงกว่าสำหรับงานนั้น
- อย่ารัน test, browser หรือ diagnostics ซ้ำโดยไม่มีเหตุผล

## กฎสำคัญของ repository
- SML เป็น read-only: ห้าม INSERT/UPDATE/DELETE/DDL/migration ในฐาน SML
- ใช้ parameterized SQL เสมอ; อย่าเชื่อม input จากผู้ใช้เข้ากับ SQL โดยตรง
- รักษา business definitions: 4007/4014, trans_flag 44/46/48, YYYY-MM-DD vs พ.ศ./ค.ศ., NULL stock != 0, export ต้องตรง filters
- อย่าเปลี่ยนนิยามข้อมูลหรือสูตรโดยสมมติเอง
- ตรวจ shared navigation/theme และหน้าจอเล็กเมื่อแก้ UI
- แยก loading / empty / error และไม่เอาค่าศูนย์มาแทนข้อผิดพลาด
- ตรวจผลกระทบที่ส่งต่อจากการเปลี่ยน shared UI

## ข้อมูล/feature doc ที่ต้องอ่านเมื่อจำเป็น
- Products -> `PRODUCTS.md`
- Customers -> `CUSTOMERS.md`
- Executive -> `EXECUTIVE.md`
- Reports -> `REPORTS.md`
- Auth -> `AUTH-SETUP.md`
- Consignment -> `consignment-source.md`
- README -> เหลือไว้สำหรับ context กว้างเมื่อจำเป็น

## การทดลอง/ทดสอบ
- ทดสอบเฉพาะส่วนที่เปลี่ยน
- ถ้าไม่รันทดสอบจริง อย่า claim ว่า pass
- ใช้ `node --check` หรือ test ที่เกี่ยวข้องเท่านั้น
- เก็บ artifact ใน `test-results/` และอย่าถอด secrets ลง Git

## การรันงาน/เริ่มต้น
- ตรวจงานที่ผู้ใช้แก้ค้างไว้ก่อน; อย่า reset/overwrite งานที่ไม่ใช่ของเรา
- เรียกไฟล์ config และสถานะ process ให้ชัดก่อนเริ่ม backend/server
- ใช้ `.env.example` เป็น template เฉพาะเมื่อยังไม่มี `.env`
- จัดการ Windows PowerShell/UTF-8 ให้ถูกต้อง

## ความสำคัญที่ต้องคงไว้
- ห้ามปล่อย secrets/database credentials ไป browser หรือ Git
- คงคุณสมบัติ read-only / SML และ business logic เดิม
- ไม่ทำให้กฎด้านความปลอดภัยหรือ business definition สูญหายเพราะลดเอกสาร
