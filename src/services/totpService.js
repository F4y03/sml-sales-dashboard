import { createHmac, createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import qrcode from 'qrcode-generator';
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',STEP=30,DIGITS=6;
export const base32=buf=>{let bits='',out='';for(const b of buf)bits+=b.toString(2).padStart(8,'0');for(let i=0;i<bits.length;i+=5)out+=B32[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];return out;};
const unbase32=text=>{let bits='';for(const c of text)bits+=B32.indexOf(c).toString(2).padStart(5,'0');return Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));};
export const newSecret=()=>base32(randomBytes(20));
const hotp=(secret,counter)=>{
  const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(counter));
  const h=createHmac('sha1',unbase32(secret)).update(msg).digest(),o=h[19]&15;
  return String((h.readUInt32BE(o)&0x7fffffff)%10**DIGITS).padStart(DIGITS,'0');
};
export const totpAt=(secret,now=Date.now())=>hotp(secret,Math.floor(now/1000/STEP));
// Accepts the current step and one step either side (clock drift). Returns the matched step, or 0. Steps <= lastStep are refused so a code cannot be replayed.
export function verifyTotp(secret,code,lastStep=0,now=Date.now()) {
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return 0;
  const current=Math.floor(now/1000/STEP);let found=0;
  for(const step of [current-1,current,current+1]){
    const a=Buffer.from(hotp(secret,step)),b=Buffer.from(code);
    if(timingSafeEqual(a,b)&&step>lastStep)found=step;
  }
  return found;
}
export const otpauthUri=(secret,account,issuer='PR PLUS')=>`otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
export function qrDataUrl(text) {
  const q=qrcode(0,'M');q.addData(text);q.make();
  return 'data:image/svg+xml;base64,'+Buffer.from(q.createSvgTag({cellSize:5,margin:2,scalable:true})).toString('base64');
}
// TOTP secrets must be readable again, so they are encrypted at rest (AES-256-GCM). Key: AUTH_2FA_KEY, else data/2fa.key next to the database (git-ignored), else per-process (in-memory test stores).
export function createSecretVault(env,dbPath) {
  let key;
  if(env.AUTH_2FA_KEY)key=createHash('sha256').update(env.AUTH_2FA_KEY).digest();
  else if(dbPath&&dbPath!==':memory:'){
    const file=join(dirname(dbPath),'2fa.key');
    try{key=Buffer.from(readFileSync(file,'utf8').trim(),'hex');}catch{}
    if(key?.length!==32){key=randomBytes(32);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,key.toString('hex'),{mode:0o600});}
  }else key=randomBytes(32);
  return {
    seal(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(text,'utf8'),c.final()]);return [iv,c.getAuthTag(),body].map(x=>x.toString('base64')).join('.');},
    open(sealed){const [iv,tag,body]=sealed.split('.').map(x=>Buffer.from(x,'base64')),d=createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);return Buffer.concat([d.update(body),d.final()]).toString('utf8');},
  };
}
