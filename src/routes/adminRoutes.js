import { requirePermission,requireSuperAdmin } from '../middleware/access.js';
import { sameSite } from '../../auth.js';
import { createUserService,bad,positiveId,text } from '../services/userService.js';
import { createSettingsService } from '../services/settingsService.js';
import { validateMapping } from '../services/territoryService.js';
import { canAdmin } from '../services/permissionService.js';
import { ADMIN_PERMISSIONS } from '../config/access.js';
export function installAdminRoutes(app,store,audit,envPath) {
  const users=createUserService(store,audit),settings=createSettingsService(store,audit,envPath);
  const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'});}};
  app.use('/api/admin',(req,res,next)=>{if(!canAdmin(req.auth)||req.auth.scope==='territory')return res.status(403).json({error:'ไม่มีสิทธิ์จัดการระบบ'});if(!['GET','HEAD'].includes(req.method))return sameSite(req,res,next);next();});
  app.get('/api/admin/catalog',handle((req,res)=>res.json({roles:store.all('SELECT * FROM roles ORDER BY id').map(r=>({...r,permissions:store.all('SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?',r.id).map(p=>p.code)})),permissions:store.all('SELECT code,name FROM permissions ORDER BY id'),territories:store.all('SELECT * FROM sales_territories ORDER BY name').map(({mapping_json,...t})=>({...t,is_active:!!t.is_active,mapping:JSON.parse(mapping_json)}))})));
  app.get('/api/admin/users',requirePermission('users_manage'),handle((req,res)=>res.json({users:users.list()})));
  app.post('/api/admin/users',requirePermission('users_manage'),handle(async(req,res)=>res.status(201).json(await users.save(req.auth,null,req.body,req.socket.remoteAddress))));
  app.put('/api/admin/users/:id',requirePermission('users_manage'),handle(async(req,res)=>res.json(await users.save(req.auth,positiveId(req.params.id),req.body,req.socket.remoteAddress))));
  app.delete('/api/admin/users/:id',requirePermission('users_manage'),handle((req,res)=>{users.remove(req.auth,positiveId(req.params.id),req.socket.remoteAddress);res.json({ok:true});}));
  app.post('/api/admin/users/:id/password',requirePermission('users_manage'),handle(async(req,res)=>{await users.resetPassword(req.auth,positiveId(req.params.id),req.body?.password,req.body?.currentPassword,req.socket.remoteAddress);res.json({ok:true});}));
  app.post('/api/admin/roles',requireSuperAdmin,handle((req,res)=>{
    const code=text(req.body?.code,'Code'),name=text(req.body?.name,'ชื่อ');if(!/^[a-z][a-z0-9_]{1,49}$/.test(code))throw bad('Role Code ไม่ถูกต้อง');
    if(!['all','territory'].includes(req.body.scope))throw bad('Scope ไม่ถูกต้อง');
    if(store.get('SELECT 1 FROM roles WHERE code=?',code))throw bad('Role ซ้ำ');
    store.transaction(()=>{store.run('INSERT INTO roles(code,name,scope) VALUES(?,?,?)',code,name,req.body.scope);audit.record(req.auth,'role.create','roles',{code},null,req.socket.remoteAddress);});res.status(201).json({ok:true});
  }));
  app.put('/api/admin/roles/:id',requireSuperAdmin,handle((req,res)=>{
    const id=positiveId(req.params.id),role=store.get('SELECT * FROM roles WHERE id=?',id);if(!role)throw bad('ไม่พบ Role',404);if(role.code==='super_admin')throw bad('ไม่สามารถลดสิทธิ์ Super Admin');
    const permissions=req.body?.permissions,name=text(req.body?.name,'ชื่อ');if(!Array.isArray(permissions)||permissions.length>100)throw bad('Permissions ไม่ถูกต้อง');
    for(const p of permissions)if(typeof p!=='string'||p==='environment_settings'||!store.get('SELECT 1 FROM permissions WHERE code=?',p))throw bad('Permission ไม่ได้รับอนุญาต');
    if(role.scope==='territory'&&permissions.some(p=>ADMIN_PERMISSIONS.includes(p)))throw bad('บัญชีจำกัดเขตไม่สามารถจัดการระบบส่วนกลาง');
    store.transaction(()=>{store.run('UPDATE roles SET name=? WHERE id=?',name,id);store.run('DELETE FROM role_permissions WHERE role_id=?',id);for(const p of new Set(permissions))store.run('INSERT INTO role_permissions SELECT ?,id FROM permissions WHERE code=?',id,p);store.run('UPDATE users SET auth_version=auth_version+1 WHERE role_id=?',id);store.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role_id=?)',id);audit.record(req.auth,'role.permissions','roles',{role:role.code,permissions},null,req.socket.remoteAddress);});res.json({ok:true});
  }));
  app.post('/api/admin/permissions',requireSuperAdmin,handle((req,res)=>{
    const code=text(req.body?.code,'Code'),name=text(req.body?.name,'ชื่อ');if(!/^[a-z][a-z0-9_]{1,49}$/.test(code)||store.get('SELECT 1 FROM permissions WHERE code=?',code))throw bad('Permission Code ไม่ถูกต้องหรือซ้ำ');
    store.transaction(()=>{store.run('INSERT INTO permissions(code,name) VALUES(?,?)',code,name);audit.record(req.auth,'permission.create','permissions',{code},null,req.socket.remoteAddress);});res.status(201).json({ok:true});
  }));
  const saveTerritory=handle((req,res)=>{
    const id=req.params.id?positiveId(req.params.id):null,body=req.body||{};
    if(id&&!store.get('SELECT 1 FROM sales_territories WHERE id=?',id))throw bad('ไม่พบเขต',404);
    const code=text(body.code,'Code'),name=text(body.name,'ชื่อ');if(!/^[A-Z0-9_-]{2,40}$/.test(code)||typeof body.is_active!=='boolean')throw bad('Code หรือสถานะไม่ถูกต้อง');
    if(store.get('SELECT 1 FROM sales_territories WHERE code=? AND id<>?',code,id||0))throw bad('Code ซ้ำ');
    const mapping=validateMapping(body.mapping);
    store.transaction(()=>{if(id)store.run('UPDATE sales_territories SET code=?,name=?,is_active=?,mapping_json=? WHERE id=?',code,name,Number(body.is_active),JSON.stringify(mapping),id);else store.run('INSERT INTO sales_territories(code,name,is_active,mapping_json) VALUES(?,?,?,?)',code,name,Number(body.is_active),JSON.stringify(mapping));audit.record(req.auth,id?'territory.update':'territory.create','territories',{code,mapping},id,req.socket.remoteAddress);});res.json({ok:true});
  });
  app.post('/api/admin/territories',requirePermission('territories_manage'),saveTerritory);
  app.put('/api/admin/territories/:id',requirePermission('territories_manage'),saveTerritory);
  app.get('/api/admin/settings',requirePermission('system_settings'),handle((req,res)=>res.json(settings.read())));
  app.put('/api/admin/settings',requirePermission('system_settings'),handle((req,res)=>{settings.save(req.auth,req.body,req.socket.remoteAddress);res.json({ok:true});}));
  app.get('/api/admin/environment',requireSuperAdmin,handle((req,res)=>res.json(settings.environment())));
  app.put('/api/admin/environment',requireSuperAdmin,handle((req,res)=>res.json(settings.saveEnvironment(req.auth,req.body,req.socket.remoteAddress))));
  app.get('/api/admin/activity',requirePermission('activity_logs'),handle((req,res)=>res.json({logs:audit.list(req.query.before?positiveId(req.query.before):Number.MAX_SAFE_INTEGER)})));
  app.get('/api/admin/security',requireSuperAdmin,handle((req,res)=>res.json({sessions:store.all('SELECT u.id,u.username,COUNT(s.token_hash) AS sessions FROM users u LEFT JOIN sessions s ON s.user_id=u.id AND s.expires>? GROUP BY u.id',Date.now()),passwordAlgorithm:'bcrypt (legacy scrypt upgrades at login)',cookieHttpOnly:true,localBypass:false,smlReadOnly:true})));
  app.post('/api/admin/security/revoke/:id',requireSuperAdmin,handle((req,res)=>{const id=positiveId(req.params.id);store.transaction(()=>{store.run('DELETE FROM sessions WHERE user_id=?',id);audit.record(req.auth,'sessions.revoke','security',{userId:id},null,req.socket.remoteAddress);});res.json({ok:true});}));
  app.use('/api/admin',(req,res)=>res.status(404).json({error:'ไม่พบ Admin API'}));
}
