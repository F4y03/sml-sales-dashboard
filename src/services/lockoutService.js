export const MAX_FAILURES=5,LOCK_MS=15*60*1000;
// Failure counters live in login_lockouts (per user). Unknown usernames never create rows, so nothing here reveals whether an account exists.
export function createLockoutService(store,audit) {
  const row=id=>store.get('SELECT failed_attempts,locked_until FROM login_lockouts WHERE user_id=?',id);
  return {
    isLocked:(id,now=Date.now())=>(row(id)?.locked_until||0)>now,
    // Returns true when this failure locks the account. Failures while already locked do not extend the lock.
    fail(user,ip,now=Date.now()) {
      return store.transaction(()=>{
        const cur=row(user.id);if((cur?.locked_until||0)>now)return false;
        const count=(cur&&cur.locked_until?0:cur?.failed_attempts||0)+1,locks=count>=MAX_FAILURES;
        store.run('INSERT INTO login_lockouts(user_id,failed_attempts,locked_until,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET failed_attempts=excluded.failed_attempts,locked_until=excluded.locked_until,updated_at=excluded.updated_at',user.id,locks?0:count,locks?now+LOCK_MS:0,now);
        if(locks)audit.record(user,'account.locked','auth',{userId:user.id,minutes:LOCK_MS/60000},null,ip);
        return locks;
      });
    },
    clear:id=>store.run('DELETE FROM login_lockouts WHERE user_id=?',id),
  };
}
