import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAccessStore } from './src/models/accessStore.js';
import { installProductImages, normalizeImageLink, cleanLinks, nameSimilarity, MIN_NAME_SIMILARITY } from './product-images.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const view = `https://drive.google.com/file/d/${ID}/view`;

test('image links: every Drive form normalizes to the standard view link; folders and bad links are rejected', () => {
  for (const input of [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/file/d/${ID}/view`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
    `https://drive.google.com/thumbnail?id=${ID}&sz=w1200`,
    `  ${ID}  `,
  ]) assert.deepEqual(normalizeImageLink(input), { ok: true, value: view, driveId: ID }, input);
  assert.equal(normalizeImageLink('https://drive.google.com/drive/folders/1HmVIUErEOYkqfdksZ1ABoY8O6w-bqXip').reason, 'folder');
  assert.equal(normalizeImageLink('https://drive.google.com/drive/u/0/folders/1HmVIUErEOYkqfdksZ1ABoY8O6w-bqXip').reason, 'folder');
  for (const bad of ['http://example.com/a.jpg', 'javascript:alert(1)', 'ftp://x/y.png', 'not a link', 'https://drive.google.com/file/d/short/view', 'https://' + 'a'.repeat(1001)])
    assert.equal(normalizeImageLink(bad).reason, 'invalid', bad);
  assert.equal(normalizeImageLink('   ').reason, 'empty');
  assert.deepEqual(normalizeImageLink('https://cdn.example.com/p/1.jpg?x=1'), { ok: true, value: 'https://cdn.example.com/p/1.jpg?x=1', driveId: null });
  assert.deepEqual(cleanLinks([' ', ID, '', 'https://cdn.example.com/a.png']), { links: [view, 'https://cdn.example.com/a.png'] });
  assert.deepEqual(cleanLinks([ID, 'bad', 'https://drive.google.com/drive/folders/1HmVIUErEOYkqfdksZ1ABoY8O6w-bqXip']), { invalid: 2 });
  assert.deepEqual(cleanLinks('x'), { invalid: -1 });
});

test('image API: readers see links, only product_images may save, same-site header required, SML untouched', async () => {
  const store = createAccessStore(':memory:');
  const audits = [], queries = [];
  const audit = { record: (...args) => audits.push(args) };
  const pool = { query: async (sql, params) => { queries.push([sql, params]); return { rows: params[0] === 'MISSING' ? [] : [{ '?column?': 1 }] }; } };
  let auth = { id: 7, role: 'sales', permissions: ['price_stock'] };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.auth = auth; next(); });
  installProductImages(app, store, audit, pool);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (body, headers = { 'X-PRPlus-Request': '1' }) => fetch(`${base}/api/products/images`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    let response = await fetch(`${base}/api/products/images?code=P1&code=P2`);
    assert.deepEqual(await response.json(), { images: {}, canEdit: false });
    assert.equal((await put({ code: 'P1', links: [ID] })).status, 403, 'no product_images permission');
    auth = { id: 1, role: 'admin', permissions: ['price_stock', 'product_images'] };
    assert.equal((await put({ code: 'P1', links: [ID] }, {})).status, 403, 'missing same-site header');
    assert.equal((await put({ code: '', links: [ID] })).status, 400);
    response = await put({ code: 'P1', links: [ID, 'nope'] });
    assert.equal(response.status, 400);assert.equal((await response.json()).invalid, 1);
    assert.equal((await put({ code: 'P1', links: Array(21).fill(ID) })).status, 400);
    assert.equal((await put({ code: 'MISSING', links: [ID] })).status, 404);
    response = await put({ code: 'P1', links: [` https://drive.google.com/open?id=${ID} `, '', 'https://cdn.example.com/b.jpg'] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).links, [view, 'https://cdn.example.com/b.jpg']);
    response = await fetch(`${base}/api/products/images?code=P1&code=P2`);
    assert.deepEqual(await response.json(), { images: { P1: [view, 'https://cdn.example.com/b.jpg'] }, canEdit: true });
    assert.equal((await put({ code: 'P1', links: [] })).status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/products/images?code=P1`)).json()).images, {});
    assert.equal((await fetch(`${base}/api/products/images?${'code=x&'.repeat(101)}`)).status, 400);
    // Only a parameterized read-only existence check reaches SML.
    assert.ok(queries.every(([sql, params]) => /^SELECT 1 FROM ic_inventory WHERE code=\$1 LIMIT 1$/.test(sql) && params.length === 1));
    assert.deepEqual(audits.map(entry => [entry[1], entry[3].code, entry[3].count]), [['product_images.set', 'P1', 2], ['product_images.set', 'P1', 0]]);
    // Super Admin gets the new permission in the permission table as well.
    assert.ok(store.get("SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.code='super_admin' AND p.code='product_images'"));
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});

test('uploaded photos: product_images only, real image bytes only, served with thumbnail, linkable only from their product', async () => {
  const store = createAccessStore(':memory:');
  const audits = [];
  const pool = { query: async (sql, params) => ({ rows: params[0] === 'MISSING' ? [] : [{ '?column?': 1 }] }) };
  let auth = { id: 7, role: 'sales', permissions: ['consignment'] };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.auth = auth; next(); });
  installProductImages(app, store, { record: (...args) => audits.push(args) }, pool);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const webp = size => { const b = Buffer.alloc(size); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); return b; };
  const thumb = webp(40), main = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(97)]);
  const upload = (code, body, thumbBytes = thumb.length, headers = { 'X-PRPlus-Request': '1' }) => fetch(`${base}/api/products/images/files?code=${encodeURIComponent(code)}`,
    { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Thumb-Bytes': String(thumbBytes), ...headers }, body });
  const put = body => fetch(`${base}/api/products/images`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-PRPlus-Request': '1' }, body: JSON.stringify(body) });
  try {
    assert.equal((await upload('P1', Buffer.concat([thumb, main]))).status, 403, 'no product_images permission');
    auth = { id: 1, role: 'admin', permissions: ['consignment', 'product_images'] };
    assert.equal((await upload('P1', Buffer.concat([thumb, main]), thumb.length, {})).status, 403, 'missing same-site header');
    assert.equal((await upload('P1', Buffer.concat([thumb, Buffer.from('<svg onload=alert(1)></svg>')]))).status, 415, 'not an image');
    assert.equal((await upload('P1', Buffer.concat([thumb, main]), 0)).status, 400, 'no thumbnail split');
    assert.equal((await upload('MISSING', Buffer.concat([thumb, main]))).status, 404);
    let response = await upload('P1', Buffer.concat([thumb, main]));
    assert.equal(response.status, 201);
    const { link } = await response.json();
    assert.match(link, /^\/api\/products\/images\/files\/[a-f0-9]{32}$/);
    response = await fetch(base + link);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), main);
    response = await fetch(base + link + '?size=thumb');
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal((await fetch(`${base}/api/products/images/files/${'0'.repeat(32)}`)).status, 404);
    assert.equal((await put({ code: 'P2', links: [link] })).status, 400, 'a photo of P1 cannot be linked from P2');
    response = await put({ code: 'P1', links: [link, `https://drive.google.com/file/d/${ID}/view`] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).links, [link, view]);
    // Removing it from the list prunes the stored file once the grace window has passed.
    store.run("UPDATE product_image_files SET created_at='2000-01-01T00:00:00.000Z'");
    assert.equal((await put({ code: 'P1', links: [view] })).status, 200);
    assert.equal(store.get('SELECT COUNT(*) AS n FROM product_image_files').n, 0);
    assert.deepEqual(audits.map(entry => entry[1]), ['product_images.upload', 'product_images.set', 'product_images.set']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});

test('consignment codes borrow photos of the same model only when the SML names agree', async () => {
  const store = createAccessStore(':memory:');
  const names = {
    'ฝกต042LCD22': 'ขาแขวนจอ LCD 20"-45" ติดผนัง BEST LCD-22 (@5)', '907LCD22': 'ขาแขวนจอ LCD 20"-55" ติดผนัง BEST LCD-22 (@5)',
    'ฝบอ047CT4': 'สายรัดพลาสติก 4" สีขาว  (@700)', '903CT4': 'มิกเซอร์ 4CH 16DSP บลูทูธ PRO PLUS CT-4 (@3)',
    'ฝหย039C03': 'ปลั๊ก C03', '905C03': 'ปลั๊ก C03', '949C03': 'ปลั๊ก C03',
    'ฝหย039OWN1': 'ของตัวเอง', '901OWN1': 'ของตัวเอง',
  };
  const queries = [];
  let failing = false;
  const pool = { query: async (sql, params) => { queries.push([sql, params]); if (failing) throw Object.assign(new Error('down'), { code: 'X' }); return { rows: params[0].filter(c => names[c]).map(code => ({ code, name_1: names[code] })) }; } };
  for (const code of ['907LCD22', '903CT4', '905C03', '949C03', '901OWN1', 'ฝหย039OWN1'])
    store.run('INSERT INTO product_images(code,links_json,updated_at) VALUES(?,?,?)', code, JSON.stringify([`https://cdn.example.com/${code}.jpg`]), 'x');
  const app = express();
  app.use((req, res, next) => { req.auth = { id: 1, role: 'sales', permissions: ['consignment'] }; next(); });
  installProductImages(app, store, { record() {} }, pool);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = async codes => (await fetch(`http://127.0.0.1:${server.address().port}/api/products/images?` + codes.map(c => 'code=' + encodeURIComponent(c)).join('&'))).json();
  try {
    const data = await get(['ฝกต042LCD22', 'ฝบอ047CT4', 'ฝหย039C03', 'ฝหย039OWN1', 'P1']);
    assert.deepEqual(data.borrowed, { 'ฝกต042LCD22': { from: '907LCD22', links: ['https://cdn.example.com/907LCD22.jpg'] } }, 'CT4 names differ; C03 has two equal candidates');
    assert.deepEqual(data.images, { 'ฝหย039OWN1': ['https://cdn.example.com/ฝหย039OWN1.jpg'] }, 'own photos win and are not replaced');
    assert.ok(queries.every(([sql]) => sql === 'SELECT code, name_1 FROM ic_inventory WHERE code = ANY($1::text[])'));
    failing = true;
    const offline = await get(['ฝกต042LCD22']);
    assert.equal(offline.borrowed, undefined, 'SML down: no borrowed photos, request still succeeds');
    assert.ok(nameSimilarity(names['ฝบอ047CT4'], names['903CT4']) < MIN_NAME_SIMILARITY);
    assert.ok(nameSimilarity(names['ฝกต042LCD22'], names['907LCD22']) >= MIN_NAME_SIMILARITY);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
