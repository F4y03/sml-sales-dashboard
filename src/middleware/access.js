import { MODULES } from '../config/access.js';
import { canAdmin,hasPermission,landingPage } from '../services/permissionService.js';
import { accessContext } from '../services/territoryService.js';
export const requireLogin=(req,res,next)=>req.auth?next():res.status(401).json({error:'กรุณาเข้าสู่ระบบ',code:'AUTH_REQUIRED'});
export const requireRole=(...roles)=>(req,res,next)=>roles.includes(req.auth?.role)?next():res.status(403).json({error:'ไม่มีสิทธิ์เข้าถึง'});
export const requireSuperAdmin=requireRole('super_admin');
export const requirePermission=permission=>(req,res,next)=>hasPermission(req.auth,permission)?next():res.status(403).json({error:'ไม่มีสิทธิ์เข้าถึง'});
export function requireSalesTerritory(req,res,next) {
  if(req.auth.scope!=='territory')return next();
  if(req.territory && Object.values(req.territory.mapping).some(v=>Array.isArray(v)&&v.length))return next();
  if(req.path.startsWith('/api/'))return res.status(403).json({error:req.auth.territories.length?'กรุณาเลือกเขตที่มีการกำหนด Mapping แล้ว':'ยังไม่ได้รับการกำหนดเขตการขาย กรุณาติดต่อผู้ดูแลระบบ',code:'TERRITORY_REQUIRED'});
  return res.redirect('/select-territory.html');
}
export function installAccess(app) {
  app.use((req,res,next)=>{
    if(!req.auth)return next(); // Only auth's explicitly public resources reach here anonymously.
    let path;
    try{path=decodeURIComponent(req.path).replace(/\/+$/,'')||'/';}catch{return res.status(400).end();}
    if(/%|\\|\/\//.test(path))return res.status(400).json({error:'URL ไม่ถูกต้อง'});
    const forbidden=()=>path.startsWith('/api/')?res.status(403).json({error:'ไม่มีสิทธิ์เข้าถึง'}):res.status(403).send('<meta charset="utf-8"><p>ไม่มีสิทธิ์เข้าถึงหน้านี้</p><a href="/access-denied.html">กลับหน้าบัญชี</a>');
    if(['/select-territory.html','/access-denied.html'].includes(path))return next();
    if(path==='/system-admin.html')return canAdmin(req.auth)?next():forbidden();
    if(path==='/pending-product-images.html')return req.auth.role==='super_admin'?next():forbidden();
    if(path.startsWith('/api/admin/'))return next(); // Route-specific middleware is mandatory below.
    if(path==='/api/connection-status')return next();
    if(path==='/api/products/export'&&req.auth.role!=='super_admin')return forbidden();
    // สินค้าขายดีเป็นสิทธิ์แยก Super Admin มอบให้เป็นรายบุคคล ซ่อนปุ่มอย่างเดียวไม่พอ ต้องกันที่ API ด้วย
    const wantsBestSellers=path==='/api/products/best-seller'
      ||((path==='/api/products'||path==='/api/products/export')&&typeof req.query.best==='string'&&req.query.best!==''&&req.query.best!=='off');
    if(wantsBestSellers&&!hasPermission(req.auth,'best_sellers'))return forbidden();
    const module=MODULES.find(m=>m.pages.includes(path)||m.apis.some(p=>path===p||path.startsWith(p+'/')));
    if(!module){
      // Static assets contain no data. All unknown data/page routes fail closed.
      if(/^\/[\w./-]+\.(?:js|css|png|svg|ico|woff2?)$/.test(path))return next();
      return forbidden();
    }
    if(!module.permissions.some(p=>hasPermission(req.auth,p))) {
      if(path==='/')return res.redirect(landingPage(req.auth));
      return forbidden();
    }
    if(req.auth.scope==='territory'&&module.permissions.includes('reports'))return res.status(403).send(path.startsWith('/api/')?{error:'รายงาน SML แบบ native ยังไม่รองรับการจำกัดเขต กรุณาใช้หน้าวิเคราะห์หรือภาพรวม'}:'รายงาน SML แบบ native ยังไม่รองรับการจำกัดเขต');
    if(module.permissions.includes('price_stock')) {
      // Shared product reference data is available before territory selection.
      // An empty scope still excludes territory-owned inventory and transactions.
      const territory=req.territory||(req.auth.scope==='territory'?{mapping:{teams:[],customerCodes:[],consignmentPrefixes:[]}}:null);
      return accessContext.run({territory,module:module.permissions[0]},next);
    }
    requireSalesTerritory(req,res,()=>accessContext.run({territory:req.territory,module:module.permissions[0]},next));
  });
}
