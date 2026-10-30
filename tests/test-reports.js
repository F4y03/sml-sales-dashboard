import assert from 'node:assert/strict';
import { compileQuery, validateValues } from './reports.js';
import { chromium } from '@playwright/test';
const base=process.env.TEST_URL || 'http://localhost:3002';
const conditions=[{name:'from_date',type:'Date',label:'start'},{name:'item',type:'Text',column:'item_code',label:'item'}];
const values=validateValues({conditions},{from_date:'2026-09-07',item:'901:905,907'});
const q=compileQuery("select * from ic_trans_detail where doc_date='@from_date@' @and_item@",conditions,values);
assert.ok(!q.text.includes('901'));assert.deepEqual(q.values,['2026-09-07','901','905','907']);
assert.throws(()=>validateValues({conditions},{from_date:'2026-02-30',item:''}));
assert.throws(()=>validateValues({conditions},{from_date:'2026-09-07',item:"x');DELETE FROM ic_trans;--"}));
assert.throws(()=>compileQuery('select 1; delete from ic_trans',[],{}));
assert.throws(()=>compileQuery('with t as (delete from ic_trans returning *) select * from t',[],{}));
assert.throws(()=>compileQuery('select @unknown@',[],{}));
const list=await(await fetch(base+'/api/reports')).json();assert.ok(list.reports.length>=569);
for(const id of ['4007','4014','2017','1002']){
  const r=list.reports.find(r=>r.id===id);const d=await(await fetch(base+'/api/reports/'+r.key)).json();
  const filters=Object.fromEntries(d.conditions.map(c=>[c.name,c.type==='Date'?'2026-09-07':c.type==='Number'?'0':c.options?.[0]?.value??c.default??'']));
  const response=await fetch(base+'/api/reports/'+r.key+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters,pageSize:5})});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.ok(data.fields.length);assert.ok(data.rows.length<=5);
  if(id==='4007'){assert.equal(data.rows[0][0],'2026-09-07');}
  if(id==='2017'){
    const filtered=await fetch(base+'/api/reports/'+r.key+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{...filters,ic_code_list:'901AL415',wh_code_list:'CENTER'},pageSize:5})});
    const body=await filtered.json();assert.equal(filtered.status,200,JSON.stringify(body));assert.ok(body.rows.length);assert.ok(body.rows.every(row=>row[0]==='CENTER'&&row[5]==='901AL415'));
    const next=await(await fetch(base+'/api/reports/'+r.key+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters,page:1,pageSize:5})})).json();assert.equal(next.page,1);assert.ok(next.rows.length);
  }
}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.goto(base+'/reports.html',{waitUntil:'domcontentloaded'});await page.locator('#report-list button').first().waitFor();
  await page.fill('#report-search','4007');await page.locator('#report-list button').first().click();
  await page.locator('#report-form').waitFor({state:'visible'});await page.fill('#single-day','2026-09-07');await page.click('#apply-single');
  assert.equal(await page.locator('[name=from_date]').inputValue(),'2026-09-07');assert.equal(await page.locator('[name=to_date]').inputValue(),'2026-09-07');
  await page.click('#run-report');await page.locator('#result-card').waitFor({state:'visible'});
  assert.ok((await page.locator('#result-body').innerText()).includes('2026-09-07'));
  const downloadPromise=page.waitForEvent('download');await page.click('#csv-report');assert.ok((await downloadPromise).suggestedFilename().includes('4007'));
  await page.screenshot({path:'reports-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'reports-mobile.png',fullPage:true});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});await page.click('#day-yesterday');assert.equal(await page.locator('#start').inputValue(),await page.locator('#end').inputValue());
  assert.deepEqual(errors,[]);console.log('PASS: SQL parameter handling, invalid dates, write rejection, 4 live reports, single-day UI, CSV, mobile and dashboard day filter.');
}finally{await browser.close();}
