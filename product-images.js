// Product image links for the price/stock and consignment pages, stored in the app's access database
// (never in SML). Everyone who can open those pages can read them; saving and uploading need the
// product_images permission. Uploaded photos are stored in product_image_files and linked by path.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import { sameSite } from './auth.js';
import { requirePermission, requireSuperAdmin } from './src/middleware/access.js';
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
// Uploads arrive already resized by the browser: [thumb bytes][image bytes], split by X-Thumb-Bytes.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_THUMB_BYTES = 256 * 1024;
const MAX_FILES_PER_CODE = MAX_IMAGES * 2;
// Unsaved uploads are kept this long so an editor still open elsewhere can save them.
const PRUNE_GRACE_MS = 15 * 60 * 1000;
const FILE_ID = /^[a-f0-9]{32}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Consignment codes (ฝ + 2 letters + 3 digits + model, e.g. ฝกต042LCD22) have their own photos only if
// someone added them. Otherwise they may show the photos of the regular product with the same model
// part (e.g. 907LCD22), but only when the SML names agree too: model parts like "CT4" are reused by
// unrelated products (a cable tie vs a mixer), while the same model differs only in spec wording.
const DEPOSIT_CODE = /^ฝ[^0-9]{2}[0-9]{3}(.+)$/;
export const MIN_NAME_SIMILARITY = 0.6;
const bigrams = text => {
  const t = String(text ?? '').replace(/\(@[^)]*\)/g, '').replace(/\s+/g, '').toUpperCase(), grams = new Map();
  for (let i = 0; i < t.length - 1; i++) grams.set(t.slice(i, i + 2), (grams.get(t.slice(i, i + 2)) || 0) + 1);
  return grams;
};
// Dice coefficient over character pairs, ignoring spaces, case and the (@pack) note: 0 = unrelated, 1 = same.
export function nameSimilarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let shared = 0, total = 0;
  for (const [gram, n] of A) { shared += Math.min(n, B.get(gram) || 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * shared) / total : 0;
}
// Trusts the bytes, not the declared Content-Type.
export function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

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
  app.get('/api/products/images/pending', requireSuperAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const imported = store.all('SELECT i.code, i.product_name, i.source_name, i.source_row, p.links_json FROM product_image_imports i JOIN product_images p ON p.code=i.code ORDER BY i.code');
    const unmatched = store.all('SELECT * FROM unmatched_product_images ORDER BY source_id').map(row => {
      const links = JSON.parse(row.links_json);
      return { code: null, reference: `Lazada ${row.source_id}`, name: row.product_name,
        links, imageCount: links.length, source: 'Lazada', sourceUrl: row.source_url,
        sourceRow: null, status: links.length ? 'unmatched' : 'unmatched_no_images' };
    });
    if (!imported.length) return res.json({ products: unmatched });
    try {
      const codes = imported.map(row => row.code);
      const { rows } = await pool.query('SELECT code FROM ic_inventory WHERE code = ANY($1::text[])', [codes]);
      const registered = new Set(rows.map(row => row.code));
      const products = imported.filter(row => !registered.has(row.code)).map(row => {
        const links = JSON.parse(row.links_json);
        return {
          code: row.code,
          name: row.product_name,
          imageCount: links.length,
          links,
          source: row.source_name,
          sourceRow: row.source_row,
          status: 'missing_in_sml',
        };
      });
      res.json({ products: [...products, ...unmatched] });
    } catch (error) {
      console.error('Pending product image check failed:', error.code);
      res.status(503).json({ error: 'ตรวจรายการสินค้าที่ยังไม่มีใน SML ไม่สำเร็จ' });
    }
  });
  app.get('/api/products/images', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const codes = [].concat(req.query.code ?? []);
    if (codes.length > MAX_CODES || !codes.every(validCode)) return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    const images = {};
    for (const code of new Set(codes)) { const saved = read(code); if (saved) images[code] = saved.links; }
    const borrowed = await borrowedImages([...new Set(codes)].filter(code => !images[code]));
    res.json({ images, ...(Object.keys(borrowed).length ? { borrowed } : {}), canEdit: hasPermission(req.auth, 'product_images') });
  });
  // { consignmentCode: { from: regularCode, links } } for consignment codes without photos of their own.
  // Photos are optional, so an SML failure just means no borrowed photos, never a failed request.
  async function borrowedImages(codes) {
    const wanted = codes.map(code => [code, code.match(DEPOSIT_CODE)?.[1]]).filter(([, model]) => model);
    if (!wanted.length) return {};
    const candidates = new Map();
    for (const [, model] of wanted) {
      if (candidates.has(model)) continue;
      const rows = store.all("SELECT code, links_json FROM product_images WHERE substr(code,4)=? AND code GLOB '[0-9][0-9][0-9]?*'", model);
      candidates.set(model, rows.map(row => { try { return { code: row.code, links: JSON.parse(row.links_json) }; } catch { return null; } })
        .filter(row => Array.isArray(row?.links) && row.links.length));
    }
    const lookup = [...new Set(wanted.flatMap(([code, model]) => candidates.get(model).length ? [code, ...candidates.get(model).map(c => c.code)] : []))];
    if (!lookup.length) return {};
    let names;
    try {
      // Read-only, parameterized; territory scoping of ic_inventory still applies through the pool.
      const { rows } = await pool.query('SELECT code, name_1 FROM ic_inventory WHERE code = ANY($1::text[])', [lookup]);
      names = new Map(rows.map(row => [row.code, row.name_1 || '']));
    } catch (error) {
      console.error('Borrowed product image lookup failed:', error.code);
      return {};
    }
    const result = {};
    for (const [code, model] of wanted) {
      if (!names.get(code)) continue;
      const scored = candidates.get(model).map(c => ({ ...c, score: names.get(c.code) ? nameSimilarity(names.get(code), names.get(c.code)) : 0 }))
        .filter(c => c.score >= MIN_NAME_SIMILARITY).sort((a, b) => b.score - a.score);
      // Two equally good candidates: no way to tell which is right, so show none.
      if (scored.length && !(scored.length > 1 && scored[1].score === scored[0].score)) result[code] = { from: scored[0].code, links: scored[0].links };
    }
    return result;
  }
  app.put('/api/products/images', sameSite, requirePermission('product_images'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { code, links } = req.body || {};
    if (!validCode(code)) return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
    const cleaned = cleanLinks(links);
    if (cleaned.invalid === -1) return res.status(400).json({ error: `ใส่ลิงก์รูปได้ไม่เกิน ${MAX_IMAGES} รูป` });
    if (cleaned.invalid) return res.status(400).json({ error: `มีลิงก์ไม่ถูกต้อง ${cleaned.invalid} รายการ`, invalid: cleaned.invalid });
    // An uploaded photo may only be linked from the product it was uploaded for, so pruning stays safe.
    const foreign = cleaned.links.filter(link => { const id = fileIdOf(link); return id && !store.get('SELECT 1 FROM product_image_files WHERE id=? AND code=?', id, code); }).length;
    if (foreign) return res.status(400).json({ error: `ไม่พบรูปที่อัปโหลด ${foreign} รูป กรุณาอัปโหลดใหม่`, invalid: foreign });
    if (!await productExists(code, res)) return;
    const updatedAt = new Date().toISOString();
    store.transaction(() => {
      if (cleaned.links.length) store.run('INSERT INTO product_images(code,links_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET links_json=excluded.links_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at', code, JSON.stringify(cleaned.links), req.auth.id ?? null, updatedAt);
      else store.run('DELETE FROM product_images WHERE code=?', code);
      pruneFiles(code);
      audit.record(req.auth, 'product_images.set', 'products', { code, count: cleaned.links.length }, req.territory?.id ?? null, req.socket.remoteAddress);
    });
    res.json({ code, links: cleaned.links, updatedAt });
  });
  // Upload one photo (browser-resized). Returns the link to put into the product's saved list.
  app.post('/api/products/images/files', sameSite, requirePermission('product_images'),
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_FILE_BYTES + MAX_THUMB_BYTES }), async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const code = req.query.code;
      if (!validCode(code)) return res.status(400).json({ error: 'รหัสสินค้าไม่ถูกต้อง' });
      if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP' });
      const thumbBytes = Number(req.get('X-Thumb-Bytes'));
      if (!Number.isInteger(thumbBytes) || thumbBytes < 12 || thumbBytes > MAX_THUMB_BYTES || thumbBytes >= req.body.length)
        return res.status(400).json({ error: 'ไฟล์รูปไม่ครบ กรุณาลองใหม่' });
      const thumb = req.body.subarray(0, thumbBytes), data = req.body.subarray(thumbBytes);
      if (data.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'รูปใหญ่เกิน 2MB' });
      const mime = imageType(data), thumbMime = imageType(thumb);
      if (!mime || !thumbMime) return res.status(415).json({ error: 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP' });
      pruneFiles(code);
      if (store.get('SELECT COUNT(*) AS n FROM product_image_files WHERE code=?', code).n >= MAX_FILES_PER_CODE)
        return res.status(429).json({ error: 'อัปโหลดรูปของสินค้านี้มากเกินไป กรุณาบันทึกหรือรอสักครู่แล้วลองใหม่' });
      if (!await productExists(code, res)) return;
      const id = randomBytes(16).toString('hex');
      store.run('INSERT INTO product_image_files(id,code,mime,data,thumb_mime,thumb,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
        id, code, mime, data, thumbMime, thumb, req.auth.id ?? null, new Date().toISOString());
      audit.record(req.auth, 'product_images.upload', 'products', { code, bytes: data.length }, req.territory?.id ?? null, req.socket.remoteAddress);
      res.status(201).json({ link: `/api/products/images/files/${id}` });
    });
  // Ids are random and contents never change, so the browser may cache each file for good.
  app.get('/api/products/images/files/:id', (req, res) => {
    if (!FILE_ID.test(req.params.id)) return res.status(404).json({ error: 'ไม่พบรูป' });
    const row = req.query.size === 'thumb'
      ? store.get('SELECT thumb_mime AS mime, thumb AS data FROM product_image_files WHERE id=?', req.params.id)
      : store.get('SELECT mime, data FROM product_image_files WHERE id=?', req.params.id);
    if (!row) { res.set('Cache-Control', 'no-store'); return res.status(404).json({ error: 'ไม่พบรูป' }); }
    res.set({ 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.type(row.mime).send(Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength));
  });

  const fileIdOf = link => normalizeImageLink(link).fileId;
  // Deletes this product's uploads that its saved list does not use, except very recent ones.
  function pruneFiles(code) {
    const used = new Set((read(code)?.links || []).map(fileIdOf).filter(Boolean));
    const cutoff = new Date(Date.now() - PRUNE_GRACE_MS).toISOString();
    for (const { id } of store.all('SELECT id FROM product_image_files WHERE code=? AND created_at<?', code, cutoff))
      if (!used.has(id)) store.run('DELETE FROM product_image_files WHERE id=?', id);
  }
  // Read-only, parameterized check that the code exists in the SML product register.
  // Sends the error response and returns false when it does not (or SML cannot be reached).
  async function productExists(code, res) {
    try {
      const found = await pool.query('SELECT 1 FROM ic_inventory WHERE code=$1 LIMIT 1', [code]);
      if (found.rows.length) return true;
      res.status(404).json({ error: 'ไม่พบสินค้าในทะเบียน' });
    } catch (error) {
      console.error('Product image check failed:', error.code);
      res.status(503).json({ error: 'ตรวจรหัสสินค้ากับ SML ไม่สำเร็จ กรุณาลองใหม่' });
    }
    return false;
  }
}
