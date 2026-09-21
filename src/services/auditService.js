// Defence in depth: whatever a caller passes, values stored under password/OTP/secret/token/recovery-style keys never reach the log.
const SENSITIVE=/pass(word|wd)?|otp|secret|token|recovery|hash|cookie/i;
const redact=(key,value)=>key&&SENSITIVE.test(key)?undefined:value;
export function createAuditService(store) {
  return { record(actor,action,module,details={},territoryId=null,ip=null) {
    store.run('INSERT INTO activity_logs(user_id,action,module,territory_id,ip_address,details) VALUES(?,?,?,?,?,?)',actor?.id ?? null,action,module,territoryId,ip,JSON.stringify(details,redact));
  }, list(before=Number.MAX_SAFE_INTEGER) {
    const users=new Map(store.all('SELECT id,username,full_name FROM users').map(user=>[Number(user.id),user]));
    return store.all('SELECT l.*,u.username FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.id<? ORDER BY l.id DESC LIMIT 100',before).map(row=>{
      const details=JSON.parse(row.details),targetUser=Number.isInteger(Number(details.userId))?users.get(Number(details.userId))||null:null;
      return {...row,details,targetUser};
    });
  } };
}
