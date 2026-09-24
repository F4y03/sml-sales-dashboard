import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAccessStore } from './src/models/accessStore.js';
import { installProductImages, normalizeImageLink, cleanLinks } from './product-images.js';

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
