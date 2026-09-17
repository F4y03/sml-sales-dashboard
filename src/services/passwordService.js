import bcrypt from 'bcryptjs';
import { scrypt as scryptCallback,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCallback);
export function validatePassword(password) {
  if(typeof password!=='string'||password.length<12||Buffer.byteLength(password,'utf8')>72) throw Object.assign(new Error('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร และไม่เกิน 72 bytes'),{status:400});
}
export async function makePassword(password) {validatePassword(password);return bcrypt.hash(password,12);}
export async function verifyPassword(password,hash) {
  if(typeof password!=='string'||password.length>1024)return false;
  if(/^\$2[aby]\$/.test(hash)) return Buffer.byteLength(password,'utf8')<=72 && bcrypt.compare(password,hash);
  if(/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) {
    const [salt,expected]=hash.split(':');return timingSafeEqual(await scrypt(password,salt,64),Buffer.from(expected,'hex'));
  }
  return false;
}
