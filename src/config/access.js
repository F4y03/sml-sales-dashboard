export const PERMISSIONS = {
  dashboard: 'ภาพรวม / สรุปผู้บริหาร', price_stock: 'เช็คราคา / Stock', consignment: 'รับ–เบิกสินค้าฝาก',
  product_info: 'ข้อมูลสินค้า', best_sellers: 'ตัวกรองสินค้าขายดี / อันดับยอดขาย', product_images: 'แก้ไขลิงก์รูปสินค้า', customer_analysis: 'วิเคราะห์ลูกค้า', product_analysis: 'วิเคราะห์สินค้า', reports: 'รายงาน SML',
  users_manage: 'จัดการผู้ใช้', roles_manage: 'จัดการ Role / Permission', territories_manage: 'จัดการเขตการขาย',
  system_settings: 'ตั้งค่าระบบ', environment_settings: 'ตั้งค่า Environment (Super Admin เท่านั้น)', activity_logs: 'ดู Activity Log',
};
export const ROLES = [
  ['super_admin', 'Super Admin', 'all', Object.keys(PERMISSIONS)],
  ['executive', 'ผู้บริหาร', 'all', ['dashboard','price_stock','consignment','product_info','product_images','customer_analysis','product_analysis','reports']],
  ['admin', 'Admin', 'all', ['price_stock','consignment','product_info','product_images']],
  ['sales', 'Sales', 'territory', ['price_stock','consignment','customer_analysis','product_analysis']],
];
// Same explicit assignments as executive-ui.js / consignment-data.js. Unknown teams are not assigned.
export const INITIAL_TERRITORIES = [
  ['CENTRAL','ภาคกลาง',['กจ','กณ','กต','กร','กภ','บอ']], ['NORTH','ภาคเหนือ',['หย']],
  ['SOUTH','ภาคใต้',['ตช']], ['EAST','ภาคตะวันออก',['ลภ']], ['NORTHEAST','ภาคตะวันออกเฉียงเหนือ',['อย']],
];
export const MODULES = [
  { permissions:['dashboard'], pages:['/','/index.html','/executive.html'], apis:['/api/dashboard','/api/invoices','/api/executive','/api/sales-trend'] },
  { permissions:['customer_analysis','product_analysis'], pages:['/customers.html'], apis:[] },
  { permissions:['product_analysis'], pages:[], apis:['/api/customer-insights/catalog','/api/customer-insights/product-buyers'] },
  { permissions:['customer_analysis'], pages:[], apis:['/api/customer-insights'] },
  { permissions:['dashboard','customer_analysis','product_analysis'], pages:[], apis:['/api/analytics'] },
  { permissions:['price_stock','product_info'], pages:['/products.html'], apis:['/api/products'] },
  { permissions:['consignment'], pages:['/consignment.html'], apis:['/api/consignment'] },
  { permissions:['reports'], pages:['/reports.html'], apis:['/api/reports'] },
];
export const ADMIN_PERMISSIONS = ['users_manage','roles_manage','territories_manage','system_settings','environment_settings','activity_logs'];
