import { loadUser } from './permissionService.js';
import { makePassword } from './passwordService.js';
import { ADMIN_PERMISSIONS } from '../config/access.js';
export const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export const positiveId=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw bad('รหัสไม่ถูกต้อง');return n;};
export const text=(value,label,max=100)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\x00-\x1f]/.test(value))throw bad(label+' ไม่ถูกต้อง');return value.trim();};
export function createUserService(store,audit) {
  const get=id=>{const u=loadUser(store,id);if(!u)throw bad('ไม่พบผู้ใช้',404);return {...u,territoryIds:store.all('SELECT territory_id FROM user_territories WHERE user_id=?',id).map(t=>t.territory_id)};};
  function guard(actor,target,body) {
    if(actor.role==='super_admin')return;
    if(target?.role==='super_admin'||target?.id===actor.id)throw bad('ต้องให้ Super Admin จัดการบัญชีนี้',403);
    if(target?.permissions.some(p=>!actor.permissions.includes(p)))throw bad('ไม่สามารถจัดการบัญชีที่มีสิทธิ์สูงกว่าตนเอง',403);
    if(body.role && body.role!=='admin'&&body.role!=='sales'&&body.role!=='executive')throw bad('ต้องให้ Super Admin กำหนด Role นี้',403);
    if((body.additionalPermissions?.length)||body.territoryIds?.length)throw bad('ต้องให้ Super Admin กำหนดสิทธิ์และเขต',403);
    if(target && body.role!==undefined && body.role!==target.role)throw bad('ต้องให้ Super Admin เปลี่ยน Role',403);
  }
  return {get,list:()=>store.all('SELECT id FROM users ORDER BY username').map(x=>get(x.id)),remove(actor,id,ip){
    id=positiveId(id);const target=get(id),current=loadUser(store,actor.id);if(!current?.is_active)throw bad('กรุณาเข้าสู่ระบบใหม่',401);if(id===actor.id)throw bad('ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่');guard(current,target,{});
    if(target.role==='super_admin'&&store.get("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='super_admin' AND u.is_active=1").n<=1)throw bad('ไม่สามารถลบ Super Admin คนสุดท้าย');
    store.transaction(()=>{store.run('DELETE FROM sessions WHERE user_id=?',id);store.run('DELETE FROM user_permissions WHERE user_id=?',id);store.run('DELETE FROM user_territories WHERE user_id=?',id);store.run('UPDATE activity_logs SET user_id=NULL WHERE user_id=?',id);store.run('DELETE FROM users WHERE id=?',id);audit.record(current,'user.delete','users',{userId:id},null,ip);});
  },async save(actor,id,body,ip) {
    if(!body||typeof body!=='object'||Array.isArray(body))throw bad('ข้อมูลผู้ใช้ไม่ถูกต้อง');
    const target=id?get(id):null;guard(actor,target,body);
    const username=text(body.username,'Username');if(!/^[a-zA-Z0-9_.@-]+$/.test(username))throw bad('Username ใช้ตัวอักษรอังกฤษ ตัวเลข _ . @ -');
    const name=text(body.full_name,'ชื่อ',200);const role=store.get('SELECT * FROM roles WHERE code=?',text(body.role,'Role'));
    if(!role)throw bad('ไม่พบ Role');if(typeof body.is_active!=='boolean')throw bad('สถานะไม่ถูกต้อง');
    if(actor.role!=='super_admin'&&store.all('SELECT p.code FROM permissions p JOIN role_permissions rp ON p.id=rp.permission_id WHERE rp.role_id=?',role.id).some(p=>!actor.permissions.includes(p.code)))throw bad('ไม่สามารถให้สิทธิ์ที่ตนเองไม่มี',403);
    const permissions=body.additionalPermissions??[];const territories=body.territoryIds??[];
    if(!Array.isArray(permissions)||!Array.isArray(territories)||permissions.length>100||territories.length>500)throw bad('สิทธิ์หรือเขตไม่ถูกต้อง');
    for(const p of permissions){if(typeof p!=='string'||!store.get('SELECT 1 FROM permissions WHERE code=?',p))throw bad('ไม่พบ Permission');if(p==='environment_settings'&&role.code!=='super_admin')throw bad('Environment Settings สำหรับ Super Admin เท่านั้น');}
    if(role.scope==='territory'&&permissions.some(p=>ADMIN_PERMISSIONS.includes(p)))throw bad('บัญชีจำกัดเขตไม่สามารถจัดการระบบส่วนกลาง');
    const ids=[...new Set(territories.map(positiveId))];
    for(const t of ids)if(!store.get('SELECT 1 FROM sales_territories WHERE id=? AND is_active=1',t))throw bad('เขตไม่พร้อมใช้งาน');
    const hash=body.password?await makePassword(body.password):null;if(!target&&!hash)throw bad('กรุณาระบุรหัสผ่าน');
    return store.transaction(()=>{
      const currentActor=loadUser(store,actor.id);
      if(!currentActor?.is_active||currentActor.auth_version!==actor.auth_version)throw bad('สิทธิ์มีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่',401);
      const currentTarget=id?get(id):null;guard(currentActor,currentTarget,body);
      if(currentActor.role!=='super_admin'&&store.all('SELECT p.code FROM permissions p JOIN role_permissions rp ON p.id=rp.permission_id WHERE rp.role_id=?',role.id).some(p=>!currentActor.permissions.includes(p.code)))throw bad('สิทธิ์ Role เปลี่ยนแปลง กรุณาลองใหม่',403);
      for(const t of ids)if(!store.get('SELECT 1 FROM sales_territories WHERE id=? AND is_active=1',t))throw bad('เขตเปลี่ยนสถานะ กรุณาลองใหม่');
      if(currentTarget?.role==='super_admin'&&(!body.is_active||role.code!=='super_admin')&&store.get("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='super_admin' AND u.is_active=1").n<=1)throw bad('ต้องมี Super Admin ที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี');
      if(store.get('SELECT 1 FROM users WHERE username=? AND id<>?',username,id||0))throw bad('Username นี้ถูกใช้แล้ว');
      if(target)store.run('UPDATE users SET username=?,full_name=?,role_id=?,is_active=?,password_hash=COALESCE(?,password_hash),auth_version=auth_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',username,name,role.id,Number(body.is_active),hash,id);
      else id=Number(store.run('INSERT INTO users(username,full_name,role_id,is_active,password_hash) VALUES(?,?,?,?,?)',username,name,role.id,Number(body.is_active),hash).lastInsertRowid);
      if(actor.role==='super_admin'||!target){
        store.run('DELETE FROM user_permissions WHERE user_id=?',id);
        for(const p of new Set(permissions))store.run('INSERT INTO user_permissions SELECT ?,id FROM permissions WHERE code=?',id,p);
        store.run('DELETE FROM user_territories WHERE user_id=?',id);
        if(role.scope==='territory')for(const t of ids)store.run('INSERT INTO user_territories VALUES(?,?)',id,t);
      }
      store.run('DELETE FROM sessions WHERE user_id=?',id);
      audit.record(actor,target?'user.update':'user.create','users',{userId:id,is_active:body.is_active},null,ip);
      if(target?.role!==role.code)audit.record(actor,'user.role','users',{userId:id,role:role.code},null,ip);
      if(actor.role==='super_admin'){
        audit.record(actor,'user.permissions','users',{userId:id,permissions},null,ip);
        audit.record(actor,'user.territories','users',{userId:id,territoryIds:role.scope==='territory'?ids:[]},null,ip);
      }
      if(hash)audit.record(actor,'user.password_reset','users',{userId:id},null,ip);
      return get(id);
    });
  },async resetPassword(actor,id,password,ip){const target=get(id);guard(actor,target,{});const hash=await makePassword(password);store.transaction(()=>{const current=loadUser(store,actor.id);if(!current?.is_active||current.auth_version!==actor.auth_version)throw bad('กรุณาเข้าสู่ระบบใหม่',401);guard(current,get(id),{});store.run('UPDATE users SET password_hash=?,auth_version=auth_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',hash,id);store.run('DELETE FROM sessions WHERE user_id=?',id);audit.record(actor,'user.password_reset','users',{userId:id},null,ip);});}};
}
