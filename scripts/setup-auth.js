import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createAccessStore } from '../src/models/accessStore.js';
import { makePassword } from '../src/services/passwordService.js';
import { createAuditService } from '../src/services/auditService.js';
import { Writable } from 'node:stream';
let hidden = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!hidden) process.stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
async function secret(prompt) {
  process.stdout.write(prompt);
  hidden = true;
  try { return await rl.question(''); }
  finally { hidden = false; process.stdout.write('\n'); }
}
try {
  const username = (await rl.question('Admin username: ')).trim();
  const password = await secret('New password (at least 12 characters; input hidden): ');
  const confirm = await secret('Confirm password: ');
  if (!/^[a-zA-Z0-9_.@-]{3,100}$/.test(username)) throw new Error('Use 3–100 letters, numbers, _, ., @ or - for username.');
  if (password !== confirm) throw new Error('Passwords must match.');
  const hash=await makePassword(password);
  const store=createAccessStore(fileURLToPath(new URL('../data/access.sqlite',import.meta.url)));
  try {
    store.transaction(()=>{
      const role=store.get("SELECT id FROM roles WHERE code='super_admin'");
      const existing=store.get('SELECT id FROM users WHERE username=?',username);
      let id=existing?.id;
      if(id)store.run('UPDATE users SET password_hash=?,role_id=?,is_active=1,auth_version=auth_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',hash,role.id,id);
      else id=Number(store.run('INSERT INTO users(username,full_name,password_hash,role_id) VALUES(?,?,?,?)',username,username,hash,role.id).lastInsertRowid);
      store.run('DELETE FROM sessions WHERE user_id=?',id);
      createAuditService(store).record({id},'super_admin.recovery','security',{source:'local-cli'});
    });
  } finally {store.close();}
  console.log('Super Admin account saved. No SML or .env changes.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rl.close(); }
