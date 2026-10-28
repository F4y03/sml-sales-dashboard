// The signed-in user's own activity (any role, incl. the read-only reviewer). Only their rows, newest first, no details
// payload (it can name other records); admins keep the full log in System Admin › Activity Log.
export function installSelfRoutes(app, store) {
  app.get('/api/me/activity', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const before = Number(req.query.before);
    const rows = store.all(`SELECT id, created_at AS at, action, module, ip_address AS ip FROM activity_logs
      WHERE user_id=? ${Number.isSafeInteger(before) && before > 0 ? 'AND id<?' : ''} ORDER BY id DESC LIMIT 100`,
      ...[req.auth.id, ...(Number.isSafeInteger(before) && before > 0 ? [before] : [])]);
    res.json({ rows, more: rows.length === 100 ? rows.at(-1).id : null });
  });
}
