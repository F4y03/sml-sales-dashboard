import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installProductPerformance, previousPeriod } from './product-performance.js';

async function listen(app) {
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}
test('equal-length comparison handles leap days and year boundaries',()=>{
  assert.deepEqual(previousPeriod('2026-09-01','2026-09-09'),{start:'2026-08-23',end:'2026-08-31',days:9});
  assert.deepEqual(previousPeriod('2024-03-01','2024-03-31'),{start:'2024-01-30',end:'2024-02-29',days:31});
  assert.deepEqual(previousPeriod('2026-01-01','2026-01-01'),{start:'2025-12-31',end:'2025-12-31',days:1});
});
test('product API validates dates, binds exact SKU and previous dates, and returns JSON errors',async()=>{
  const app=express(),calls=[];let fail=false,missing=false;
  installProductPerformance(app,{query:async(sql,params)=>{
    calls.push(params);if(fail)throw Object.assign(new Error('private details'),{code:'TEST_OFFLINE'});
    return {rows:[{insights:params[4]===null?{products:[]}:{product:missing?null:{code:params[4]},buyers:[]}}]};
  }});
  const {server,base}=await listen(app);
  try{
    for(const path of ['catalog','product-buyers'])for(const query of ['', '?start=2026-02-30&end=2026-03-01','?start=2026-09-09&end=2026-09-01','?start=2025-01-01&end=2026-09-09','?start=2026-09-01&start=2026-09-02&end=2026-09-09']) {
      assert.equal((await fetch(`${base}/api/customer-insights/${path}${query}`)).status,400);
    }
    const period='start=2026-09-01&end=2026-09-09';
    for(const code of ['', '&code=', '&code=A&code=B', `&code=${'x'.repeat(201)}`])assert.equal((await fetch(`${base}/api/customer-insights/product-buyers?${period}${code}`)).status,400);
    assert.equal(calls.length,0);
    const response=await fetch(`${base}/api/customer-insights/catalog?${period}`);
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual((await response.json()).previous,{start:'2026-08-23',end:'2026-08-31',days:9});
    assert.deepEqual(calls[0],['2026-09-01','2026-09-09','2026-08-23','2026-08-31',null]);
    const code="สินค้า/&' OR 1=1 --";
    const detail=await fetch(`${base}/api/customer-insights/product-buyers?${period}&${new URLSearchParams({code})}`);
    assert.equal((await detail.json()).product.code,code);assert.equal(calls.at(-1)[4],code);
    missing=true;assert.equal((await fetch(`${base}/api/customer-insights/product-buyers?${period}&code=missing`)).status,404);
    fail=true;const error=await fetch(`${base}/api/customer-insights/catalog?${period}`);
    assert.equal(error.status,503);assert.ok(!(await error.text()).includes('private details'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('product view: search, rankings, no-sales, quantities, buyers popup, filters, errors, races and mobile',async()=>{
  const app=express();app.use(express.static('public'));const {server,base}=await listen(app);let browser;
  try{
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    const products=Array.from({length:18},(_,index)=>({code:`SKU${String(index+1).padStart(3,'0')}`,name:['ลำโพงแอคทีฟ','ไมโครโฟนไร้สาย','ดิจิทัลมิกเซอร์'][index%3]+` รุ่น ${index+1}`,categoryCode:index%2?'G2':'G1',category:index%2?'ไมโครโฟน':'ระบบเสียง',registered:true,stock:25-index,stockUnit:'ชิ้น',net:1800-index*100,previousNet:index%2?0:(1800-index*100)*2,sales:1900-index*100,added:0,returns:100,invoiceCount:12,buyerCount:12,lastSold:'2026-09-09',quantities:[{unit:'ชิ้น',net:10,sold:12,added:0,returned:2},{unit:'กล่อง',net:1,sold:1,added:0,returned:0}]}));
    products.push(...[
      {code:'N1',name:'สินค้าไม่มีบิลขาย',net:0,previousNet:400,invoiceCount:0,stock:200,quantities:[]},
      {code:'N2',name:'<img src=x onerror=alert(1)>',net:0,previousNet:0,invoiceCount:0,stock:10,quantities:[]},
      {code:'ZERO',name:'รายการศูนย์บาท',net:0,previousNet:0,invoiceCount:1,stock:0},
      {code:'NEG',name:'ขายแล้วรับคืน',net:-100,previousNet:100,invoiceCount:2,stock:1},
      {code:'RETURN',name:'มีแต่รับคืน',net:-50,previousNet:100,invoiceCount:0,stock:5}
    ].map(item=>({...products[0],sales:0,returns:0,buyerCount:item.invoiceCount?1:0,lastSold:item.invoiceCount?'2026-09-09':null,...item})));
    const meta=url=>({start:url.searchParams.get('start'),end:url.searchParams.get('end'),previous:previousPeriod(url.searchParams.get('start'),url.searchParams.get('end')),updatedAt:'2026-09-09T08:00:00Z'});
    let fail=false,failBuyers=false,heldCode=null,heldRoute;
    await page.route('**/api/customer-insights**',async route=>{
      const url=new URL(route.request().url());requests.push(url);
      if(url.pathname.endsWith('/catalog'))return route.fulfill({status:fail?503:200,json:fail?{error:'ทดสอบโหลดสินค้าไม่สำเร็จ'}:{products,...meta(url)}});
      if(url.pathname.endsWith('/product-buyers')){
        const product=products.find(item=>item.code===url.searchParams.get('code'));
        if(heldCode===product.code){heldRoute=route;return;}
        const buyers=product.invoiceCount?Array.from({length:12},(_,index)=>({code:`C${index}`,name:index===1?'<svg onload=alert(1)>':`ร้านเครื่องเสียง ${index+1}`,net:product.net/12,invoiceCount:1,lastSold:'2026-09-09',quantities:product.quantities})):[];
        return route.fulfill({status:failBuyers?503:200,json:failBuyers?{error:'ทดสอบผู้ซื้อไม่พร้อม'}:{product,buyers,...meta(url)}});
      }
      return route.fulfill({json:{customers:[{code:'C1',name:'ลูกค้าทดสอบ',invoiceCount:1,net:100}],updatedAt:'2026-09-09T08:00:00Z'}});
    });
    await page.goto(`${base}/customers.html`);await expect(page.locator('#customer-dashboard')).toBeVisible();
    assert.ok(!requests.some(url=>url.pathname.endsWith('/catalog')));
    await page.locator('#products-view-button').click();await expect(page.locator('#performance-dashboard')).toBeVisible();
    await expect(page.locator('#customer-dashboard')).toBeHidden();await expect(page.locator('#customer-search')).toBeHidden();
    await expect(page.locator('#performance-search')).toBeVisible();
    assert.equal(await page.locator('#performance-best button').count(),5);assert.equal(await page.locator('#performance-watch button').count(),5);
    await expect(page.locator('#performance-best .leader-chart-fill')).toHaveCount(5);
    await expect(page.locator('#performance-watch .leader-chart-fill.is-previous')).toHaveCount(5);
    await expect(page.locator('#performance-watch .leader-chart-fill.is-current')).toHaveCount(5);
    const bestWidths = await page.locator('#performance-best .leader-chart-fill').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.width)));
    const watchWidths = await page.locator('#performance-watch .leader-chart-fill.is-previous').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.width)));
    const currentWidths = await page.locator('#performance-watch .leader-chart-fill.is-current').evaluateAll(bars => bars.map(bar => parseFloat(bar.style.width)));
    assert.equal(bestWidths[0],100); assert.ok(Math.abs(bestWidths[1]-1700/1800*100)<0.001);
    assert.equal(watchWidths[0],100); assert.ok(Math.abs(watchWidths[1]-1600/1800*100)<0.001);
    assert.equal(currentWidths[0],50);
    await expect(page.locator('#performance-watch .leader-chart-series').first()).toContainText('ช่วงก่อน฿3,600.00');
    await mkdir('test-results',{recursive:true});
    await page.locator('.performance-highlights').screenshot({path:'test-results/product-leader-charts.png'});
    assert.equal(await page.locator('#performance-rows tr').count(),10);
    await expect(page.locator('#performance-unsold')).toHaveText('3');
    await expect(page.locator('#performance-sold')).toHaveText('20');
    await page.locator('#performance-next').click();assert.equal(await page.locator('#performance-rows tr').count(),10);
    await page.locator('#performance-search').fill('sku002');
    assert.equal(await page.locator('#performance-rows button').count(),1);await expect(page.locator('#performance-net')).toHaveText('฿1,700.00');
    await expect(page.locator('#performance-rows')).toContainText('ไม่มีฐานบวกให้เทียบ');
    await page.locator('#performance-search').fill('ไม่มีบิลขาย');await expect(page.locator('#performance-unsold')).toHaveText('1');
    await expect(page.locator('#performance-watch .is-current')).toHaveCSS('width','0px');
    await expect(page.locator('#performance-watch .leader-chart-series').last()).toContainText('ช่วงนี้฿0.00');
    await page.locator('#performance-search').fill('NEG');
    await expect(page.locator('#performance-net')).toHaveText('฿-100.00');
    const negativeBar = await page.locator('#performance-watch .is-negative').evaluate(bar => ({left:bar.style.left,width:bar.style.width}));
    assert.deepEqual(negativeBar,{left:'0%',width:'50%'});
    await expect(page.locator('#performance-watch .leader-chart-series').last()).toContainText('ช่วงนี้฿-100.00');
    await page.locator('#performance-search').fill('%');await expect(page.locator('#performance-rows')).toContainText('ไม่พบสินค้า');
    await page.locator('#performance-search').fill('');
    await page.locator('#performance-category').selectOption('G2');assert.ok((await page.locator('#performance-rows').textContent()).includes('ไมโครโฟน'));
    await page.locator('#performance-category').selectOption('*');
    await page.locator('.performance-filters [data-performance-filter="slow"]').click();
    await expect(page.locator('#performance-rows button').first()).toHaveAttribute('data-sku','SKU018');assert.equal(await page.locator('#performance-rows tr').count(),10);
    await page.locator('.performance-filters [data-performance-filter="nonpositive"]').click();assert.equal(await page.locator('#performance-rows tr').count(),2);
    await page.locator('.performance-filters [data-performance-filter="unsold"]').click();assert.equal(await page.locator('#performance-rows tr').count(),3);
    await expect(page.locator('#performance-rows button').first()).toHaveAttribute('data-sku','N1');
    assert.equal(await page.locator('#performance-rows img').count(),0);
    await page.locator('#performance-rows button').first().click();await expect(page.locator('#sku-content')).toBeVisible();
    await expect(page.locator('#sku-buyers')).toContainText('ยังไม่มีลูกค้า');await expect(page.locator('#sku-quantities')).toContainText('ไม่มีรายการ');
    await page.keyboard.press('Escape');await expect(page.locator('#sku-detail')).toBeHidden();await expect(page.locator('#performance-rows button').first()).toBeFocused();
    await page.locator('.performance-filters [data-performance-filter="all"]').click();
    await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/product-performance-desktop.png',fullPage:true});
    for(const width of [390,768,1440]){await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    await page.locator('#performance-best button').first().click();await expect(page.locator('#sku-content')).toBeVisible();
    await expect(page.locator('#sku-quantities')).toContainText('กล่อง');await expect(page.locator('#sku-quantities')).toContainText('ชิ้น');
    assert.equal(await page.locator('#sku-buyers tr').count(),10);assert.equal(await page.locator('#sku-buyers svg').count(),0);
    await page.locator('#sku-next').click();assert.equal(await page.locator('#sku-buyers tr').count(),2);await expect(page.locator('#sku-next')).toBeDisabled();
    await page.screenshot({path:'test-results/product-buyers-desktop.png'});
    await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('#sku-detail').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth));
    await page.screenshot({path:'test-results/product-buyers-mobile.png'});
    await page.locator('#sku-close').click();await expect(page.locator('#sku-detail')).toBeHidden();
    await page.setViewportSize({width:1440,height:950});
    heldCode='SKU001';await page.locator('#performance-best button').first().click();await expect(page.locator('#sku-detail')).toHaveAttribute('aria-busy','true');
    await expect.poll(()=>Boolean(heldRoute)).toBe(true);
    await page.keyboard.press('Escape');await page.locator('#performance-best button').nth(1).click();await expect(page.locator('#sku-content')).toBeVisible();
    await heldRoute.fulfill({json:{product:products[0],buyers:[],...meta(requests.at(-1))}}).catch(()=>{});heldCode=null;
    await expect(page.locator('#sku-title')).toHaveText(products[1].name);await page.keyboard.press('Escape');
    failBuyers=true;await page.locator('#performance-best button').first().click();await expect(page.locator('#sku-retry')).toBeVisible();await expect(page.locator('#sku-content')).toBeHidden();
    failBuyers=false;await page.locator('#sku-retry').click();await expect(page.locator('#sku-content')).toBeVisible();await page.keyboard.press('Escape');
    await page.locator('#start').fill('2026-08-01');await page.locator('#end').fill('2026-08-31');await expect(page.locator('#performance-dashboard')).toBeVisible();
    await expect.poll(()=>requests.at(-1).searchParams.get('end')).toBe('2026-08-31');
    await page.locator('#performance-best button').first().click();await expect(page.locator('#sku-content')).toBeVisible();assert.equal(requests.at(-1).searchParams.get('start'),'2026-08-01');await page.keyboard.press('Escape');
    await page.locator('#end').fill('2026-07-01');await expect(page.locator('#performance-dashboard')).toBeHidden();
    await page.locator('#end').fill('2026-08-31');await expect(page.locator('#performance-dashboard')).toBeVisible();
    fail=true;await page.locator('#refresh').click();await expect(page.locator('#performance-status')).toHaveText('ทดสอบโหลดสินค้าไม่สำเร็จ');await expect(page.locator('#performance-dashboard')).toBeHidden();
    fail=false;await page.locator('#refresh').click();await expect(page.locator('#performance-dashboard')).toBeVisible();
    await page.locator('#customers-view-button').click();await expect(page.locator('#customer-dashboard')).toBeVisible();await expect(page.locator('#product-view')).toBeHidden();await expect(page.locator('#customer-search')).toBeVisible();
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
