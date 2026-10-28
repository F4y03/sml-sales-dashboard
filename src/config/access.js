export const PERMISSIONS = {
  dashboard: 'ภาพรวม / สรุปผู้บริหาร', price_stock: 'เช็คราคา / Stock', consignment: 'รับ–เบิกสินค้าฝาก',
  product_info: 'ข้อมูลสินค้า', product_export: 'ดาวน์โหลดข้อมูลสินค้า', best_sellers: 'ตัวกรองสินค้าขายดี / อันดับยอดขาย', product_images: 'แก้ไขลิงก์รูปสินค้า', customer_analysis: 'วิเคราะห์ลูกค้า', product_analysis: 'วิเคราะห์สินค้า', reports: 'รายงาน SML',
  marketplace_view: 'ดูยอดขายออนไลน์ Shopee / Lazada / TikTok', marketplace_upload: 'อัปโหลดไฟล์ยอดขายออนไลน์ (ไม่เห็นตัวเลข)',
  tiktok_sync: 'ดึงข้อมูล TikTok Shop API (ไม่เห็นตัวเลข)',
  lazada_sync: 'ดึงข้อมูล Lazada API (ไม่เห็นตัวเลข)',
  shopee_sync: 'ดึงข้อมูล Shopee API และดูสินค้า/สต็อก Shopee (ไม่เห็นยอดขาย)',
  users_manage: 'จัดการผู้ใช้', roles_manage: 'จัดการ Role / Permission', territories_manage: 'จัดการเขตการขาย',
  system_settings: 'ตั้งค่าระบบ', environment_settings: 'ตั้งค่า Environment (Super Admin เท่านั้น)', activity_logs: 'ดู Activity Log',
};
export const ROLES = [
  ['super_admin', 'Super Admin', 'all', Object.keys(PERMISSIONS)],
  ['executive', 'ผู้บริหาร', 'all', ['dashboard','price_stock','consignment','product_info','product_images','customer_analysis','product_analysis','reports','marketplace_view']],
  ['admin', 'Admin', 'all', ['price_stock','consignment','product_info','product_images','marketplace_upload']],
  // Read-only external reviewer (e.g. a marketplace app review): online sales, own activity log, data-protection page.
  ['reviewer', 'Reviewer (อ่านอย่างเดียว)', 'all', ['marketplace_view']],
  ['sales', 'Sales', 'territory', ['price_stock','consignment','customer_analysis','product_analysis']],
];
// Same explicit assignments as executive-ui.js / consignment-data.js. Unknown teams are not assigned.
export const INITIAL_TERRITORIES = [
  ['CENTRAL','ภาคกลาง',['กจ','กณ','กต','กร','กภ','บอ','ลภ']], ['NORTH','ภาคเหนือ',['หย']],
  ['SOUTH','ภาคใต้',['ตช']], ['EAST','ภาคตะวันออก',['วย']], ['NORTHEAST','ภาคตะวันออกเฉียงเหนือ',['อย']],
];
export const MODULES = [
  { permissions:['dashboard'], pages:['/','/index.html','/executive.html'], apis:['/api/dashboard','/api/invoices','/api/executive','/api/sales-trend'] },
  { permissions:['customer_analysis','product_analysis'], pages:['/customers.html'], apis:[] },
  { permissions:['product_analysis'], pages:[], apis:['/api/customer-insights/catalog','/api/customer-insights/product-buyers'] },
  { permissions:['customer_analysis'], pages:[], apis:['/api/customer-insights'] },
  { permissions:['dashboard','customer_analysis','product_analysis'], pages:[], apis:['/api/analytics'] },
  // Product photos are shown on the consignment page too. Listed before /api/products so it matches first;
  // saving/uploading still needs product_images and /pending stays Super Admin only (route middleware).
  { permissions:['price_stock','product_info','consignment'], pages:[], apis:['/api/products/images'] },
  { permissions:['price_stock','product_info'], pages:['/products.html'], apis:['/api/products'] },
  { permissions:['consignment'], pages:['/consignment.html'], apis:['/api/consignment'] },
  { permissions:['reports'], pages:['/reports.html'], apis:['/api/reports'] },
  // Marketplace: uploaders never get the summary API; history (file name/platform/who/when) is shared.
  { permissions:['marketplace_view'], pages:['/marketplace.html'], apis:['/api/marketplace/summary'] },
  { permissions:['marketplace_upload'], pages:['/marketplace-upload.html'], apis:['/api/marketplace/upload'] },
  { permissions:['marketplace_upload','marketplace_view'], pages:[], apis:['/api/marketplace/uploads','/api/marketplace/shops'] },
  // Old TikTok pages only redirect to marketplace.html#tiktok (the connect/sync widget lives on that tab).
  { permissions:['marketplace_upload','marketplace_view'], pages:['/tiktok-sales.html','/tiktok-shop.html'], apis:[] },
  // TikTok Shop API: status/sync need tiktok_sync (Super Admin by default, grantable per role; no figures); connect/callback/disconnect are Super Admin only (route middleware).
  { permissions:['tiktok_sync'], pages:[], apis:['/api/tiktok'] },
  // Google Sheets copy of the online-sales data: Super Admin only (route middleware).
  { permissions:['marketplace_view'], pages:[], apis:['/api/google-sheets'] },
  // Lazada API: same rules as TikTok — status/sync need lazada_sync; connect/callback/disconnect are Super Admin only.
  { permissions:['lazada_sync'], pages:[], apis:['/api/lazada'] },
  // Shopee API: same rules — status/sync/items need shopee_sync; connect/callback/disconnect are Super Admin only.
  { permissions:['shopee_sync'], pages:[], apis:['/api/shopee'] },
];
// Everything a 'reviewer' may reach; any other page or API answers 403 (src/middleware/access.js). GET/HEAD only,
// except logout (handled in auth.js). Static assets (js/css/images) stay open — they hold no data.
export const REVIEWER_ROLE = 'reviewer';
// Roles held to the reviewer allowlist (marketplace_reviewer: older review role kept in existing databases).
export const REVIEWER_ROLES = ['reviewer', 'marketplace_reviewer'];
export const isReviewer = role => REVIEWER_ROLES.includes(role);
export const REVIEWER_PAGES = ['/marketplace.html', '/my-activity.html', '/data-protection.html', '/access-denied.html'];
export const REVIEWER_APIS = ['/api/marketplace/summary', '/api/marketplace/shops', '/api/me/activity', '/api/connection-status',
  '/api/shopee/status', '/api/shopee/items', '/api/data-protection/cleanup']; // Shopee: connection badge, last sync, synced products (no connect/sync)
export const ADMIN_PERMISSIONS = ['users_manage','roles_manage','territories_manage','system_settings','environment_settings','activity_logs'];
