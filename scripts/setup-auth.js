import { createInterface } from 'node:readline/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { hashPassword } from '../auth.js';
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
  if (password.length < 12 || password.length > 1024 || password !== confirm) throw new Error('Passwords must match and contain 12–1024 characters.');
  const path = new URL('../.env', import.meta.url);
  let env = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  env = env.split(/\r?\n/).filter(line => !/^AUTH_(USERNAME|PASSWORD_HASH)=/.test(line)).join('\n').trimEnd();
  await writeFile(path, `${env}\nAUTH_USERNAME=${username}\nAUTH_PASSWORD_HASH=${await hashPassword(password)}\n`, { mode: 0o600 });
  console.log('Account saved. Restart the server to activate it.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { rl.close(); }
