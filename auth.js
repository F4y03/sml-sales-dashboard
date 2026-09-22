import { randomBytes, scrypt as scryptCallback, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createAccessStore } from './src/models/accessStore.js';
import { createAuditService } from './src/services/auditService.js';
import { loadUser, landingPage } from './src/services/permissionService.js';
import { createTwoFactorService, TRUST_MS } from './src/services/twoFactorService.js';
import { createLockoutService } from './src/services/lockoutService.js';
import { createTerritoryService } from './src/services/territoryService.js';
import { makePassword,verifyPassword,hashOnly,isModernHash } from './src/services/passwordService.js';
const scrypt=promisify(scryptCallback);
// Kept for setup-auth and legacy credentials. Successful legacy logins upgrade to bcrypt.
export async function hashPassword(password,salt=randomBytes(16).toString('hex')) {return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
export function sameSite(req,res,next) {
  const origin=req.get('Origin');let validOrigin=true;
  try {if(origin)validOrigin=new URL(origin).host===req.get('Host');}catch{validOrigin=false;}
  if(req.get('X-PRPlus-Request')!=='1'||req.get('Sec-Fetch-Site')==='cross-site'||!validOrigin)return res.status(403).json({error:'คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่'});
  next();
}
export function installAuth(app,env=process.env,store=createAccessStore(':memory:',env)) {
  const secure=env.AUTH_COOKIE_SECURE!=='false',cookieName=secure?'__Host-prplus_session':'prplus_session';
  const options={httpOnly:true,secure,sameSite:'lax',path:'/'};
  const ttl=8*60*60*1000,attempts=new Map(),audit=createAuditService(store),territories=createTerritoryService(store,audit),lockout=createLockoutService(store,audit),twofa=createTwoFactorService(store,audit,env);
  const digest=token=>createHash('sha256').update(token).digest('hex');
  const trustedName=secure?'__Host-prplus_trusted':'prplus_trusted';
  const cookieOf=(req,name)=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
  const tokenOf=req=>cookieOf(req,cookieName);
  const cleanup=setInterval(()=>{store.run('DELETE FROM sessions WHERE expires<=?',Date.now());store.run('DELETE FROM login_challenges WHERE expires<=?',Date.now());store.run('DELETE FROM trusted_devices WHERE expires<=?',Date.now());for(const [key,a] of attempts)if(a.until<=Date.now())attempts.delete(key);},60000);cleanup.unref();
  app.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','Cloudflare-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});next();});
  const ipOf=req=>req.socket.remoteAddress||'unknown';
  // Per-IP limiter: 10 requests per 15 minutes per scope. Answers 429 and returns true when exceeded.
  const throttle=(req,res,scope='')=>{
    const key=scope+ipOf(req),now=Date.now();let attempt=attempts.get(key);
    if(!attempt||attempt.until<=now){if(attempts.size>=10000){res.status(429).json({error:'กรุณารอสักครู่'});return true;}attempt={count:0,until:now+15*60*1000};attempts.set(key,attempt);}
    if(++attempt.count>10){res.set('Retry-After',String(Math.ceil((attempt.until-now)/1000)));res.status(429).json({error:'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที'});return true;}
    return false;
  };
  // Creates the session once every required step has passed. `pre` runs inside the same transaction (2FA bookkeeping); `trust` adds a 15-day trusted device.
  function finish(req,res,user,{details={},pre,trust=false}={}) {
    const ip=ipOf(req),now=Date.now(),current=store.get('SELECT is_active,auth_version FROM users WHERE id=?',user.id);
    if(!current?.is_active||current.auth_version!==user.auth_version)return res.status(401).json({error:'สิทธิ์มีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่'});
    const allowed=territories.list(user.id),territoryId=user.scope==='territory'&&allowed.length===1?allowed[0].id:null;
    if(store.get('SELECT COUNT(*) n FROM sessions').n>=10000)return res.status(503).json({error:'ระบบไม่ว่าง กรุณาลองใหม่'});
    const token=randomBytes(32).toString('hex');let extra={},deviceToken=null;
    try{store.transaction(()=>{
      if(pre)extra=pre()||{};
      store.run('DELETE FROM sessions WHERE token_hash=?',digest(tokenOf(req)));store.run('INSERT INTO sessions VALUES(?,?,?,?,?)',digest(token),user.id,user.auth_version,territoryId,now+ttl);
      if(twofa.required(user))store.run('INSERT INTO session_two_factor(token_hash) VALUES(?)',digest(token));
      audit.record(user,'login','auth',details,territoryId,ip);
      if(trust){deviceToken=twofa.addTrusted(user.id);audit.record(user,'trusted_device.add','auth',{userId:user.id,days:15},territoryId,ip);}
      lockout.clear(user.id);
    });}catch(e){if(e.code==='2FA_REUSED')return res.status(401).json({error:'รหัสยืนยันไม่ถูกต้อง'});throw e;}
    attempts.delete(ip);res.cookie(cookieName,token,{...options,maxAge:ttl});
    if(deviceToken)res.cookie(trustedName,deviceToken,{...options,sameSite:'strict',maxAge:TRUST_MS});
    return res.json({ok:true,redirect:landingPage({...user,territoryId}),role:user.role,...extra});
  }
  app.post('/api/auth/login',sameSite,async(req,res)=>{
    if(!store.get('SELECT 1 FROM users LIMIT 1'))return res.status(503).json({error:'ยังไม่ได้ตั้งค่าบัญชี กรุณาติดต่อผู้ดูแลระบบ'});
    const ip=ipOf(req);if(throttle(req,res))return;
    const {username,password}=req.body||{};
    if(typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>1024)return res.status(400).json({error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});
    const row=store.get('SELECT * FROM users WHERE username=?',username),locked=!!row&&lockout.isLocked(row.id);
    // The password is always verified (dummy hash for unknown users), and every failure returns the same message, so unknown, wrong, disabled and locked accounts look identical.
    const valid=await verifyPassword(password,row?.password_hash||'$2b$12$......................J7sA2Mbc/7FGDyMVElRgSLy8QLUhOse');
    const fresh=row&&store.get('SELECT * FROM users WHERE id=?',row.id);
    if(!valid||locked||!fresh?.is_active||fresh.auth_version!==row.auth_version){
      const reason=!row?'unknown_user':locked?'locked':!fresh?.is_active?'inactive':!valid?'bad_password':'changed';
      if(row&&!locked&&!valid&&fresh?.is_active)lockout.fail(fresh,ip);
      audit.record(row?{id:row.id}:null,'login.failed','auth',row?{userId:row.id,reason}:{reason},null,ip);
      return res.status(401).json({error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});
    }
    if(!isModernHash(fresh.password_hash)&&Buffer.byteLength(password)<=72)store.run('UPDATE users SET password_hash=? WHERE id=? AND auth_version=?',await hashOnly(password),row.id,fresh.auth_version);
    const latest=store.get('SELECT is_active,auth_version FROM users WHERE id=?',row.id);
    if(!latest?.is_active||latest.auth_version!==fresh.auth_version)return res.status(401).json({error:'สิทธิ์มีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่'});
    const user=loadUser(store,row.id);
    // Super Admin: password -> trusted device? -> OTP -> session. Every other role keeps the original single-step flow.
    if(twofa.required(user)){
      if(twofa.isTrusted(user.id,cookieOf(req,trustedName)))return finish(req,res,user,{details:{method:'trusted_device'}});
      return res.json({ok:true,twoFactor:twofa.startChallenge(user)});
    }
    finish(req,res,user);
  });
  app.post('/api/auth/2fa',sameSite,(req,res)=>{
    if(throttle(req,res,'2fa:'))return;
    const {challenge:token,code,trust}=req.body||{},ip=ipOf(req),ch=twofa.challenge(token),expired=()=>res.status(401).json({error:'การยืนยันหมดอายุ กรุณาเข้าสู่ระบบใหม่',code:'CHALLENGE_EXPIRED'});
    if(!ch)return expired();
    const user=loadUser(store,ch.user_id);
    if(!user?.is_active||lockout.isLocked(user.id)){twofa.dropChallenge(token);return expired();}
    const result=twofa.check(ch,code);
    if(!result.ok){
      const locks=lockout.fail(user,ip);audit.record(user,'2fa.failed','auth',{userId:user.id,mode:ch.kind},null,ip);
      if(locks)twofa.dropChallenge(token);
      return res.status(401).json({error:'รหัสยืนยันไม่ถูกต้อง'});
    }
    finish(req,res,user,{trust:trust===true,details:{method:result.method},pre:()=>{
      if(!twofa.consume(ch,result))throw Object.assign(new Error('reused'),{code:'2FA_REUSED'});
      twofa.dropChallenge(token);
      if(ch.kind==='setup'){audit.record(user,'2fa.enrolled','auth',{userId:user.id},null,ip);return {recoveryCodes:twofa.regenerateRecoveryCodes(user.id)};}
      if(result.method==='recovery')audit.record(user,'2fa.recovery_used','auth',{userId:user.id,remaining:twofa.recoveryRemaining(user.id)},null,ip);
      else audit.record(user,'2fa.verified','auth',{userId:user.id},null,ip);
    }});
  });
  app.post('/api/auth/logout',sameSite,(req,res)=>{const key=digest(tokenOf(req));const s=store.get('SELECT user_id FROM sessions WHERE token_hash=?',key);store.transaction(()=>{store.run('DELETE FROM sessions WHERE token_hash=?',key);if(s)audit.record({id:s.user_id},'logout','auth',{},null,req.socket.remoteAddress);});res.clearCookie(cookieName,options);res.json({ok:true});});
  const publicPaths=new Set(['/login','/login.html','/login.css','/login.js','/login-silk.js','/theme-modes.css','/theme-mode.js','/assets/pr-plus-logo-red.png']);
  app.use((req,res,next)=>{
    if(publicPaths.has(req.path)&&['GET','HEAD'].includes(req.method))return next();
    const key=digest(tokenOf(req)),session=store.get('SELECT * FROM sessions WHERE token_hash=? AND expires>?',key,Date.now());
    const user=session&&loadUser(store,session.user_id);
    // Localhost bypass is removed: neither Host headers nor local requests confer privileges.
    const secondFactorComplete=user&&(!twofa.required(user)||!!store.get('SELECT 1 FROM session_two_factor WHERE token_hash=?',key));
    if(user?.is_active&&user.auth_version===session.auth_version&&secondFactorComplete){
      const allowed=territories.list(user.id);let territory=user.scope==='territory'?allowed.find(t=>t.id===session.territory_id):null;
      if(!territory&&user.scope==='territory'&&allowed.length===1)territory=allowed[0];
      const territoryId=territory?.id??null;
      if(territoryId!==session.territory_id)store.run('UPDATE sessions SET territory_id=? WHERE token_hash=?',territoryId,key);
      req.auth={...user,territoryId,territories:allowed.map(({mapping,...t})=>t)};req.territory=territory;req.sessionHash=key;return next();
    }
    if(req.path==='/api'||req.path.startsWith('/api/'))return res.status(401).json({error:'กรุณาเข้าสู่ระบบ',code:'AUTH_REQUIRED'});
    res.redirect('/login.html?next='+encodeURIComponent(req.originalUrl));
  });
  app.get('/api/auth/me',(req,res)=>{const {auth_version,...user}=req.auth;res.json({...user,landing:landingPage(req.auth),dashboardName:store.get("SELECT value FROM system_settings WHERE key='dashboard_name'")?.value||env.DASHBOARD_NAME||'SML analytics',supportMessage:store.get("SELECT value FROM system_settings WHERE key='support_message'")?.value||''});});
  app.post('/api/auth/password',sameSite,async(req,res)=>{
    const {currentPassword,newPassword,confirmPassword}=req.body||{};
    if(typeof currentPassword!=='string'||typeof newPassword!=='string'||typeof confirmPassword!=='string')return res.status(400).json({error:'กรุณากรอกรหัสผ่านให้ครบ'});
    if(newPassword!==confirmPassword)return res.status(400).json({error:'รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน'});
    const row=store.get('SELECT password_hash,auth_version,is_active FROM users WHERE id=?',req.auth.id);
    if(!row?.is_active||row.auth_version!==req.auth.auth_version)return res.status(401).json({error:'กรุณาเข้าสู่ระบบใหม่'});
    if(!await verifyPassword(currentPassword,row.password_hash))return res.status(400).json({error:'รหัสผ่านเดิมไม่ถูกต้อง'});
    let hash;try{hash=await makePassword(newPassword,{username:req.auth.username});}catch(e){return res.status(e.status||400).json({error:e.message});}
    try{store.transaction(()=>{const fresh=store.get('SELECT password_hash,auth_version,is_active FROM users WHERE id=?',req.auth.id);if(!fresh?.is_active||fresh.auth_version!==row.auth_version||fresh.password_hash!==row.password_hash)throw Object.assign(new Error('ข้อมูลบัญชีมีการเปลี่ยนแปลง กรุณาลองใหม่'),{status:409});store.run('UPDATE users SET password_hash=?,auth_version=auth_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',hash,req.auth.id);store.run('DELETE FROM sessions WHERE user_id=?',req.auth.id);audit.record(req.auth,'user.password_change','users',{userId:req.auth.id},req.auth.territoryId,req.socket.remoteAddress);const revoked=twofa.revokeTrusted(req.auth.id);if(revoked)audit.record(req.auth,'trusted_device.revoke','auth',{userId:req.auth.id,count:revoked,reason:'password_change'},null,req.socket.remoteAddress);});}catch(e){return res.status(e.status||500).json({error:e.status?e.message:'เปลี่ยนรหัสผ่านไม่สำเร็จ'});}
    res.clearCookie(cookieName,options);res.clearCookie(trustedName,{...options,sameSite:'strict'});res.json({ok:true,redirect:'/login.html?password=changed'});
  });
  app.post('/api/auth/territory',sameSite,(req,res)=>{
    if(req.auth.scope!=='territory')return res.status(400).json({error:'บัญชีนี้ดูได้ทุกเขต'});
    const id=req.body?.territoryId;if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'เขตไม่ถูกต้อง'});
    try{territories.select(req.auth,id,req.sessionHash,req.socket.remoteAddress);res.json({ok:true,redirect:landingPage({...req.auth,territoryId:id})});}catch(e){res.status(e.status||500).json({error:e.status?e.message:'เปลี่ยนเขตไม่สำเร็จ'});}
  });
  app.get('/api/auth/security',(req,res)=>res.json({twoFactor:{required:twofa.required(req.auth),enrolled:twofa.isEnrolled(req.auth.id),recoveryCodesRemaining:twofa.isEnrolled(req.auth.id)?twofa.recoveryRemaining(req.auth.id):0,trustedDevices:twofa.trustedCount(req.auth.id)}}));
  // Ends every session and removes every trusted device of the caller, so the next login on any device needs the full flow again.
  app.post('/api/auth/logout-all',sameSite,(req,res)=>{
    const ip=req.socket.remoteAddress;
    store.transaction(()=>{store.run('DELETE FROM sessions WHERE user_id=?',req.auth.id);const n=twofa.revokeTrusted(req.auth.id);audit.record(req.auth,'auth.logout_all','auth',{userId:req.auth.id},null,ip);if(n)audit.record(req.auth,'trusted_device.revoke','auth',{userId:req.auth.id,count:n,reason:'logout_all'},null,ip);});
    res.clearCookie(cookieName,options);res.clearCookie(trustedName,{...options,sameSite:'strict'});res.json({ok:true,redirect:'/login.html'});
  });
  // Replaces the recovery codes (old ones stop working). Needs the current password again; wrong attempts count toward the lockout.
  app.post('/api/auth/recovery-codes',sameSite,async(req,res)=>{
    if(!twofa.required(req.auth)||!twofa.isEnrolled(req.auth.id))return res.status(400).json({error:'บัญชีนี้ไม่ได้ใช้ 2FA'});
    if(throttle(req,res,'recovery:'))return;
    const row=store.get('SELECT password_hash FROM users WHERE id=?',req.auth.id);
    if(typeof req.body?.password!=='string'||!await verifyPassword(req.body.password,row?.password_hash)){lockout.fail(req.auth,req.socket.remoteAddress);return res.status(400).json({error:'รหัสผ่านไม่ถูกต้อง'});}
    const codes=store.transaction(()=>{const c=twofa.regenerateRecoveryCodes(req.auth.id);audit.record(req.auth,'2fa.recovery_regenerated','auth',{userId:req.auth.id},null,req.socket.remoteAddress);return c;});
    res.json({ok:true,recoveryCodes:codes});
  });
  app.get('/login',(req,res)=>res.redirect('/login.html'));
  return {store,audit,territories,twofa,close(){clearInterval(cleanup);}};
}
