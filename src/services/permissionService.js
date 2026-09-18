import { ADMIN_PERMISSIONS } from '../config/access.js';
export const hasPermission = (user,code) => !!user && (code === 'price_stock' || user.role === 'super_admin' || user.permissions.includes(code));
export const canAdmin = user => ADMIN_PERMISSIONS.some(p=>hasPermission(user,p));
export function loadUser(store,id) {
  const row=store.get('SELECT u.id,u.username,u.full_name,u.role_id,u.is_active,u.auth_version,r.code AS role,r.scope FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?',id);
  if (!row) return null;
  return {...row,is_active:!!row.is_active, permissions:store.all('SELECT DISTINCT p.code FROM permissions p WHERE p.id IN (SELECT permission_id FROM role_permissions WHERE role_id=? UNION SELECT permission_id FROM user_permissions WHERE user_id=?)',row.role_id,id).map(x=>x.code),additionalPermissions:store.all('SELECT p.code FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=?',id).map(x=>x.code)};
}
export function landingPage(user) {
  if (user.scope==='territory' && !user.territoryId) return '/select-territory.html';
  if (hasPermission(user,'dashboard')) return '/executive.html';
  if (hasPermission(user,'customer_analysis') || hasPermission(user,'product_analysis')) return '/customers.html';
  if (hasPermission(user,'price_stock') || hasPermission(user,'product_info')) return '/products.html';
  if (hasPermission(user,'consignment')) return '/consignment.html';
  if (hasPermission(user,'reports') && user.scope!=='territory') return '/reports.html';
  return canAdmin(user) ? '/system-admin.html' : '/access-denied.html';
}
