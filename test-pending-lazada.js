import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAccessStore } from './src/models/accessStore.js';
import { installProductImages } from './product-images.js';

test('unmatched references stay separate, private, and visible even when no imported SML codes remain', async () => {
  const store = createAccessStore();
  const app = express();
  let role = 'sales', registered = false;
  app.use((req,res,next) => { req.auth = { role, permissions: [] }; next(); });
  installProductImages(app,store,{}, { query: async (sql,params) => {
    assert.match(sql, /^SELECT/); assert.deepEqual(params, [['P1']]);
    return {rows: registered ? [{code:'P1'}] : []};
  }});
  store.run('INSERT INTO unmatched_product_images VALUES(?,?,?,?,?,?)','https://www.lazada.co.th/products/pdp-i1.html','1','Lazada item','["https://example.com/a.jpg"]','[]','today');
  store.run('INSERT INTO product_images VALUES(?,?,?,?)','P1','[]',null,'today');
  store.run('INSERT INTO product_image_imports VALUES(?,?,?,?,?)','P1','Known code','Excel',7,'today');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/products/images/pending`;
  try {
    for (role of ['sales','admin','executive']) assert.equal((await fetch(url)).status,403);
    role='super_admin';
    let data=await (await fetch(url)).json(); assert.equal(data.products.length,2);
    assert.equal(data.products[1].code,null); assert.equal(data.products[1].status,'unmatched');
    registered=true; data=await (await fetch(url)).json(); assert.equal(data.products.length,1);
    assert.equal(data.products[0].reference,'Lazada 1');
    assert.equal(store.get('SELECT count(*) AS n FROM product_images').n,1);
  } finally { await new Promise(resolve=>server.close(resolve)); store.close(); }
});
