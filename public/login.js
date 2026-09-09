const form = document.querySelector('#login-form');
const password = document.querySelector('#password');
const toggle = document.querySelector('#toggle-password');
document.querySelector('#year').textContent = new Date().getFullYear();
toggle.addEventListener('click', () => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'ซ่อน' : 'แสดง';
  toggle.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  toggle.setAttribute('aria-pressed', String(show));
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.querySelector('#submit');
  const error = document.querySelector('#login-error');
  button.disabled = true; button.firstElementChild.textContent = 'กำลังเข้าสู่ระบบ…'; error.textContent = '';
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username: form.username.value.trim(), password: password.value }) });
    if (response.status === 404) throw new Error('เซิร์ฟเวอร์ยังไม่โหลดระบบล็อกอิน กรุณาให้ผู้ดูแลรีสตาร์ตเซิร์ฟเวอร์');
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    const next = new URLSearchParams(location.search).get('next');
    const target = new URL(next || '/executive.html', location.origin);
    location.replace(target.origin === location.origin && !target.pathname.startsWith('/login') && !target.pathname.startsWith('/api/') ? target.href : '/executive.html');
  } catch (error) { document.querySelector('#login-error').textContent = error.message === 'Failed to fetch' ? 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' : error.message; }
  finally { button.disabled = false; button.firstElementChild.textContent = 'เข้าสู่ระบบ'; }
});
