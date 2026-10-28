import { ADMIN_PERMISSIONS, isReviewer } from '../config/access.js';
export const hasPermission = (user,code) => !!user && ((code === 'price_stock' && !isReviewer(user.role)) || user.role === 'super_admin' || user.permissions.includes(code));
export const canAdmin = user => ADMIN_PERMISSIONS.some(p=>hasPermission(user,p));
export function loadUser(store,id) {
  const row=store.get('SELECT u.id,u.username,u.full_name,u.role_id,u.is_active,u.auth_version,u.two_factor_exempt,r.code AS role,COALESCE(u.scope_override,r.scope) AS scope,r.scope AS roleScope FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?',id);
  if (!row) return null;
  return {...row,is_active:!!row.is_active,two_factor_exempt:!!row.two_factor_exempt, permissions:store.all('SELECT DISTINCT p.code FROM permissions p WHERE p.id IN (SELECT permission_id FROM role_permissions WHERE role_id=? UNION SELECT permission_id FROM user_permissions WHERE user_id=?)',row.role_id,id).map(x=>x.code),additionalPermissions:store.all('SELECT p.code FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=?',id).map(x=>x.code)};
}
export function landingPage(user) {
  if (user.scope==='territory' && !user.territoryId) return '/select-territory.html';
  if (user.role==='super_admin') return '/system-admin.html';
  if (isReviewer(user.role)) return '/marketplace.html#shopee';
  if (hasPermission(user,'dashboard')) return '/index.html';
  if (hasPermission(user,'customer_analysis') || hasPermission(user,'product_analysis')) return '/customers.html';
  if (hasPermission(user,'consignment')) return '/consignment.html';
  // price_stock is open to everyone, so an online-sales-only account (e.g. a marketplace app reviewer) would land on
  // the SML price page; send it to its own data instead. Accounts that explicitly hold price_stock/product_info keep products.
  if (hasPermission(user,'marketplace_view') && user.scope!=='territory' && !user.permissions?.some(p=>p==='price_stock'||p==='product_info')) return '/marketplace.html#shopee';
  if (hasPermission(user,'price_stock') || hasPermission(user,'product_info')) return '/products.html';
  if (hasPermission(user,'reports') && user.scope!=='territory') return '/reports.html';
  if (hasPermission(user,'marketplace_view') && user.scope!=='territory') return '/marketplace.html';
  if (hasPermission(user,'marketplace_upload')) return '/marketplace-upload.html';
  return canAdmin(user) ? '/system-admin.html' : '/access-denied.html';
}
