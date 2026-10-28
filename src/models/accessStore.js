import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PERMISSIONS, ROLES, INITIAL_TERRITORIES } from '../config/access.js';

export function createAccessStore(path = ':memory:', env = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive:true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  for (const file of ['001-access.sql','002-security.sql','003-product-images.sql','004-product-image-imports.sql','005-unmatched-product-images.sql','006-product-image-files.sql','007-marketplace.sql','008-marketplace-shops.sql','009-tiktok-api.sql','010-lazada-api.sql','011-shopee-api.sql']) db.exec(readFileSync(new URL('../../migrations/'+file, import.meta.url), 'utf8'));
  // Per-user override: an 'all'-scope role (e.g. Admin) can be limited to assigned territories.
  // Per-account 2FA exemption (e.g. a marketplace app-review account); off for everyone unless set explicitly.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='two_factor_exempt'").get()) db.exec("ALTER TABLE users ADD COLUMN two_factor_exempt INTEGER NOT NULL DEFAULT 0 CHECK(two_factor_exempt IN (0,1))");
  if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='scope_override'").get()) db.exec("ALTER TABLE users ADD COLUMN scope_override TEXT CHECK(scope_override IN ('territory'))");
  // Marketplace seller shop (008); NULL = uploaded before shops existed.
  for (const table of ['marketplace_uploads','marketplace_orders','marketplace_settlements']) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name='shop_id'").get(table)) db.exec(`ALTER TABLE ${table} ADD COLUMN shop_id INTEGER REFERENCES marketplace_shops(id)`);
  }
  const store = {
    db, path,
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } },
    close: () => db.close(),
  };
  store.transaction(() => {
    for (const [code,name] of Object.entries(PERMISSIONS)) store.run('INSERT OR IGNORE INTO permissions(code,name) VALUES(?,?)',code,name);
    for (const [code,name,scope,permissions] of ROLES) {
      const added=store.run('INSERT OR IGNORE INTO roles(code,name,scope,built_in) VALUES(?,?,?,1)',code,name,scope);
      if (added.changes) for (const p of permissions) store.run('INSERT INTO role_permissions SELECT r.id,p.id FROM roles r,permissions p WHERE r.code=? AND p.code=?',code,p);
    }
    if (!store.get('SELECT 1 FROM system_settings WHERE key=?','territories_seeded')) {
      for (const [code,name,teams] of INITIAL_TERRITORIES) store.run('INSERT OR IGNORE INTO sales_territories(code,name,mapping_json) VALUES(?,?,?)',code,name,JSON.stringify({teams,customerCodes:[],consignmentPrefixes:teams.map(x=>'ฝ'+x)}));
      store.run('INSERT INTO system_settings VALUES(?,?)','territories_seeded','true');
    }
    if (!store.get('SELECT 1 FROM system_settings WHERE key=?','northeast_name_v2')) {
      store.run('UPDATE sales_territories SET name=? WHERE code=?','ภาคตะวันออกเฉียงเหนือ','NORTHEAST');
      store.run('INSERT INTO system_settings VALUES(?,?)','northeast_name_v2','true');
    }
    // best_sellers is a new permission; INSERT OR IGNORE above only wires permissions for roles created
    // just now, so an existing super_admin row from before this change needs it granted explicitly once.
    if (!store.get('SELECT 1 FROM system_settings WHERE key=?','best_sellers_super_admin_v1')) {
      store.run("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r,permissions p WHERE r.code='super_admin' AND p.code='best_sellers' AND NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id=r.id AND permission_id=p.id)");
      store.run('INSERT INTO system_settings VALUES(?,?)','best_sellers_super_admin_v1','true');
    }
    // product_images (edit product photo links) is granted to Super Admin once, the same way as best_sellers.
    if (!store.get('SELECT 1 FROM system_settings WHERE key=?','product_images_super_admin_v1')) {
      store.run("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r,permissions p WHERE r.code='super_admin' AND p.code='product_images' AND NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id=r.id AND permission_id=p.id)");
      store.run('INSERT INTO system_settings VALUES(?,?)','product_images_super_admin_v1','true');
    }
    // Everyone except Sales may edit product photo links: grant the existing Executive/Admin roles once.
    if (!store.get('SELECT 1 FROM system_settings WHERE key=?','product_images_roles_v1')) {
      store.run("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r,permissions p WHERE r.code IN ('executive','admin') AND p.code='product_images' AND NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id=r.id AND permission_id=p.id)");
      store.run('INSERT INTO system_settings VALUES(?,?)','product_images_roles_v1','true');
    }
    // Marketplace upload is new: existing Admin roles may upload files (they never see the numbers).
    if (!store.get('SELECT 1 FROM system_settings WHERE key=?','marketplace_upload_admin_v1')) {
      store.run("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r,permissions p WHERE r.code='admin' AND p.code='marketplace_upload' AND NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id=r.id AND permission_id=p.id)");
      store.run('INSERT INTO system_settings VALUES(?,?)','marketplace_upload_admin_v1','true');
    }
    // Executives see online sales (Shopee / Lazada / TikTok): grant the existing Executive role once (removable later in System Admin).
    if (!store.get('SELECT 1 FROM system_settings WHERE key=?','marketplace_view_executive_v1')) {
      store.run("INSERT INTO role_permissions SELECT r.id,p.id FROM roles r,permissions p WHERE r.code='executive' AND p.code='marketplace_view' AND NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id=r.id AND permission_id=p.id)");
      store.run('INSERT INTO system_settings VALUES(?,?)','marketplace_view_executive_v1','true');
    }
    // Import the existing account once; never overwrite managed users on restart.
    if (!store.get('SELECT 1 FROM users LIMIT 1') && env.AUTH_USERNAME && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.AUTH_PASSWORD_HASH || '')) {
      store.run("INSERT INTO users(username,password_hash,full_name,role_id) SELECT ?,?,?,id FROM roles WHERE code='super_admin'",env.AUTH_USERNAME,env.AUTH_PASSWORD_HASH,env.AUTH_USERNAME);
    }
  });
  return store;
}
