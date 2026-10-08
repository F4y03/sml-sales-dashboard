import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAccessStore } from './src/models/accessStore.js';
import { installProductImages } from './product-images.js';
test('super admin can match pending image rows to an SML code without writing SML', async () => {
  const store = createAccessStore();
  const app = express();
  app.use(express.json());
  let role = 'super_admin';
  const audits = [];
  app.use((req,res,next) => { req.auth = { id: 1, role, permissions: [] }; next(); });
  installProductImages(app, store, { record: (...args) => audits.push(args) }, { query: async (sql,params) => {
    assert.match(sql, /^SELECT/);
    return { rows: ['SML1','SML2','TAKEN'].includes(params[0]) ? [{ code: params[0] }] : [] };
  }});
  store.run('INSERT INTO product_images VALUES(?,?,?,?)','OLD1','["https://example.com/a.jpg","https://example.com/b.jpg"]',null,'today');
  store.run('INSERT INTO product_image_imports VALUES(?,?,?,?,?)','OLD1','Imported','Excel',35,'today');
  store.run('INSERT INTO product_images VALUES(?,?,?,?)','TAKEN','["https://example.com/t.jpg"]',null,'today');
  store.run('INSERT INTO unmatched_product_images VALUES(?,?,?,?,?,?)','https://www.lazada.co.th/products/pdp-i9.html','9','Lazada item','["https://example.com/l.jpg"]','[]','today');
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/products/images/pending/match`;
  const post = (body, headers = { 'X-PRPlus-Request': '1' }) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ code: 'OLD1', smlCode: 'SML1' }, {})).status, 403);
    role = 'admin'; assert.equal((await post({ code: 'OLD1', smlCode: 'SML1' })).status, 403); role = 'super_admin';
    assert.equal((await post({ code: 'OLD1', smlCode: 'NOPE' })).status, 404);
    assert.equal((await post({ code: 'OLD1', smlCode: 'TAKEN' })).status, 409);
    assert.equal((await post({ code: 'OLD1', sourceUrl: 'x', smlCode: 'SML1' })).status, 400);
    let res = await post({ code: 'OLD1', smlCode: 'SML1' });
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { code: 'SML1', count: 2 });
    assert.equal(store.get('SELECT count(*) AS n FROM product_images WHERE code=?','OLD1').n, 0);
    assert.equal(JSON.parse(store.get('SELECT links_json FROM product_images WHERE code=?','SML1').links_json).length, 2);
    assert.equal(store.get('SELECT source_row FROM product_image_imports WHERE code=?','SML1').source_row, 35);
    res = await post({ sourceUrl: 'https://www.lazada.co.th/products/pdp-i9.html', smlCode: 'SML2' });
    assert.equal(res.status, 200);
    assert.equal(store.get('SELECT count(*) AS n FROM unmatched_product_images').n, 0);
    assert.equal(store.get('SELECT links_json FROM product_images WHERE code=?','SML2').links_json, '["https://example.com/l.jpg"]');
    assert.equal((await post({ code: 'OLD1', smlCode: 'SML2' })).status, 404);
    assert.equal(audits.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
