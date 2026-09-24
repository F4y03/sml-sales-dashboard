// Product image links for the price/stock page, stored in the app's access database (never in SML).
// Everyone who can open products.html can read them; saving needs the product_images permission.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sameSite } from './auth.js';
import { requirePermission } from './src/middleware/access.js';
import { hasPermission } from './src/services/permissionService.js';

// One source of truth for link rules: evaluate the same file the browser loads.
const sandbox = { URL };
vm.runInNewContext(readFileSync(new URL('./public/product-image-links.js', import.meta.url), 'utf8'), sandbox);
const rules = sandbox.ProductImageLinks;
// Copy results out of the vm realm so callers get plain objects of this realm.
export const normalizeImageLink = raw => ({ ...rules.normalizeImageLink(raw) });
export const MAX_IMAGES = rules.MAX_IMAGES;
const MAX_CODES = 100;
const validCode = code => typeof code === 'string' && code.trim() !== '' && code.length <= 200;

// Trims, drops blank entries and normalizes Drive links. Returns { links } or { invalid: count }.
export function cleanLinks(input) {
  if (!Array.isArray(input) || input.length > MAX_IMAGES * 2) return { invalid: -1 };
  const links = [];
  let invalid = 0;
  for (const raw of input) {
    if (typeof raw !== 'string') { invalid++; continue; }
    const result = normalizeImageLink(raw);
    if (result.ok) links.push(result.value);
    else if (result.reason !== 'empty') invalid++;
  }
  if (invalid) return { invalid };
  if (links.length > MAX_IMAGES) return { invalid: -1 };
  return { links };
}

export function installProductImages(app, store, audit, pool) {
  const read = code => {
    const row = store.get('SELECT links_json, updated_at FROM product_images WHERE code=?', code);
    if (!row) return null;
    try { const links = JSON.parse(row.links_json); return Array.isArray(links) ? { links, updatedAt: row.updated_at } : null; } catch { return null; }
  };
  app.get('/api/products/images', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const codes = [].concat(req.query.code ?? []);
    if (codes.length > MAX_CODES || !codes.every(validCode)) return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    const images = {};
    for (const code of new Set(codes)) { const saved = read(code); if (saved) images[code] = saved.links; }
    res.json({ images, canEdit: hasPermission(req.auth, 'product_images') });
  });
  app.put('/api/products/images', sameSite, requirePermission('product_images'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { code, links } = req.body || {};
    if (!validCode(code)) return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    const cleaned = cleanLinks(links);
    if (cleaned.invalid === -1) return res.status(400).json({ error: `ใส่ลิงก์รูปได้ไม่เกิน ${MAX_IMAGES} รูป` });
    if (cleaned.invalid) return res.status(400).json({ error: `มีลิงก์ไม่ถูกต้อง ${cleaned.invalid} รายการ`, invalid: cleaned.invalid });
    try {
      // Read-only, parameterized check that the code exists in the SML product register.
      const found = await pool.query('SELECT 1 FROM ic_inventory WHERE code=$1 LIMIT 1', [code]);
      if (!found.rows.length) return res.status(404).json({ error: 'ไม่พบสินค้าในทะเบียน' });
    } catch (error) {
      console.error('Product image check failed:', error.code);
      return res.status(503).json({ error: 'ตรวจรหัสสินค้ากับ SML ไม่สำเร็จ กรุณาลองใหม่' });
    }
    const updatedAt = new Date().toISOString();
    store.transaction(() => {
      if (cleaned.links.length) store.run('INSERT INTO product_images(code,links_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at', code, JSON.stringify(cleaned.links), req.auth.id ?? null, updatedAt);
      else store.run('DELETE FROM product_images WHERE code=?', code);
      audit.record(req.auth, 'product_images.set', 'products', { code, count: cleaned.links.length }, req.territory?.id ?? null, req.socket.remoteAddress);
    });
    res.json({ code, links: cleaned.links, updatedAt });
  });
}
