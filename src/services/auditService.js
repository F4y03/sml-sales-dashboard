export function createAuditService(store) {
  return { record(actor,action,module,details={},territoryId=null,ip=null) {
    store.run('INSERT INTO activity_logs(user_id,action,module,territory_id,ip_address,details) VALUES(?,?,?,?,?,?)',actor?.id ?? null,action,module,territoryId,ip,JSON.stringify(details));
  }, list(before=Number.MAX_SAFE_INTEGER) { return store.all('SELECT l.*,u.username FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.id<? ORDER BY l.id DESC LIMIT 100',before).map(x=>({...x,details:JSON.parse(x.details)})); } };
}
