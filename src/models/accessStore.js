import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PERMISSIONS, ROLES, INITIAL_TERRITORIES } from '../config/access.js';

export function createAccessStore(path = ':memory:', env = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive:true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  for (const file of ['001-access.sql','002-security.sql','003-product-images.sql']) db.exec(readFileSync(new URL('../../migrations/'+file, import.meta.url), 'utf8'));
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
    // Import the existing account once; never overwrite managed users on restart.
    if (!store.get('SELECT 1 FROM users LIMIT 1') && env.AUTH_USERNAME && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.AUTH_PASSWORD_HASH || '')) {
      store.run("INSERT INTO users(username,password_hash,full_name,role_id) SELECT ?,?,?,id FROM roles WHERE code='super_admin'",env.AUTH_USERNAME,env.AUTH_PASSWORD_HASH,env.AUTH_USERNAME);
    }
  });
  return store;
}
