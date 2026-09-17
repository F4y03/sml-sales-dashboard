import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync,writeFileSync,readFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { installAuth,hashPassword } from './auth.js';
import { createAccessStore } from './src/models/accessStore.js';
import { installAccess } from './src/middleware/access.js';
import { installAdminRoutes } from './src/routes/adminRoutes.js';
import { createUserService } from './src/services/userService.js';
import { loadUser } from './src/services/permissionService.js';
import { scopeQuery,accessContext,createScopedPool } from './src/services/territoryService.js';

async function fixture(t){
  mkdirSync('test-results',{recursive:true});const dir=mkdtempSync(resolve('test-results/access-'));const envPath=resolve(dir,'.env');writeFileSync(envPath,'PGHOST=localhost\nPGPORT=5432\nSESSION_SECRET=fixture-only-do-not-return\n');
  const env={AUTH_USERNAME:'root',AUTH_PASSWORD_HASH:await hashPassword('fixture-password-123'),AUTH_COOKIE_SECURE:'false'};
  const store=createAccessStore(':memory:',env),app=express();app.use(express.json());const auth=installAuth(app,env,store);installAccess(app);installAdminRoutes(app,store,auth.audit,envPath);
  for(const path of ['/api/dashboard','/api/products','/api/products/export','/api/customer-insights','/api/customer-insights/catalog','/api/consignment','/api/reports','/api/new-module'])app.get(path,(req,res)=>res.json({ok:true,territory:accessContext.getStore()?.territory?.id??null}));
  for(const path of ['/','/products.html','/index.html','/customers.html','/executive.html','/system-admin.html','/select-territory.html','/login.html','/unregistered.html'])app.get(path,(req,res)=>res.send('page'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});auth.close();store.close();});
  const request=(path,cookie='',method='GET',body,headers={})=>fetch(base+path,{redirect:'manual',method,headers:{cookie,'Content-Type':'application/json','X-PRPlus-Request':'1',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const login=async username=>{const r=await request('/api/auth/login','','POST',{username,password:'fixture-password-123'});return {r,cookie:r.headers.get('set-cookie')?.split(';')[0]||'',data:await r.json()};};
  const root=loadUser(store,1),users=createUserService(store,auth.audit);
  const create=(username,role,territoryIds=[],additionalPermissions=[])=>users.save(root,null,{username,full_name:username,role,is_active:true,password:'fixture-password-123',territoryIds,additionalPermissions},'test');
  return {store,request,login,create,users,root,envPath};
}
test('short passwords work for creation, login and reset; empty is rejected or preserves an edited password',async t=>{
  const f=await fixture(t),root=await f.login('root');
  const body={username:'short-password-user',full_name:'Test',role:'admin',is_active:true,password:'x',additionalPermissions:[],territoryIds:[]};
  assert.equal((await f.request('/api/admin/users',root.cookie,'POST',{...body,password:''})).status,400);
  const created=await f.request('/api/admin/users',root.cookie,'POST',body);assert.equal(created.status,201);const user=await created.json();
  const login=password=>f.request('/api/auth/login','','POST',{username:body.username,password});
  assert.equal((await login('x')).status,200);
  assert.equal((await f.request('/api/admin/users/'+user.id,root.cookie,'PUT',{...body,password:''})).status,200);
  assert.equal((await login('x')).status,200);
  assert.equal((await f.request('/api/admin/users/'+user.id,root.cookie,'PUT',{...body,password:'y',currentPassword:'wrong'})).status,400);
  assert.equal((await f.request('/api/admin/users/'+user.id,root.cookie,'PUT',{...body,password:'y',currentPassword:'x'})).status,200);
  assert.equal((await login('y')).status,200);assert.equal((await login('x')).status,401);
  assert.equal((await f.request('/api/admin/users/'+user.id+'/password',root.cookie,'POST',{password:'ก',currentPassword:'wrong'})).status,400);
  assert.equal((await f.request('/api/admin/users/'+user.id+'/password',root.cookie,'POST',{password:'ก',currentPassword:'y'})).status,200);
  assert.equal((await login('ก')).status,200);assert.equal((await login('y')).status,401);
  assert.equal((await f.request('/api/admin/users/'+user.id+'/password',root.cookie,'POST',{password:'ก'.repeat(25),currentPassword:'ก'})).status,400);
});

test('all four roles enforce pages/APIs; unknown routes and encoded URLs fail closed',async t=>{
  const f=await fixture(t);await f.create('boss','executive');await f.create('office','admin');await f.create('rep','sales',[1]);
  const matrix={root:[200,200,200,200,200],boss:[200,200,200,200,403],office:[403,200,403,403,403],rep:[403,200,200,403,403]};
  for(const [user,statuses] of Object.entries(matrix)){const {cookie,r}=await f.login(user);assert.equal(r.status,200);for(const [i,path] of ['/api/dashboard','/api/products','/api/customer-insights','/api/reports','/system-admin.html'].entries())assert.equal((await f.request(path,cookie)).status,statuses[i],user+' '+path);assert.equal((await f.request('/api/products/export',cookie)).status,user==='root'?200:403,user+' product export');assert.equal((await f.request('/api/new-module',cookie)).status,403);assert.equal((await f.request('/unregistered.html',cookie)).status,403);}
  const {cookie}=await f.login('office');assert.equal((await f.request('/%65xecutive.html',cookie)).status,403);assert.equal((await f.request('/api/customer-insights/catalog',cookie)).status,403);assert.equal((await f.request('/login.html')).status,200);
});
test('territory zero/one/multiple selection; forged IDs; assignment removal and disabled territories',async t=>{
  const f=await fixture(t);const rep=await f.create('rep','sales');let s=await f.login('rep');assert.equal(s.data.redirect,'/select-territory.html');assert.equal((await f.request('/api/products',s.cookie)).status,403);
  await f.users.save(f.root,rep.id,{...rep,territoryIds:[1,2],password:undefined},'test');s=await f.login('rep');assert.equal(s.data.redirect,'/select-territory.html');
  assert.equal((await f.request('/api/auth/territory',s.cookie,'POST',{territoryId:3})).status,403);
  assert.equal((await f.request('/api/auth/territory',s.cookie,'POST',{territoryId:'1 OR 1=1'})).status,400);
  assert.equal((await f.request('/api/auth/territory',s.cookie,'POST',{territoryId:1})).status,200);
  assert.equal((await (await f.request('/api/customer-insights?territoryId=3',s.cookie)).json()).territory,1);
  f.store.run('DELETE FROM user_territories WHERE user_id=? AND territory_id=1',rep.id);
  assert.equal((await (await f.request('/api/customer-insights',s.cookie)).json()).territory,2);
  f.store.run('UPDATE sales_territories SET is_active=0 WHERE id=2');assert.equal((await f.request('/api/customer-insights',s.cookie)).status,403);
});
test('per-user grants, session invalidation, disabled login and last Super Admin protection',async t=>{
  const f=await fixture(t),a=await f.create('a','admin'),b=await f.create('b','admin');const old=await f.login('a');
  await f.users.save(f.root,a.id,{...a,additionalPermissions:['customer_analysis']},'test');assert.equal((await f.request('/api/products',old.cookie)).status,401);
  const fresh=await f.login('a'),other=await f.login('b');assert.equal((await f.request('/api/customer-insights',fresh.cookie)).status,200);assert.equal((await f.request('/api/customer-insights',other.cookie)).status,403);
  await f.users.save(f.root,b.id,{...b,is_active:false},'test');assert.equal((await f.login('b')).r.status,401);
  await assert.rejects(f.users.save(f.root,1,{...f.users.get(1),is_active:false}),/Super Admin/);
  const {cookie}=await f.login('root');const list=await(await f.request('/api/admin/users',cookie)).text();assert.ok(!list.includes('password_hash'));assert.ok(!list.includes('$2b$'));
});
test('CSRF, privilege escalation, environment whitelist and secret-free auditing',async t=>{
  const f=await fixture(t);await f.create('delegate','executive',[],['users_manage','system_settings']);const root=await f.login('root'),delegate=await f.login('delegate');
  assert.equal((await f.request('/api/admin/environment',delegate.cookie)).status,403);
  assert.equal((await f.request('/api/admin/environment',root.cookie,'PUT',{PGPORT:'5433'},{Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await f.request('/api/admin/environment',root.cookie,'PUT',{SESSION_SECRET:'bad'})).status,400);
  const e=await(await f.request('/api/admin/environment',root.cookie)).text();assert.ok(!e.includes('fixture-only-do-not-return'));
  assert.equal((await f.request('/api/admin/environment',root.cookie,'PUT',{DASHBOARD_NAME:'Example'})).status,200);assert.ok(readFileSync(f.envPath,'utf8').includes('SESSION_SECRET=fixture-only-do-not-return'));
  assert.equal((await f.request('/api/admin/users/1/password',delegate.cookie,'POST',{password:'replacement-password-123'})).status,403);
  const logs=await(await f.request('/api/admin/activity',root.cookie)).text();assert.ok(!logs.includes('fixture-password'));assert.ok(!logs.includes('replacement-password'));assert.ok(!logs.includes('fixture-only-do-not-return'));
});
test('role changes revoke sessions; custom roles use immutable scope; native reports cannot leak Sales data',async t=>{
  const f=await fixture(t);await f.create('rep','sales',[1],['reports']);const rep=await f.login('rep');assert.equal((await f.request('/api/reports',rep.cookie)).status,403);
  await f.create('office','admin');const office=await f.login('office'),root=await f.login('root');const role=f.store.get("SELECT id FROM roles WHERE code='admin'");
  assert.equal((await f.request('/api/admin/roles/'+role.id,root.cookie,'PUT',{name:'Admin',permissions:['price_stock','customer_analysis']})).status,200);assert.equal((await f.request('/api/products',office.cookie)).status,401);
  assert.equal((await f.request('/api/admin/roles',root.cookie,'POST',{code:'regional',name:'Regional',scope:'territory'})).status,201);
});
test('scoped SQL binds mapping; concurrent request contexts and export connections remain isolated',async()=>{
  const territory={id:1,mapping:{teams:['หย'],customerCodes:["x' OR true --"],consignmentPrefixes:['ฝหย']}};
  const q=scopeQuery('SELECT * FROM ic_trans WHERE doc_date >= $1',['2026-01-01'],{territory});assert.ok(q.text.includes('FROM public.ic_trans h WHERE'));assert.ok(!q.text.includes("x' OR true"));assert.equal(q.values[2][0],"x' OR true --");
  const seen=[],raw={query:async(text,values)=>{seen.push({text,values});return {rows:[]};},connect:async()=>({query:raw.query,release(){}})};const pool=createScopedPool(raw);
  await Promise.all([accessContext.run({territory,module:'consignment'},async()=>{await new Promise(r=>setTimeout(r,5));const c=await pool.connect();await c.query('SELECT * FROM ic_trans_detail');c.release();}),accessContext.run({},()=>pool.query('SELECT * FROM ic_trans'))]);
  assert.equal(seen.filter(x=>x.values?.at(-1)?.includes('ฝหย')).length,1);assert.equal(seen.filter(x=>x.text==='SELECT * FROM ic_trans').length,1);
  assert.ok(scopeQuery('-- report\nWITH x AS (SELECT * FROM ic_trans) SELECT * FROM x',[],{territory}).text.includes('), x AS'));
});
test('migration is persistent/idempotent, imports legacy account once and upgrades its hash at login',async t=>{
  const f=await fixture(t);await f.login('root');assert.ok(f.store.get('SELECT password_hash FROM users WHERE id=1').password_hash.startsWith('$2'));
  const dir=mkdtempSync(resolve('test-results/migration-')),path=resolve(dir,'access.sqlite');const env={AUTH_USERNAME:'original',AUTH_PASSWORD_HASH:await hashPassword('migration-fixture-password')};
  let store=createAccessStore(path,env);store.run("UPDATE users SET full_name='Preserved' WHERE id=1");store.close();store=createAccessStore(path,{...env,AUTH_USERNAME:'different'});
  assert.equal(store.get('SELECT COUNT(*) n FROM users').n,1);assert.equal(store.get('SELECT full_name FROM users').full_name,'Preserved');assert.equal(store.get('SELECT COUNT(*) n FROM schema_migrations').n,1);store.close();
});
