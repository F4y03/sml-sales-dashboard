import express from 'express';
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, renameSync, rmSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { CATALOGS } from '../config/catalogs.js';
import { sameSite } from '../middleware/auth.js';
import { hasPermission } from '../services/permissionService.js';

// แคตตาล็อกสินค้า (E-Catalog). No SML data: a static list (src/config/catalogs.js) plus PDF files.
// Open to everyone, including customers without an account (links are sent to customers):
// signed-in users get the normal page with the workspace sidebar, visitors get the reader alone.
const VALID_ID = /^[a-z0-9-]{1,60}$/;
const VALID_FILE = /^[\w.-]{1,120}\.pdf$/i;
const PUBLIC_FILES = new Set(['/catalog.html', '/catalog.css', '/catalog.js', '/api/catalogs']);
// Google Drive share link -> file id. Only the id is used: the server never fetches a URL taken from config/request.
export function driveFileId(link) {
  if (typeof link !== 'string') return null;
  const m = link.match(/\/d\/([\w-]{20,})/) || link.match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : null;
}
const DRIVE_REFRESH_MS = 6 * 3600 * 1000; // re-download from Drive at most every 6 h
const DRIVE_MAX_BYTES = 400 * 1024 * 1024;
const PUBLIC_PREFIXES = ['/catalogs/', '/vendor/pdfjs/'];

// Read-only catalog requests that need no login (checked in src/middleware/auth.js and access.js).
export function isCatalogPublicRead(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const path = req.path.toLowerCase(); // Express routing and Windows static files are case-insensitive
  return PUBLIC_FILES.has(path) || PUBLIC_PREFIXES.some(p => path.startsWith(p));
}

export function installCatalog(app, env = process.env, catalogs = CATALOGS) {
  const dir = resolve(env.CATALOG_DIR || fileURLToPath(new URL('../../data/catalogs/', import.meta.url)));
  const valid = b => b && VALID_ID.test(b.id) && VALID_FILE.test(b.pdf) && typeof b.title === 'string' && (!b.drive || driveFileId(b.drive));
  // Books added from the page (catalog_manage) live in CATALOG_DIR/catalogs.json, after the ones in src/config/catalogs.js.
  const customPath = resolve(dir, 'catalogs.json');
  const readCustom = () => { try { const list = JSON.parse(readFileSync(customPath, 'utf8')); return Array.isArray(list) ? list.filter(valid) : []; } catch { return []; } };
  const writeCustom = list => { mkdirSync(dir, { recursive: true }); writeFileSync(customPath + '.tmp', JSON.stringify(list, null, 2)); renameSync(customPath + '.tmp', customPath); };
  const fixed = catalogs.filter(valid);
  const allBooks = () => {
    const seen = new Set(fixed.map(b => b.id));
    return [...fixed, ...readCustom().filter(b => !seen.has(b.id)).map(b => ({ ...b, custom: true }))];
  };
  const bookByFile = name => allBooks().find(b => b.pdf.toLowerCase() === name.toLowerCase());
  const driveJobs = new Map(); // pdf -> in-flight download

  // Drive books: download into CATALOG_DIR/<pdf>, then serve same-origin like an uploaded file (pdf.js needs same-origin + ranges).
  async function downloadFromDrive(book, fetchImpl = fetch) {
    const id = driveFileId(book.drive), file = resolve(dir, book.pdf), tmp = file + '.download';
    const response = await fetchImpl(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw Object.assign(new Error('Drive HTTP ' + response.status), { code: 'DRIVE_HTTP' });
    if (Number(response.headers.get('content-length')) > DRIVE_MAX_BYTES) throw Object.assign(new Error('too large'), { code: 'DRIVE_TOO_LARGE' });
    mkdirSync(dir, { recursive: true });
    let size = 0;
    try {
      await pipeline(Readable.fromWeb(response.body), async function* (source) {
        for await (const chunk of source) { size += chunk.length; if (size > DRIVE_MAX_BYTES) throw Object.assign(new Error('too large'), { code: 'DRIVE_TOO_LARGE' }); yield chunk; }
      }, createWriteStream(tmp));
      // A private / not-shared file comes back as an HTML sign-in or warning page, not a PDF.
      if (readFileSync(tmp).subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('not a PDF'), { code: 'DRIVE_NOT_PDF' });
      renameSync(tmp, file);
    } finally { rmSync(tmp, { force: true }); }
  }
  function refreshDrive(book) {
    if (!driveJobs.has(book.pdf)) driveJobs.set(book.pdf, downloadFromDrive(book, env.fetchImpl).finally(() => driveJobs.delete(book.pdf)));
    return driveJobs.get(book.pdf);
  }
  // Fresh file on disk -> use it. Old file -> use it and refresh in the background. No file -> wait for the download.
  async function ensureFile(book) {
    const file = resolve(dir, book.pdf);
    if (!book.drive) return existsSync(file);
    const age = existsSync(file) ? Date.now() - statSync(file).mtimeMs : Infinity;
    if (age < DRIVE_REFRESH_MS) return true;
    if (age !== Infinity) { refreshDrive(book).catch(e => console.error('Catalog Drive refresh failed:', book.id, e.code || e.message)); return true; }
    await refreshDrive(book);
    return true;
  }

  const pagePath = fileURLToPath(new URL('../../public/catalog.html', import.meta.url));

  // Visitors without a session: same page minus the workspace sidebar (it needs /api/auth/me and would bounce to login).
  app.get('/catalog.html', (req, res, next) => {
    if (req.auth) return next(); // static file below, with the sidebar
    const html = readFileSync(pagePath, 'utf8')
      .replace(/^\s*<link[^>]*workspace-nav\.css[^>]*>\s*$/m, '')
      .replace(/^\s*<script[^>]*workspace-nav\.js[^>]*><\/script>\s*$/m, '')
      .replace('<body>', '<body class="ecat-public">');
    res.type('html').send(html);
  });

  app.get('/api/catalogs', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      catalogs: allBooks().map(b => ({ custom: Boolean(b.custom),
        id: b.id, title: b.title,
        pdf: `/catalogs/${encodeURIComponent(b.pdf)}`,
        available: Boolean(b.drive) || existsSync(resolve(dir, b.pdf)),
        // Categories set by hand (Super Admin). Absent -> the page builds them from the footer labels in the PDF.
        ...(Array.isArray(b.sections) && b.sections.length ? { sections: b.sections } : {}),
      })),
    });
  });

  // Add / remove books from the page. Writes need a login + catalog_manage (also enforced in access.js) and the CSRF header.
  const canManage = (req, res, next) => hasPermission(req.auth, 'catalog_manage') ? next() : res.status(403).json({ error: 'ไม่มีสิทธิ์จัดการแคตตาล็อก' });
  app.post('/api/catalogs', sameSite, canManage, (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().replace(/\s+/g, ' ') : '';
    const drive = typeof req.body?.drive === 'string' ? req.body.drive.trim() : '';
    if (!title || title.length > 60) return res.status(400).json({ error: 'กรุณาใส่ชื่อเล่ม (ไม่เกิน 60 ตัวอักษร)' });
    const fileId = driveFileId(drive);
    if (!fileId || !/^https:\/\/(drive|docs)\.google\.com\//.test(drive)) return res.status(400).json({ error: 'ลิงก์ไม่ใช่ลิงก์ไฟล์ Google Drive (เช่น https://drive.google.com/file/d/…/view)' });
    const existing = allBooks();
    if (existing.some(b => b.title.toLowerCase() === title.toLowerCase())) return res.status(409).json({ error: 'มีเล่มชื่อนี้แล้ว' });
    const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'catalog';
    let id = base, n = 2;
    while (existing.some(b => b.id === id)) id = `${base}-${n++}`;
    const book = { id, title, pdf: `${id}.pdf`, drive: `https://drive.google.com/file/d/${fileId}/view` };
    writeCustom([...readCustom(), book]);
    console.log('Catalog added:', id, 'by', req.auth.username);
    res.status(201).json({ catalog: { id, title, custom: true, pdf: `/catalogs/${book.pdf}`, available: true } });
  });
  // Edit the category drop-down of a book added on the page: [{ title, page }]; an empty list goes back to automatic.
  app.put('/api/catalogs/:id/sections', sameSite, (req, res, next) => req.auth?.role === 'super_admin' ? next() : res.status(403).json({ error: 'แก้หมวดได้เฉพาะ Super Admin' }), (req, res) => {
    const input = req.body?.sections;
    if (!Array.isArray(input) || input.length > 100) return res.status(400).json({ error: 'รายการหมวดไม่ถูกต้อง' });
    const sections = [];
    for (const item of input) {
      const title = typeof item?.title === 'string' ? item.title.trim().replace(/\s+/g, ' ') : '';
      const page = Number(item?.page);
      if (!title || title.length > 60 || !Number.isInteger(page) || page < 1 || page > 9999) return res.status(400).json({ error: 'แต่ละบรรทัดต้องมีเลขหน้าและชื่อหมวด (ไม่เกิน 60 ตัวอักษร)' });
      sections.push({ title, page });
    }
    sections.sort((a, b) => a.page - b.page);
    const list = readCustom(), book = list.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'แก้หมวดได้เฉพาะเล่มที่เพิ่มจากหน้าเว็บ' });
    if (sections.length) book.sections = sections; else delete book.sections;
    writeCustom(list);
    console.log('Catalog sections saved:', book.id, sections.length, 'by', req.auth.username);
    res.json({ sections });
  });
  app.delete('/api/catalogs/:id', sameSite, (req, res, next) => req.auth?.role === 'super_admin' ? next() : res.status(403).json({ error: 'ลบเล่มได้เฉพาะ Super Admin' }), (req, res) => {
    const list = readCustom(), book = list.find(b => b.id === req.params.id);
    if (!book) return res.status(404).json({ error: 'ลบได้เฉพาะเล่มที่เพิ่มจากหน้าเว็บ' });
    writeCustom(list.filter(b => b !== book));
    rmSync(resolve(dir, book.pdf), { force: true });
    console.log('Catalog removed:', book.id, 'by', req.auth.username);
    res.json({ ok: true });
  });

  // pdfjs-dist (pinned 3.11.174) served from node_modules: library code, cMaps and standard fonts only.
  const pdfjsRoot = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));
  const vendor = { maxAge: '7d', index: false, fallthrough: false };
  app.use('/vendor/pdfjs/build', express.static(resolve(pdfjsRoot, 'build'), vendor));
  app.use('/vendor/pdfjs/cmaps', express.static(resolve(pdfjsRoot, 'cmaps'), vendor));
  app.use('/vendor/pdfjs/standard_fonts', express.static(resolve(pdfjsRoot, 'standard_fonts'), vendor));
  app.use('/vendor/pdfjs', (_req, res) => res.status(404).end());

  // Shareable link to one page or a spread: /catalogs/<pdf>/pages/122.pdf or /pages/122-123.pdf ("แชร์หน้านี้").
  // pdf-lib copies the pages out of the original (vector, same quality); results are cached on disk per source version.
  const pageJobs = new Map();
  app.get('/catalogs/:file/pages/:range', async (req, res) => {
    const book = bookByFile(String(req.params.file));
    const m = /^(\d{1,4})(?:-(\d{1,4}))?\.pdf$/i.exec(String(req.params.range));
    if (!book || !m) return res.status(404).json({ error: 'ไม่พบหน้าแคตตาล็อก' });
    const from = Number(m[1]), to = Number(m[2] || m[1]);
    if (from < 1 || to < from || to - from > 1) return res.status(400).json({ error: 'แชร์ได้ครั้งละ 1–2 หน้า' });
    try {
      if (!(await ensureFile(book))) return res.status(404).json({ error: 'ยังไม่มีไฟล์ PDF ของแคตตาล็อกนี้บนเซิร์ฟเวอร์' });
      const source = resolve(dir, book.pdf), version = Math.round(statSync(source).mtimeMs);
      const cacheDir = resolve(dir, 'pages'), out = resolve(cacheDir, `${book.id}-${version}-${from}-${to}.pdf`);
      if (!existsSync(out)) {
        if (!pageJobs.has(out)) pageJobs.set(out, (async () => {
          const src = await PDFDocument.load(readFileSync(source), { ignoreEncryption: true, updateMetadata: false });
          if (to > src.getPageCount()) throw Object.assign(new Error('range'), { code: 'RANGE' });
          const doc = await PDFDocument.create();
          for (const page of await doc.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))) doc.addPage(page);
          doc.setTitle(`${book.title} หน้า ${from === to ? from : from + '–' + to}`);
          mkdirSync(cacheDir, { recursive: true });
          writeFileSync(out + '.tmp', await doc.save());
          renameSync(out + '.tmp', out);
        })().finally(() => pageJobs.delete(out)));
        await pageJobs.get(out);
      }
      res.set({ 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      const name = `${book.pdf.replace(/\.pdf$/i, '')}-p${from === to ? from : from + '-' + to}.pdf`;
      res.sendFile(out, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"` } });
    } catch (error) {
      if (error.code === 'RANGE') return res.status(404).json({ error: 'ไม่มีหน้านี้ในแคตตาล็อก' });
      console.error('Catalog page share failed:', book.id, error.code || error.message);
      res.status(502).json({ error: 'สร้างไฟล์หน้านี้ไม่สำเร็จ กรุณาลองใหม่' });
    }
  });

  // Only files listed in the config are served; never a path from the request.
  app.get('/catalogs/:file', async (req, res) => {
    const book = bookByFile(String(req.params.file));
    if (!book) return res.status(404).json({ error: 'ไม่พบแคตตาล็อก' });
    const file = resolve(dir, book.pdf);
    try {
      if (!(await ensureFile(book))) return res.status(404).json({ error: 'ยังไม่มีไฟล์ PDF ของแคตตาล็อกนี้บนเซิร์ฟเวอร์' });
    } catch (error) {
      console.error('Catalog Drive download failed:', book.id, error.code || error.message);
      return res.status(502).json({ error: error.code === 'DRIVE_NOT_PDF' ? 'ไฟล์ใน Google Drive ยังไม่ได้แชร์แบบ "ทุกคนที่มีลิงก์" หรือไม่ใช่ PDF' : 'ดึงไฟล์จาก Google Drive ไม่สำเร็จ' });
    }
    res.set({ 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    if (req.query.download === '1') {
      if (req.auth?.role !== 'super_admin') return res.status(403).json({ error: 'ดาวน์โหลดได้เฉพาะ Super Admin' });
      res.attachment(book.pdf);
    }
    res.sendFile(file, { headers: { 'Content-Type': 'application/pdf' }, acceptRanges: true, lastModified: true });
  });
}
