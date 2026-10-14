import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { verifyPassword } from '../services/passwordService.js';

// Exposes the local-only product-sheet tool (127.0.0.1:3002) at /product-sheet/.
// Only products.html is published. Viewing needs either a dashboard login or the shared page password
// (bcrypt hash in system_settings.product_sheet_password_hash, set with scripts/set-product-sheet-password.js).
// Writes from that page need a super_admin dashboard login (enforced in installAccess).
// The dashboard session cookie is never forwarded to product-sheet.
const FORWARD = ['accept', 'accept-language', 'content-type', 'content-length', 'if-none-match', 'if-modified-since', 'range'];
const RETURN = ['content-type', 'content-length', 'content-disposition', 'etag', 'last-modified', 'content-range', 'accept-ranges'];
export const PASSWORD_KEY = 'product_sheet_password_hash';

const PREFIX = /^\/product-sheet(\/|$)/i;
export const isProductSheetPath = req => PREFIX.test(req.path);
const PUBLIC_GET = new Set(['/', '/index.html', '/login.html', '/products.html', '/products.js', '/sheet.css', '/api/sheet', '/api/web-posted', '/api/sml-suggest', '/download.csv', '/download.xlsx']);
const PUBLIC_POST = new Set(['/api/sml-stock', '/api/login', '/api/logout']); // sml-stock is a read-only lookup used to render the table
const WRITES = new Set(['/api/update-sku', '/api/web-posted']);
const sub = req => req.path.slice('/product-sheet'.length).toLowerCase() || '/';
// Requests the dashboard session gate lets through without a dashboard login (the page password is checked here instead).
export const isProductSheetPublicRead = req => isProductSheetPath(req)
  && ((['GET', 'HEAD'].includes(req.method) && PUBLIC_GET.has(sub(req))) || (req.method === 'POST' && PUBLIC_POST.has(sub(req))));
const isProductSheetWrite = req => req.method === 'POST' && WRITES.has(sub(req));

const loginPage = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ตารางสินค้า</title><style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--fg:#1d1f24;--muted:#6b7280;--line:#d6d9df;--accent:#c8102e}
@media (prefers-color-scheme:dark){:root{--bg:#15171b;--card:#1f2228;--fg:#eceef2;--muted:#9aa1ad;--line:#343842}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font-family:system-ui,"Noto Sans Thai",sans-serif;padding:16px}
form{width:100%;max-width:340px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px 24px;display:grid;gap:14px}
h1{margin:0;font-size:1.25rem}p{margin:0;color:var(--muted);font-size:.9rem}
input{font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
button{font:inherit;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}button:disabled{opacity:.6}
#error{color:var(--accent);min-height:1.2em}</style></head><body>
<form id="f"><h1>ตารางสินค้า</h1><p>กรุณาใส่รหัสผ่านเพื่อเข้าดู</p>
<input id="password" type="password" autocomplete="current-password" placeholder="รหัสผ่าน" required autofocus>
<button id="b">เข้าสู่ระบบ</button><p id="error" role="alert"></p></form>
<script>
document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const b=document.getElementById('b'),err=document.getElementById('error');b.disabled=true;err.textContent='';
try{const r=await fetch('api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});
if(r.ok){location.replace('products.html');return;}err.textContent=(await r.json().catch(()=>({}))).error||'เข้าสู่ระบบไม่สำเร็จ';}
catch{err.textContent='เชื่อมต่อไม่ได้ กรุณาลองใหม่';}b.disabled=false;});
</script></body></html>`;

export function installProductSheetProxy(app, { host = '127.0.0.1', port = 3002, store, env = process.env } = {}) {
  const secure = env.AUTH_COOKIE_SECURE !== 'false', cookieName = secure ? '__Host-prplus_sheet' : 'prplus_sheet';
  const ttl = 12 * 60 * 60 * 1000, sessions = new Map(), attempts = new Map();
  const digest = token => createHash('sha256').update(token).digest('hex');
  const cookieOf = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  const hasPagePass = req => { const s = sessions.get(digest(cookieOf(req))); return !!s && s > Date.now(); };
  const passwordHash = () => store?.get('SELECT value FROM system_settings WHERE key=?', PASSWORD_KEY)?.value || '';
  // Same client identity rule as the dashboard login limiter (cloudflared arrives from loopback).
  const ipOf = req => { const peer = req.socket.remoteAddress || 'unknown', cf = req.get('CF-Connecting-IP'); return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && cf && isIP(cf) ? cf : peer; };
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of sessions) if (v <= now) sessions.delete(k); for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k); }, 60000); sweep.unref();
  const sameOrigin = req => { try { return new URL(req.get('Origin')).host === req.get('Host') && req.get('Sec-Fetch-Site') !== 'cross-site'; } catch { return false; } };

  app.use('/product-sheet', async (req, res) => {
    const full = { method: req.method, path: '/product-sheet' + req.path }, path = sub(full);
    if (path === '/' || path === '/index.html') return res.redirect(302, '/product-sheet/products.html');
    if (path === '/login.html') return res.type('html').send(loginPage);
    if (req.method === 'POST' && (path === '/api/login' || path === '/api/logout')) {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่' });
      if (path === '/api/logout') { sessions.delete(digest(cookieOf(req))); res.clearCookie(cookieName, { path: '/' }); return res.json({ ok: true }); }
      const key = ipOf(req), now = Date.now(); let a = attempts.get(key);
      if (!a || a.until <= now) { if (attempts.size >= 10000) return res.status(429).json({ error: 'กรุณารอสักครู่' }); a = { count: 0, until: now + 15 * 60 * 1000 }; attempts.set(key, a); }
      if (++a.count > 10) { res.set('Retry-After', String(Math.ceil((a.until - now) / 1000))); return res.status(429).json({ error: 'ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาที' }); }
      const hash = passwordHash();
      if (!hash) return res.status(503).json({ error: 'ยังไม่ได้ตั้งรหัสผ่านของหน้านี้ กรุณาติดต่อผู้ดูแลระบบ' });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) return res.status(413).json({ error: 'คำขอใหญ่เกินไป' }); chunks.push(chunk); }
      let password; try { password = JSON.parse(Buffer.concat(chunks).toString('utf8')).password; } catch {}
      if (typeof password !== 'string' || !(await verifyPassword(password, hash))) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
      attempts.delete(key);
      if (sessions.size >= 10000) return res.status(503).json({ error: 'ระบบไม่ว่าง กรุณาลองใหม่' });
      const token = randomBytes(32).toString('hex'); sessions.set(digest(token), now + ttl);
      res.cookie(cookieName, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ttl });
      return res.json({ ok: true });
    }
    const write = isProductSheetWrite(full);
    if (!isProductSheetPublicRead(full) && !write) return res.status(404).type('html').send('<meta charset="utf-8"><p>ไม่พบหน้านี้</p>');
    if (!write && !req.auth && !hasPagePass(req)) {
      if (path === '/products.html') return res.redirect(302, '/product-sheet/login.html');
      return res.status(401).json({ error: 'กรุณาใส่รหัสผ่าน', code: 'AUTH_REQUIRED' });
    }
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return res.status(403).json({ error: 'คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่' });
    const headers = { host: `${host}:${port}` };
    for (const name of FORWARD) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    const upstream = http.request({ host, port, method: req.method, path: req.url || '/', headers }, up => {
      res.status(up.statusCode || 502);
      for (const name of RETURN) if (up.headers[name] !== undefined) res.set(name, up.headers[name]);
      up.pipe(res);
    });
    upstream.setTimeout(120000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (res.headersSent) return res.end();
      res.status(502).type('html').send('<meta charset="utf-8"><p>ตารางสินค้า (product-sheet) ยังไม่ได้เปิดอยู่บนเครื่อง server</p>');
    });
    req.pipe(upstream);
  });
}
