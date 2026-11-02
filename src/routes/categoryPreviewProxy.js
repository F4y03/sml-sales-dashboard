import http from 'node:http';

// Exposes the local-only category review tool (tools/category-preview, 127.0.0.1:3010) at /category-preview/.
// Its team edits and CSVs live outside Git in CATEGORY_DATA_DIR (default C:\category-preview).
// Needs a dashboard login (installAccess). Not in the side menu: open the link directly.
// The editor name written to its history is always the signed-in dashboard user, not what the page sends.
// The dashboard session cookie is never forwarded. The tool does not use SML.
const ROUTES = new Set(['GET /', 'GET /api/edits', 'GET /api/log', 'GET /download/all.csv', 'GET /download/categories.csv', 'GET /download/prices.csv',
  'POST /api/edit', 'POST /api/revert', 'POST /api/log/delete']);
const RETURN = ['content-type', 'content-disposition'];
const editorName = auth => String(auth.full_name || auth.username || '').trim().slice(0, 40);
const sameOrigin = req => { try { return new URL(req.get('Origin')).host === req.get('Host') && req.get('Sec-Fetch-Site') !== 'cross-site'; } catch { return false; } };

export function installCategoryPreviewProxy(app, { host = '127.0.0.1', port = 3010 } = {}) {
  app.use('/category-preview', (req, res) => {
    const path = req.path.toLowerCase();
    // The page uses relative URLs, so it must be served with the trailing slash.
    if (!/^\/category-preview\//i.test(req.originalUrl)) return res.redirect(302, '/category-preview/');
    if (!ROUTES.has(req.method + ' ' + path)) return res.status(404).type('html').send('<meta charset="utf-8"><p>ไม่พบหน้านี้</p>');
    if (!req.auth) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ', code: 'AUTH_REQUIRED' });
    let body;
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่' });
      body = Buffer.from(JSON.stringify({ ...(req.body || {}), who: editorName(req.auth) }));
    }
    const headers = { host: `${host}:${port}`, ...(body && { 'content-type': 'application/json', 'content-length': body.length }) };
    const upstream = http.request({ host, port, method: req.method, path: req.url, headers }, up => {
      res.status(up.statusCode || 502).set('Cache-Control', 'no-store');
      for (const name of RETURN) if (up.headers[name] !== undefined) res.set(name, up.headers[name]);
      if (path !== '/') return up.pipe(res);
      // Page: fill in and lock the editor name box with the dashboard user.
      const chunks = [];
      up.on('data', c => chunks.push(c));
      up.on('end', () => {
        const name = JSON.stringify(editorName(req.auth)).replace(/</g, '\\u003c');
        const fill = `<script>(()=>{const set=()=>{const w=document.getElementById("who");if(w){w.value=${name};w.readOnly=true;w.title="ชื่อจากบัญชีที่ล็อกอิน";}};set();addEventListener("load",set);})();</script>`;
        res.send(Buffer.concat(chunks).toString('utf8').replace(/<\/body>/i, fill + '</body>'));
      });
    });
    upstream.setTimeout(60000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (res.headersSent) return res.end();
      res.status(502).type('html').send('<meta charset="utf-8"><p>หน้าตรวจหมวดสินค้ายังไม่ได้เปิดอยู่บนเครื่อง server</p>');
    });
    upstream.end(body);
  });
}
