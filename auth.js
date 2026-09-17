import { randomBytes, scrypt as scryptCallback, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createAccessStore } from './src/models/accessStore.js';
import { createAuditService } from './src/services/auditService.js';
import { loadUser, landingPage } from './src/services/permissionService.js';
import { createTerritoryService } from './src/services/territoryService.js';
import { makePassword,verifyPassword } from './src/services/passwordService.js';
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
  const ttl=8*60*60*1000,attempts=new Map(),audit=createAuditService(store),territories=createTerritoryService(store,audit);
  const digest=token=>createHash('sha256').update(token).digest('hex');
  const tokenOf=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  const cleanup=setInterval(()=>{store.run('DELETE FROM sessions WHERE expires<=?',Date.now());for(const [key,a] of attempts)if(a.until<=Date.now())attempts.delete(key);},60000);cleanup.unref();
  app.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','Cloudflare-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});next();});
  app.post('/api/auth/login',sameSite,async(req,res)=>{
    if(!store.get('SELECT 1 FROM users LIMIT 1'))return res.status(503).json({error:'ยังไม่ได้ตั้งค่าบัญชี กรุณาติดต่อผู้ดูแลระบบ'});
    const ip=req.socket.remoteAddress||'unknown',now=Date.now();let attempt=attempts.get(ip);
    if(!attempt||attempt.until<=now){if(attempts.size>=10000)return res.status(429).json({error:'กรุณารอสักครู่'});attempt={count:0,until:now+15*60*1000};attempts.set(ip,attempt);}
    if(++attempt.count>10){res.set('Retry-After',String(Math.ceil((attempt.until-now)/1000)));return res.status(429).json({error:'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที'});}
    const {username,password}=req.body||{};
    if(typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>1024)return res.status(400).json({error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});
    const row=store.get('SELECT * FROM users WHERE username=?',username);
    const valid=await verifyPassword(password,row?.password_hash||'$2b$12$......................J7sA2Mbc/7FGDyMVElRgSLy8QLUhOse');
    const fresh=row&&store.get('SELECT * FROM users WHERE id=?',row.id);
    if(!valid||!fresh?.is_active||fresh.auth_version!==row.auth_version){audit.record(null,'login.failed','auth',{},null,ip);return res.status(401).json({error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});}
    if(!fresh.password_hash.startsWith('$2')&&password.length>0&&Buffer.byteLength(password)<=72)store.run('UPDATE users SET password_hash=? WHERE id=? AND auth_version=?',await makePassword(password),row.id,fresh.auth_version);
    const latest=store.get('SELECT is_active,auth_version FROM users WHERE id=?',row.id);
    if(!latest?.is_active||latest.auth_version!==fresh.auth_version)return res.status(401).json({error:'สิทธิ์มีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่'});
    const user=loadUser(store,row.id),allowed=territories.list(user.id),territoryId=user.scope==='territory'&&allowed.length===1?allowed[0].id:null;
    if(store.get('SELECT COUNT(*) n FROM sessions').n>=10000)return res.status(503).json({error:'ระบบไม่ว่าง กรุณาลองใหม่'});
    const token=randomBytes(32).toString('hex');
    store.transaction(()=>{store.run('DELETE FROM sessions WHERE token_hash=?',digest(tokenOf(req)));store.run('INSERT INTO sessions VALUES(?,?,?,?,?)',digest(token),row.id,fresh.auth_version,territoryId,now+ttl);audit.record(user,'login','auth',{},territoryId,ip);});
    attempts.delete(ip);res.cookie(cookieName,token,{...options,maxAge:ttl});res.json({ok:true,redirect:landingPage({...user,territoryId}),role:user.role});
  });
  app.post('/api/auth/logout',sameSite,(req,res)=>{const key=digest(tokenOf(req));const s=store.get('SELECT user_id FROM sessions WHERE token_hash=?',key);store.transaction(()=>{store.run('DELETE FROM sessions WHERE token_hash=?',key);if(s)audit.record({id:s.user_id},'logout','auth',{},null,req.socket.remoteAddress);});res.clearCookie(cookieName,options);res.json({ok:true});});
  const publicPaths=new Set(['/login','/login.html','/login.css','/login.js','/theme-modes.css','/theme-mode.js','/assets/pr-plus-logo-red.png']);
  app.use((req,res,next)=>{
    if(publicPaths.has(req.path)&&['GET','HEAD'].includes(req.method))return next();
    const key=digest(tokenOf(req)),session=store.get('SELECT * FROM sessions WHERE token_hash=? AND expires>?',key,Date.now());
    const user=session&&loadUser(store,session.user_id);
    // Localhost bypass is removed: neither Host headers nor local requests confer privileges.
    if(user?.is_active&&user.auth_version===session.auth_version){
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
  app.post('/api/auth/territory',sameSite,(req,res)=>{
    if(req.auth.scope!=='territory')return res.status(400).json({error:'บัญชีนี้ดูได้ทุกเขต'});
    const id=req.body?.territoryId;if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'เขตไม่ถูกต้อง'});
    try{territories.select(req.auth,id,req.sessionHash,req.socket.remoteAddress);res.json({ok:true,redirect:landingPage({...req.auth,territoryId:id})});}catch(e){res.status(e.status||500).json({error:e.status?e.message:'เปลี่ยนเขตไม่สำเร็จ'});}
  });
  app.get('/login',(req,res)=>res.redirect('/login.html'));
  return {store,audit,territories,close(){clearInterval(cleanup);}};
}
