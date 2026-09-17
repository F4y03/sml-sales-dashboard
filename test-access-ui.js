import { chromium } from '@playwright/test';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { installAuth,hashPassword } from './auth.js';
import { createAccessStore } from './src/models/accessStore.js';
import { installAccess } from './src/middleware/access.js';
import { installAdminRoutes } from './src/routes/adminRoutes.js';
import { createUserService } from './src/services/userService.js';
import { loadUser } from './src/services/permissionService.js';
mkdirSync('test-results',{recursive:true});
const store=createAccessStore(':memory:',{AUTH_USERNAME:'ui-admin',AUTH_PASSWORD_HASH:await hashPassword('ui-fixture-password')});
const app=express();app.use(express.json());const auth=installAuth(app,{AUTH_COOKIE_SECURE:'false'},store);installAccess(app);installAdminRoutes(app,store,auth.audit,'test-results/ui-env');
app.get('/api/connection-status',(req,res)=>res.json({connected:true}));
app.get('/api/products',(req,res)=>res.json({rows:[],fields:[],groups:[],total:0,matching:0,activeCount:0,inactiveCount:0,page:0,pageSize:50}));
app.get('/api/customer-insights',(req,res)=>res.json({customers:[]}));app.get('/api/customer-insights/non-buyers',(req,res)=>res.json({customers:[]}));app.get('/api/customer-insights/catalog',(req,res)=>res.json({products:[]}));
app.get('/api/executive',(req,res)=>res.json({net:0,sales:0,returns:0,previousNet:0,yearNet:0,count:0,salesInvoiceCount:0,products:[],branches:[],declines:[],staff:[],bills:[],unusual:[]}));
app.use(express.static('public'));
const users=createUserService(store,auth.audit);await users.save(loadUser(store,1),null,{username:'ui-sales',full_name:'Sales ทดสอบ',role:'sales',is_active:true,password:'ui-fixture-password',territoryIds:[1,2],additionalPermissions:[]});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
  async function login(username){await page.goto(base+'/login.html');await page.locator('#username').fill(username);await page.locator('#password').fill('ui-fixture-password');await page.locator('#submit').click();await page.waitForURL(url=>!url.pathname.includes('login'));}
  await login('ui-admin');await page.goto(base+'/system-admin.html');await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'Users',exact:true}).click();await page.getByRole('button',{name:'+ เพิ่มผู้ใช้'}).click();
  await page.locator('[name=full_name]').fill('ผู้ใช้ทดสอบ');await page.locator('[name=username]').fill('ui-new');await page.locator('[name=password]').fill('x');await page.locator('[name=role]').selectOption('sales');await page.getByLabel('ภาคกลาง',{exact:true}).check();await page.getByRole('button',{name:'บันทึกผู้ใช้',exact:true}).click();await page.getByRole('cell',{name:'ผู้ใช้ทดสอบ / ui-new',exact:true}).waitFor();
  await page.screenshot({path:'test-results/access-users-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Sales Territories',exact:true}).click();await page.getByRole('button',{name:'+ เพิ่มเขต'}).click();await page.locator('[name=code]').fill('TEST');await page.locator('[name=name]').fill('เขตทดสอบ');await page.locator('[name=teams]').fill('กจ');await page.locator('[name=consignmentPrefixes]').fill('ฝกจ');await page.getByRole('button',{name:'บันทึกเขต',exact:true}).click();await page.getByRole('cell',{name:'TEST',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/access-territories-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'☰ เมนู Workspace'}).click();await page.getByRole('button',{name:'ออกจากระบบ ↗'}).click();await page.waitForURL('**/login.html');
  await login('ui-sales');await page.waitForURL('**/select-territory.html');await page.waitForLoadState('networkidle');await page.getByRole('button',{name:'ภาคเหนือ',exact:true}).click();await page.waitForURL('**/customers.html');await page.waitForLoadState('networkidle');
  assert.equal(await page.getByLabel('เขตปัจจุบัน').inputValue(),'2');assert.equal(await page.locator('a[href="/system-admin.html"]').count(),0);assert.equal((await page.request.get(base+'/api/admin/users')).status(),403);
  await page.getByLabel('เขตปัจจุบัน').selectOption('1');await page.waitForLoadState('networkidle');await page.waitForFunction(()=>document.querySelector('[aria-label="เขตปัจจุบัน"]')?.value==='1');
  await page.screenshot({path:'test-results/access-sales-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('Access UI passed: create user, assign territory, create territory, mobile layout, Sales selection/switch, backend denial and no JS errors.');
} finally {await browser?.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});auth.close();store.close();}
