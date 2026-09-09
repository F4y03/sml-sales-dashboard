import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export function installAuth(app, env = process.env) {
  const secure = env.AUTH_COOKIE_SECURE !== 'false';
  const cookieName = secure ? '__Host-prplus_session' : 'prplus_session';
  const options = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  const sessions = new Map();
  const attempts = new Map();
  const ttl = 8 * 60 * 60 * 1000;
  const configured = Boolean(env.AUTH_USERNAME && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.AUTH_PASSWORD_HASH || ''));
  if (!configured) console.error('Login is not configured: run node scripts/setup-auth.js, then restart the server. AUTH_PASSWORD_HASH must be a generated scrypt hash, not a plain password.');
  const digest = token => createHash('sha256').update(token).digest('hex');
  const tokenOf = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  const cleanup = setInterval(() => {
    for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= Date.now()) attempts.delete(key);
  }, 60000);
  cleanup.unref();
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    next();
  });
  // JSON plus a custom header prevents cross-origin form submissions. No CORS is enabled.
  const sameSite = (req, res, next) => {
    if (req.get('X-PRPlus-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่' });
    next();
  };
  app.post('/api/auth/login', sameSite, async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่าบัญชี กรุณาติดต่อผู้ดูแลระบบ' });
    const key = req.socket.remoteAddress || 'unknown'; // Never trust arbitrary forwarded IP headers.
    const now = Date.now();
    let attempt = attempts.get(key);
    if (!attempt || attempt.until <= now) {
      if (attempts.size >= 10000) return res.status(429).json({ error: 'กรุณารอสักครู่แล้วลองใหม่' });
      attempt = { count: 0, until: now + 15 * 60 * 1000 }; attempts.set(key, attempt);
    }
    if (++attempt.count > 10) {
      res.set('Retry-After', String(Math.ceil((attempt.until - now) / 1000)));
      return res.status(429).json({ error: 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' });
    }
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1024 || username.length > 100) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ใช้และรหัสผ่านให้ถูกต้อง' });
    const actual = await hashPassword(password, env.AUTH_PASSWORD_HASH.split(':')[0]);
    if (!timingSafeEqual(Buffer.from(actual), Buffer.from(env.AUTH_PASSWORD_HASH)) || username !== env.AUTH_USERNAME) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    attempts.delete(key);
    sessions.delete(digest(tokenOf(req)));
    if (sessions.size >= 10000) return res.status(503).json({ error: 'ระบบไม่ว่าง กรุณาลองใหม่ภายหลัง' });
    const token = randomBytes(32).toString('hex');
    sessions.set(digest(token), { username, expires: now + ttl });
    res.cookie(cookieName, token, { ...options, maxAge: ttl });
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', sameSite, (req, res) => {
    sessions.delete(digest(tokenOf(req)));
    res.clearCookie(cookieName, options);
    res.json({ ok: true });
  });
  const publicPaths = new Set(['/login', '/login.html', '/login.css', '/login.js', '/assets/pr-plus-logo-red.png']);
  app.use((req, res, next) => {
    if (publicPaths.has(req.path) && ['GET', 'HEAD'].includes(req.method)) return next();
    const session = sessions.get(digest(tokenOf(req)));
    if (session && session.expires > Date.now()) { req.auth = session; return next(); }
    if (req.path === '/api' || req.path.startsWith('/api/')) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ', code: 'AUTH_REQUIRED' });
    res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  });
  app.get('/api/auth/me', (req, res) => res.json({ username: req.auth.username }));
  app.get('/login', (req, res) => res.redirect('/login.html'));
}
