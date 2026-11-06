// แคตตาล็อกสินค้า (E-Catalog): access rules, PDF serving, and the flip-book reader in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installAuth, hashPassword } from '../src/middleware/auth.js';
import { createAccessStore } from '../src/models/accessStore.js';
import { installAccess } from '../src/middleware/access.js';
import { createUserService } from '../src/services/userService.js';
import { loadUser } from '../src/services/permissionService.js';
import { installCatalog } from '../src/routes/catalog.js';
const CATALOGS = [{ id: 'car-audio', title: 'Car Audio', pdf: 'car-audio-web.pdf' }, { id: 'driver-unit', title: 'Driver Unit', pdf: 'driver-unit-web.pdf' }]; // fixture books
import { launchBrowser } from './support/browser.js';
import { expect } from '@playwright/test';

// Minimal valid PDF: one coloured page per entry with its number drawn large.
function makePdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let i = 1; i <= pages; i++) {
    const content = `${(i * 0.13) % 1} 0.5 0.8 rg 20 20 380 527 re f 0 0 0 rg BT /F1 160 Tf 110 220 Td (${i}) Tj ET BT /F1 18 Tf 40 40 Td (Model MNX-${i}00 mixer) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 567] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('catalog: open to everyone (no login, every role incl. reviewer); only listed PDFs are served', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'catalogs-'));
  writeFileSync(join(dir, CATALOGS[0].pdf), makePdf(3)); // second book left missing on purpose
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const store = createAccessStore(':memory:', env), app = express();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installCatalog(app, { CATALOG_DIR: dir }, CATALOGS);
  app.get(/.*/, (req, res) => res.send('page'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;

  // No login: the reader (without sidebar), list, PDFs and pdf.js; nothing else opens up, and no writes.
  const anon = (path, init) => fetch(base + path, { redirect: 'manual', ...init });
  const page = await anon('/catalog.html');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<body class="ecat-public">/);
  assert.doesNotMatch(html, /workspace-nav/);
  assert.equal((await anon('/CATALOG.HTML')).status, 200);
  for (const path of ['/catalog.js', '/catalog.css', '/api/catalogs', '/vendor/pdfjs/build/pdf.min.js', '/vendor/pdfjs/build/pdf.worker.min.js']) assert.equal((await anon(path)).status, 200, path);
  assert.equal((await anon('/catalogs/' + CATALOGS[0].pdf)).status, 200);
  assert.equal((await anon('/api/catalogs', { method: 'POST' })).status, 401);
  for (const path of ['/index.html', '/customer-stock.html', '/workspace-nav.js']) assert.equal((await anon(path)).status, 302, path);
  for (const path of ['/api/products', '/api/auth/me', '/api/customer-stock']) assert.equal((await anon(path)).status, 401, path);

  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  const login = async (username, role) => {
    await users.save(root, null, { username, full_name: username, role, is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });
    assert.equal(r.status, 200, username);
    const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return (path, headers = {}) => fetch(base + path, { headers: { cookie, ...headers } });
  };

  const admin = await login('admin1', 'admin');
  assert.equal((await admin('/catalog.html')).status, 200);
  const list = await (await admin('/api/catalogs')).json();
  assert.deepEqual(list.catalogs.map(c => [c.id, c.available]), [[CATALOGS[0].id, true], [CATALOGS[1].id, false]]);
  const pdf = await admin(list.catalogs[0].pdf);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await pdf.arrayBuffer()).byteLength > 100, true);
  const ranged = await admin(list.catalogs[0].pdf, { Range: 'bytes=0-7' });
  assert.equal(ranged.status, 206); // pdf.js range loading
  assert.equal((await admin(list.catalogs[0].pdf + '?download=1')).status, 403); // download button/attachment: Super Admin only
  assert.equal((await admin(list.catalogs[1].pdf)).status, 404); // listed, file not on disk yet
  for (const path of ['/catalogs/other.pdf', '/catalogs/..%2f.env', '/catalogs/..%5cserver.js']) assert.notEqual((await admin(path)).status, 200, path);
  assert.equal((await admin('/vendor/pdfjs/build/pdf.min.js')).status, 200);
  assert.equal((await admin('/vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap')).status, 200);
  assert.equal((await admin('/vendor/pdfjs/package.json')).status, 404); // only build/cmaps/standard_fonts are mounted

  const reviewer = await login('reviewer1', 'reviewer');
  for (const path of ['/catalog.html', '/api/catalogs', list.catalogs[0].pdf]) assert.equal((await reviewer(path)).status, 200, path);
  assert.equal((await reviewer('/customer-stock.html')).status, 403); // the rest of the reviewer allowlist is unchanged
});

test('catalog reader: spreads, flip, thumbnails, zoom, link, hash, small screen, missing file', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'catalogs-'));
  writeFileSync(join(dir, CATALOGS[0].pdf), makePdf(7));
  const app = express();
  const identity = { username: 'ui-fixture', role: 'sales', scope: 'all', territoryId: null, territories: [], permissions: [], landing: '/catalog.html' };
  let signedIn = true; // stands in for the session middleware
  app.use((req, res, next) => { if (signedIn) req.auth = identity; next(); });
  app.get('/api/auth/me', (req, res) => res.json(identity));
  app.get('/api/connection-status', (req, res) => res.json({ connected: true }));
  installCatalog(app, { CATALOG_DIR: dir }, CATALOGS);
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**', route => route.abort());
  await page.goto(`${base}/catalog.html`);

  // Menu: after ลูกค้า & สต็อก, labelled แคตตาล็อก, current page.
  const link = page.locator('.workspace-links [data-page="catalog"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(link).toHaveText('แคตตาล็อก');
  assert.equal(await page.locator('.workspace-links a').evaluateAll(a => a.findIndex(x => x.dataset.page === 'catalog') - a.findIndex(x => x.dataset.page === 'customer-stock')), 1);

  // Tabs from config; cover alone on the right.
  await expect(page.locator('#ecat-tabs [role=tab]')).toHaveText(CATALOGS.map(c => c.title));
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 1 / 7');
  await expect(page.locator('.ecat-page-left')).toHaveClass(/is-empty/);
  await expect(page.locator('#ecat-thumbs .ecat-thumb')).toHaveCount(4); // 1 | 2-3 | 4-5 | 6-7
  await expect(page.locator('#ecat-zoom-out')).toBeDisabled();

  // Next arrow flips (leaf visible mid-turn), keyboard, corner, slider, thumbnail.
  await page.locator('#ecat-next').click();
  await expect(page.locator('.ecat-leaf')).toBeVisible();
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 2–3 / 7');
  await expect(page.locator('.ecat-leaf')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 4–5 / 7');
  await expect(page.locator('.ecat-leaf')).toBeHidden();
  await page.locator('.ecat-corner-prev').click();
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 2–3 / 7');
  await expect(page.locator('.ecat-leaf')).toBeHidden();
  await page.locator('#ecat-slider').fill('3');
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 6–7 / 7');
  await expect(page.locator('#ecat-next')).toBeDisabled();
  await expect(page.locator('.ecat-thumb').nth(3)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.ecat-leaf')).toBeHidden();
  // Thumbnail strip is a drop-down, closed by default (bigger pages); opening it shrinks the stage.
  await expect(page.locator('#ecat-thumbs')).toBeHidden();
  const tall = (await page.locator('#ecat-stage').boundingBox()).height;
  await page.locator('#ecat-thumbs-toggle').click();
  await expect(page.locator('#ecat-thumbs')).toBeVisible();
  assert.ok((await page.locator('#ecat-stage').boundingBox()).height < tall);
  await page.locator('.ecat-thumb').first().click();
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 1 / 7');
  // Page canvases hold real rendered pixels.
  await expect.poll(() => page.locator('.ecat-page-right canvas').evaluate(c => c.width)).toBeGreaterThan(100);
  // Thumbnail strip: scrollbar hidden.
  assert.equal(await page.locator('#ecat-thumbs').evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');

  // Zoom 100 → 250 (capped) and back.
  for (let i = 0; i < 8; i++) await page.locator('#ecat-zoom-in').click({ force: true });
  await expect(page.locator('#ecat-zoom-value')).toHaveText('250%');
  await expect(page.locator('#ecat-zoom-in')).toBeDisabled();
  // Pan: drag the zoomed page with the mouse; the page does not turn.
  const stageEl = page.locator('#ecat-stage');
  const sb = await stageEl.boundingBox();
  const counterBefore = await page.locator('#ecat-counter').textContent();
  const startScroll = await stageEl.evaluate(el => [el.scrollLeft, el.scrollTop]);
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2 - 150, sb.y + sb.height / 2 - 120, { steps: 6 });
  await page.mouse.up();
  const endScroll = await stageEl.evaluate(el => [el.scrollLeft, el.scrollTop]);
  assert.ok(endScroll[0] > startScroll[0] + 100 && endScroll[1] > startScroll[1] + 80, 'panned ' + startScroll + ' -> ' + endScroll);
  await expect(page.locator('#ecat-counter')).toHaveText(counterBefore);
  for (let i = 0; i < 6; i++) await page.locator('#ecat-zoom-out').click({ force: true });
  await expect(page.locator('#ecat-zoom-value')).toHaveText('100%');

  // Search the PDF text: "mnx 500" finds MNX-500 on page 5 and jumps to spread 4-5.
  await page.locator('#ecat-search').fill('mnx 500');
  await expect(page.locator('.ecat-search-hit')).toHaveCount(1);
  await expect(page.locator('.ecat-search-hit strong')).toHaveText('หน้า 5');
  await page.locator('.ecat-search-hit').click();
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 4–5 / 7');
  await expect(page.locator('#ecat-search-results')).toBeHidden();
  await page.locator('#ecat-search').fill('MNX-');
  await expect(page.locator('.ecat-search-hit')).toHaveCount(7);
  await page.screenshot({ path: 'test-results/catalog-search.png' });
  // Not inside another word: "X 1" must not match "MNX-100" ("…NX-1…"), "nx" must not either.
  await page.locator('#ecat-search').fill('X 1');
  await expect(page.locator('#ecat-search-results')).toContainText('ไม่พบ');
  // Prefix of a model still works; the exact model is listed first.
  await page.locator('#ecat-search').fill('mnx-30');
  await expect(page.locator('.ecat-search-hit strong')).toHaveText(['หน้า 3']);
  await page.locator('#ecat-search').fill('ไม่มีคำนี้');
  await expect(page.locator('#ecat-search-results')).toContainText('ไม่พบ');
  await page.locator('#ecat-search').press('Escape');
  await expect(page.locator('.ecat-leaf')).toBeHidden();

  // แชร์หน้านี้: left / right / both -> link to a PDF of only those pages; or a link into the reader.
  await page.locator('#ecat-share').click();
  await expect(page.locator('#ecat-share-menu [data-pages=left]')).toHaveText('หน้าซ้าย · หน้า 4');
  await expect(page.locator('#ecat-share-menu [data-pages=both]')).toHaveText('ทั้งสองหน้า · หน้า 4–5');
  await page.locator('#ecat-share-menu [data-pages=right]').click();
  await expect(page.locator('#ecat-toast')).toHaveText('คัดลอกลิงก์ PDF หน้า 5 แล้ว');
  const one = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(one, `${base}/catalogs/${CATALOGS[0].pdf}/pages/5.pdf`);
  const { PDFDocument } = await import('pdf-lib');
  const r1 = await fetch(one);
  assert.equal(r1.headers.get('content-type'), 'application/pdf');
  assert.equal((await PDFDocument.load(await r1.arrayBuffer())).getPageCount(), 1);
  const r2 = await fetch(`${base}/catalogs/${CATALOGS[0].pdf}/pages/4-5.pdf`);
  assert.equal((await PDFDocument.load(await r2.arrayBuffer())).getPageCount(), 2);
  for (const bad of ['9.pdf', '1-5.pdf', '0.pdf', 'x.pdf']) assert.ok((await fetch(`${base}/catalogs/${CATALOGS[0].pdf}/pages/${bad}`)).status >= 400, bad);
  await page.locator('#ecat-share').click();
  await expect(page.locator('#ecat-share-menu [data-pages=link]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Opening a shared page link lands on that spread.
  const shared = await context.newPage();
  await shared.route('https://**', route => route.abort());
  await shared.goto(`${base}/catalog.html#${CATALOGS[0].id}/7`);
  await expect(shared.locator('#ecat-counter')).toHaveText('หน้า 6–7 / 7');
  await shared.close();
  await expect(page.locator('#ecat-download')).toBeHidden(); // Super Admin only
  await expect(page.locator('#ecat-remove')).toBeHidden();

  // Fullscreen toggles.
  await page.locator('#ecat-fullscreen').click();
  await expect(page.locator('#ecat-fullscreen')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#ecat-fullscreen').click();
  await expect(page.locator('#ecat-fullscreen')).toHaveAttribute('aria-pressed', 'false');

  // Second book via #id: file missing -> error message, not a blank viewer.
  await page.goto(`${base}/catalog.html#${CATALOGS[1].id}`);
  await expect(page.locator(`#ecat-tabs [data-id="${CATALOGS[1].id}"]`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ecat-state.is-error')).toContainText('เปิดแคตตาล็อกนี้ไม่ได้');
  await page.locator(`#ecat-tabs [data-id="${CATALOGS[0].id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#${CATALOGS[0].id}$`));
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 1 / 7');

  // Light theme still renders with the shared tokens.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  assert.equal(await page.locator('.ecat-viewer').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');

  // Below 760px: one page at a time, swipe changes page, no horizontal page scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#ecat-thumbs .ecat-thumb')).toHaveCount(7);
  await expect(page.locator('#ecat-book')).toHaveClass(/is-single/);
  // Thumbnail strip scrolls: arrow button and mouse wheel.
  const strip = page.locator('#ecat-thumbs');
  await page.locator('.ecat-thumb').first().evaluate(el => el.parentElement.scrollTo({ left: 0, behavior: 'instant' }));
  await expect(page.locator('.ecat-thumbs-scroll-prev')).toBeDisabled();
  await page.locator('.ecat-thumbs-scroll-next').click();
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(50);
  await expect(page.locator('.ecat-thumbs-scroll-prev')).toBeEnabled();
  const before = await strip.evaluate(el => el.scrollLeft);
  await strip.hover();
  await page.mouse.wheel(0, -200);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeLessThan(before);
  const box = await page.locator('#ecat-stage').boundingBox();
  await page.locator('#ecat-stage').dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 300, clientY: box.y + 200 });
  await page.locator('#ecat-stage').dispatchEvent('pointerup', { pointerType: 'touch', clientX: box.x + 120, clientY: box.y + 210 });
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 2 / 7');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(page.locator('.ecat-leaf')).toBeHidden();
  await page.screenshot({ path: 'test-results/catalog-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 2–3 / 7');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.locator('#ecat-next').click();
  await page.waitForTimeout(380);
  await page.screenshot({ path: 'test-results/catalog-flip.png' }); // mid-turn: back of the leaf is page 4
  await expect(page.locator('.ecat-leaf')).toBeHidden();
  await page.screenshot({ path: 'test-results/catalog-desktop.png' });
  assert.deepEqual(errors, []);

  // Customer without an account: the server sends the page without the sidebar.
  signedIn = false;
  const visitor = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await visitor.route('https://**', route => route.abort());
  await visitor.goto(`${base}/catalog.html#${CATALOGS[0].id}`);
  await expect(visitor.locator('#ecat-counter')).toHaveText('หน้า 1 / 7');
  assert.equal(await visitor.locator('.workspace-sidebar').count(), 0);
  // Lone cover is centred in the stage.
  const [st, pg] = [await visitor.locator('#ecat-stage').boundingBox(), await visitor.locator('.ecat-page-right').boundingBox()];
  assert.ok(Math.abs((pg.x + pg.width / 2) - (st.x + st.width / 2)) < 4, 'cover centred');
  await visitor.screenshot({ path: 'test-results/catalog-public.png' });
});

test('catalog from a Google Drive link: downloaded once, served same-origin, private file -> clear 502', async t => {
  const { driveFileId } = await import('../src/routes/catalog.js');
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.equal(driveFileId(`https://drive.google.com/file/d/${id}/view?usp=sharing`), id);
  assert.equal(driveFileId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(driveFileId('https://example.com/x.pdf'), null);
  const dir = mkdtempSync(join(tmpdir(), 'catalogs-'));
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const ok = url.includes(id);
    return new Response(ok ? makePdf(2) : '<html>sign in</html>', { status: 200 });
  };
  const books = [
    { id: 'drive-book', title: 'Drive', pdf: 'drive-book.pdf', drive: `https://drive.google.com/file/d/${id}/view` },
    { id: 'private-book', title: 'Private', pdf: 'private-book.pdf', drive: 'https://drive.google.com/file/d/1PrivateFileIdXXXXXXXXXXXXXXXXX/view' },
  ];
  const app = express();
  installCatalog(app, { CATALOG_DIR: dir, fetchImpl }, books);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const list = await (await fetch(base + '/api/catalogs')).json();
  assert.deepEqual(list.catalogs.map(c => c.available), [true, true]);
  const [a, b] = await Promise.all([fetch(base + '/catalogs/drive-book.pdf'), fetch(base + '/catalogs/drive-book.pdf')]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(Buffer.from(await a.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(base + '/catalogs/drive-book.pdf', { headers: { Range: 'bytes=0-3' } })).status, 206);
  assert.equal(calls.length, 1); // concurrent + later requests reuse the one download
  assert.match(calls[0], /^https:\/\/drive\.usercontent\.google\.com\/download\?id=/);
  const priv = await fetch(base + '/catalogs/private-book.pdf');
  assert.equal(priv.status, 502);
  assert.match((await priv.json()).error, /ทุกคนที่มีลิงก์/);
});

test('catalog add/remove from the page: catalog_manage only, Drive link required, stored outside Git', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'catalogs-'));
  const env = { AUTH_USERNAME: 'root', AUTH_PASSWORD_HASH: await hashPassword('fixture-password-123'), AUTH_COOKIE_SECURE: 'false', AUTH_REQUIRE_2FA: 'false' };
  const store = createAccessStore(':memory:', env), app = express();
  app.use(express.json());
  const auth = installAuth(app, env, store);
  installAccess(app);
  installCatalog(app, { CATALOG_DIR: dir, fetchImpl: async () => new Response(makePdf(3)) }, []);
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); await new Promise(r => { server.close(r); server.closeAllConnections(); }); auth.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const users = createUserService(store, auth.audit), root = loadUser(store, 1);
  const login = async (username, role) => {
    if (role) await users.save(root, null, { username, full_name: username, role, is_active: true, password: 'fixture-password-123', territoryIds: [], additionalPermissions: [] }, 'test');
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) });
    assert.equal(r.status, 200, username);
    return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  };
  const send = (cookie, method, path, body, csrf = true) => fetch(base + path, { method, headers: { ...(cookie && { cookie }), 'Content-Type': 'application/json', ...(csrf && { 'X-PRPlus-Request': '1' }) }, body: body && JSON.stringify(body) });
  const link = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing';

  assert.equal((await send(null, 'POST', '/api/catalogs', { title: 'X', drive: link })).status, 401);
  const admin = await login('admin1', 'admin'); // no catalog_manage by default
  assert.equal((await send(admin, 'POST', '/api/catalogs', { title: 'X', drive: link })).status, 403);
  const rootCookie = await login('root');
  assert.equal((await send(rootCookie, 'POST', '/api/catalogs', { title: 'X', drive: link }, false)).status, 403); // CSRF header
  assert.equal((await send(rootCookie, 'POST', '/api/catalogs', { title: 'X', drive: 'https://example.com/x.pdf' })).status, 400);
  assert.equal((await send(rootCookie, 'POST', '/api/catalogs', { title: '', drive: link })).status, 400);

  // Browser: super admin adds a book with the + button, it opens, then removes it.
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addCookies(rootCookie.split('; ').map(c => { const [name, value] = c.split('='); return { name, value, url: base }; }));
  const page = await context.newPage();
  await page.route('https://**', route => route.abort());
  await page.goto(base + '/catalog.html');
  await expect(page.locator('#ecat-state')).toContainText('ยังไม่มีแคตตาล็อก');
  await page.locator('#ecat-add').click();
  await page.locator('#ecat-add-form [name=title]').fill('Pro Audio 2027');
  await page.locator('#ecat-add-form [name=drive]').fill(link);
  await page.locator('#ecat-add-submit').click();
  await expect(page.locator('#ecat-tabs [role=tab]')).toHaveText(['Pro Audio 2027']);
  await expect(page).toHaveURL(/#pro-audio-2027$/);
  await expect(page.locator('#ecat-counter')).toHaveText('หน้า 1 / 3');
  await page.screenshot({ path: 'test-results/catalog-add.png' });
  assert.equal(JSON.parse(readFileSync(join(dir, 'catalogs.json'), 'utf8'))[0].id, 'pro-audio-2027');
  assert.equal((await send(rootCookie, 'POST', '/api/catalogs', { title: 'pro audio 2027', drive: link })).status, 409);
  await expect(page.locator('#ecat-download')).toBeVisible();
  const dl = await fetch(base + `/catalogs/pro-audio-2027.pdf?download=1`, { headers: { cookie: rootCookie } });
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  page.once('dialog', d => d.accept());
  await page.locator('#ecat-remove').click();
  await expect(page.locator('#ecat-state')).toContainText('ยังไม่มีแคตตาล็อก');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'catalogs.json'), 'utf8')), []);

  // Signed-in user without catalog_manage: no + button.
  const ctx2 = await browser.newContext();
  await ctx2.addCookies(admin.split('; ').map(c => { const [name, value] = c.split('='); return { name, value, url: base }; }));
  const p2 = await ctx2.newPage();
  await p2.route('https://**', route => route.abort());
  await p2.goto(base + '/catalog.html');
  await expect(p2.locator('#ecat-state')).toContainText('ยังไม่มีแคตตาล็อก');
  await expect(p2.locator('#ecat-add')).toBeHidden();
});
