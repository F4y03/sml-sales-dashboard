// Defence in depth: whatever a caller passes, values stored under password/OTP/secret/token/recovery-style keys never reach the log.
const SENSITIVE=/pass(word|wd)?|otp|secret|token|recovery|hash|cookie/i;
const redact=(key,value)=>key&&SENSITIVE.test(key)?undefined:value;
export function createAuditService(store) {
  return { record(actor,action,module,details={},territoryId=null,ip=null) {
    store.run('INSERT INTO activity_logs(user_id,action,module,territory_id,ip_address,details) VALUES(?,?,?,?,?,?)',actor?.id ?? null,action,module,territoryId,ip,JSON.stringify(details,redact));
  }, list(before=Number.MAX_SAFE_INTEGER,salesOnly=false) {
    const users=new Map(store.all('SELECT id,username,full_name FROM users').map(user=>[Number(user.id),user]));
    // Sales = accounts whose role is territory-scoped.
    const sales=salesOnly?" AND u.role_id IN (SELECT id FROM roles WHERE scope='territory')":'';
    return store.all(`SELECT l.*,u.username FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.id<?${sales} ORDER BY l.id DESC LIMIT 100`,before).map(row=>{
      const details=JSON.parse(row.details),targetUser=Number.isInteger(Number(details.userId))?users.get(Number(details.userId))||null:null;
      return {...row,details,targetUser};
    });
  }, usage(days=30) {
    // Sessions last 8 hours, so successful logins approximate how often each user works in the system.
    // Active days are counted on the Thai calendar (created_at is stored as UTC).
    return store.all(`SELECT u.id,u.username,u.full_name,u.is_active,r.code AS role,r.name AS role_name,r.scope,
        (SELECT group_concat(t.name,', ') FROM user_territories ut JOIN sales_territories t ON t.id=ut.territory_id WHERE ut.user_id=u.id) AS territories,
        COALESCE(SUM(l.action='login'),0) AS logins,
        COUNT(DISTINCT CASE WHEN l.action='login' THEN date(l.created_at,'+7 hours') END) AS active_days,
        COALESCE(SUM(l.action='login.failed'),0) AS failed,
        (SELECT MAX(created_at) FROM activity_logs WHERE user_id=u.id AND action='login') AS last_login
      FROM users u JOIN roles r ON r.id=u.role_id
      LEFT JOIN activity_logs l ON l.user_id=u.id AND l.action IN ('login','login.failed') AND l.created_at>=datetime('now',?)
      GROUP BY u.id ORDER BY active_days DESC,logins DESC,u.username`,`-${days} days`);
  } };
}
