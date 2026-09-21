import bcrypt from 'bcryptjs';
import { scrypt as scryptCallback,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCallback);
const COMMON=new Set(['password','passw0rd','p@ssw0rd','p@ssword1','password1','password12','password123','12345678','123456789','1234567890','12341234','11111111','00000000','qwerty123','qwertyui','qwerty12','abc12345','abcd1234','iloveyou1','admin123','admin1234','administrator1','welcome1','welcome123','letmein1','changeme1','changeme123','test1234','user1234','pr plus123','prplus123','prplus1234','sml12345','sml123456']);
const bad=message=>Object.assign(new Error(message),{status:400});
// Only 72 bytes are significant to bcrypt, so longer values are refused instead of silently truncated.
function checkLength(password) {
  if(typeof password!=='string'||password.length===0||Buffer.byteLength(password,'utf8')>72) throw bad('กรุณาระบุรหัสผ่าน และต้องไม่เกิน 72 bytes');
}
const sequential=value=>{const s=value.toLowerCase();return s.length>=8&&[...s].every((c,i)=>i===0||Math.abs(c.charCodeAt(0)-s.charCodeAt(i-1))===1&&/[a-z0-9]/.test(c));};
// Policy for NEW, changed or reset passwords only. Existing stored passwords are never re-checked against it.
export function validatePassword(password,{username=''}={}) {
  checkLength(password);
  if(password.length<8) throw bad('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if(!/\p{L}/u.test(password)||!/[0-9]/.test(password)) throw bad('รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว และตัวเลขอย่างน้อย 1 ตัว');
  const lower=password.toLowerCase(),name=String(username).trim().toLowerCase();
  if(COMMON.has(lower)||new Set(password).size<4||/^(.{1,3})\1+$/su.test(password)||sequential(password)||(name.length>=3&&lower.includes(name))) throw bad('รหัสผ่านเดาง่ายเกินไป กรุณาเลือกรหัสผ่านอื่น');
}
// hashOnly skips the policy so a legacy password can be upgraded to bcrypt without changing it.
export async function hashOnly(password) {checkLength(password);return bcrypt.hash(password,12);}
export async function makePassword(password,options) {validatePassword(password,options);return hashOnly(password);}
export const isModernHash=hash=>/^\$2[aby]\$/.test(hash||'');
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export async function verifyPassword(password,hash) {
  if(typeof password!=='string'||password.length>1024||typeof hash!=='string'||!hash)return false;
  if(isModernHash(hash)) return Buffer.byteLength(password,'utf8')<=72 && bcrypt.compare(password,hash);
  if(/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) {
    const [salt,expected]=hash.split(':');return timingSafeEqual(await scrypt(password,salt,64),Buffer.from(expected,'hex'));
  }
  // Anything else is a legacy plain-text value; the caller rewrites it as bcrypt after a successful login.
  return safeEqual(password,hash);
}
