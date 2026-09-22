import { randomBytes, createHash } from 'node:crypto';
import { newSecret, verifyTotp, otpauthUri, qrDataUrl, createSecretVault, base32 } from './totpService.js';
export const CHALLENGE_MS=10*60*1000,TRUST_MS=15*24*60*60*1000,RECOVERY_COUNT=10;
const digest=value=>createHash('sha256').update(value).digest('hex');
const normalizeRecovery=code=>String(code).replace(/[\s-]/g,'').toUpperCase();
const formatRecovery=raw=>raw.match(/.{4}/g).join('-');
// 2FA is mandatory for Super Admin; a Super Admin can also require it per account (user_two_factor_policy). AUTH_REQUIRE_2FA=false is a development/test escape hatch, never for production.
export function createTwoFactorService(store,audit,env=process.env) {
  const vault=createSecretVault(env,store.path),enforced=env.AUTH_REQUIRE_2FA!=='false';
  const isEnrolled=id=>!!store.get('SELECT 1 FROM user_totp WHERE user_id=?',id);
  const policyOn=id=>!!store.get('SELECT 1 FROM user_two_factor_policy WHERE user_id=? AND required=1',id);
  const service={
    // Super Admin is always required; any other account only when a Super Admin switched it on.
    required:user=>enforced&&(user.role==='super_admin'||policyOn(user.id)),
    policyOn,
    isEnrolled,
    // ---- challenge: password accepted, second step pending ----
    startChallenge(user) {
      const token=randomBytes(32).toString('hex'),enrolled=isEnrolled(user.id),secret=enrolled?null:newSecret();
      store.transaction(()=>{
        store.run('DELETE FROM login_challenges WHERE user_id=? OR expires<=?',user.id,Date.now());
        store.run('INSERT INTO login_challenges VALUES(?,?,?,?,?)',digest(token),user.id,enrolled?'verify':'setup',secret&&vault.seal(secret),Date.now()+CHALLENGE_MS);
      });
      if(enrolled)return {mode:'verify',challenge:token};
      const uri=otpauthUri(secret,user.username);
      return {mode:'setup',challenge:token,secret,otpauth:uri,qr:qrDataUrl(uri)};
    },
    challenge:token=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?store.get('SELECT * FROM login_challenges WHERE token_hash=? AND expires>?',digest(token),Date.now()):null,
    dropChallenge:token=>store.run('DELETE FROM login_challenges WHERE token_hash=?',digest(token)),
    // Verifies the code for a challenge. Returns {ok,method}; never throws for a bad code. Consumption of the challenge and the user_totp write happen in the caller's transaction via finish().
    check(challenge,code) {
      if(typeof code!=='string'||code.length>32)return {ok:false};
      if(/^\d{6}$/.test(code.trim())){
        if(challenge.kind==='setup'){const step=verifyTotp(vault.open(challenge.pending_secret_enc),code.trim());return step?{ok:true,method:'totp',step}:{ok:false};}
        const row=store.get('SELECT secret_enc,last_step FROM user_totp WHERE user_id=?',challenge.user_id);
        const step=row&&verifyTotp(vault.open(row.secret_enc),code.trim(),row.last_step);
        return step?{ok:true,method:'totp',step}:{ok:false};
      }
      if(challenge.kind==='verify'){
        const hash=digest('recovery:'+normalizeRecovery(code)),row=store.get('SELECT id FROM recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL',challenge.user_id,hash);
        return row?{ok:true,method:'recovery',recoveryId:row.id}:{ok:false};
      }
      return {ok:false};
    },
    // Applies a successful check. Returns false when a concurrent request already used the same OTP step or recovery code (single use).
    consume(challenge,result) {
      const id=challenge.user_id;
      if(result.method==='recovery')return store.run('UPDATE recovery_codes SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL',result.recoveryId).changes===1;
      if(challenge.kind==='setup'){store.run('INSERT OR REPLACE INTO user_totp(user_id,secret_enc,last_step) VALUES(?,?,?)',id,challenge.pending_secret_enc,result.step);return true;}
      return store.run('UPDATE user_totp SET last_step=? WHERE user_id=? AND last_step<?',result.step,id,result.step).changes===1;
    },
    // ---- recovery codes: 80-bit random values, only their SHA-256 is stored, each works once ----
    regenerateRecoveryCodes(userId) {
      const codes=Array.from({length:RECOVERY_COUNT},()=>formatRecovery(base32(randomBytes(10))));
      store.run('DELETE FROM recovery_codes WHERE user_id=?',userId);
      for(const code of codes)store.run('INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?)',userId,digest('recovery:'+normalizeRecovery(code)));
      return codes;
    },
    recoveryRemaining:userId=>store.get('SELECT COUNT(*) n FROM recovery_codes WHERE user_id=? AND used_at IS NULL',userId).n,
    // ---- trusted devices: opaque random token in an httpOnly cookie, SHA-256 in the database ----
    addTrusted(userId) {
      const token=randomBytes(32).toString('hex'),now=Date.now();
      store.run('DELETE FROM trusted_devices WHERE expires<=?',now);
      store.run('INSERT INTO trusted_devices VALUES(?,?,?,?)',digest(token),userId,now,now+TRUST_MS);
      return token;
    },
    // A trusted device only skips the OTP for an account that has an authenticator enrolled; an un-enrolled account must always go through setup.
    isTrusted:(userId,token)=>!!token&&/^[a-f0-9]{64}$/.test(token)&&isEnrolled(userId)&&!!store.get('SELECT 1 FROM trusted_devices WHERE token_hash=? AND user_id=? AND expires>?',digest(token),userId,Date.now()),
    trustedCount:userId=>store.get('SELECT COUNT(*) n FROM trusted_devices WHERE user_id=? AND expires>?',userId,Date.now()).n,
    // Call inside a transaction on password change/reset, 2FA reset, logout-all and admin revoke. Returns how many devices were removed.
    revokeTrusted(userId) {
      const n=store.run('DELETE FROM trusted_devices WHERE user_id=?',userId).changes;
      store.run('DELETE FROM login_challenges WHERE user_id=?',userId);
      return n;
    },
    reset(userId) {service.revokeTrusted(userId);store.run('DELETE FROM user_totp WHERE user_id=?',userId);store.run('DELETE FROM recovery_codes WHERE user_id=?',userId);},
  };
  return service;
}
