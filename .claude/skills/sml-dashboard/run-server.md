# Run / restart the server

## Facts
- Start: `npm start` (= `node --env-file=.env server.js`), port from `.env` `PORT` (default 3000). No file watcher — **every server-side change needs a restart.** Static files in `public/` only need Ctrl+F5.
- App DB: `data/access.sqlite` (users, roles, territories, sessions, trusted devices, activity log). Migrations in `migrations/` + `src/models/accessStore.js` run on every start; new columns must be added idempotently (check `pragma_table_info` first).
- `sahakhun.vrtunnel.net` is served from **another machine** with its own DB. Changes there need commit → push → pull on that machine → restart. You cannot restart it from here.

## Production on SKISERVER (this machine)
- Runs as scheduled task **"SML Dashboard"** (SYSTEM, at startup, auto-restart), HTTPS via `TLS_CERT_FILE`/`TLS_KEY_FILE`, log in `logs\server.log`.
- Public URL `https://dashboard.sksales.app` via the `cloudflared` Windows service (route: HTTPS `127.0.0.1:3000`, No TLS Verify).
- Restart: admin `schtasks /End /TN "SML Dashboard"` then `schtasks /Run /TN "SML Dashboard"`. Update from Git: `scripts\update-dashboard.ps1` (admin). Do not start a second `node server.js` by hand — port 3000 will conflict.

## Restart locally (Windows PowerShell, dev machines without the task)
```powershell
$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) { Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" | Select-Object ProcessId,CreationDate,CommandLine }
```
1. Confirm the listener is `node --env-file=.env server.js` from this repo and its `CreationDate` is older than your change.
2. Stop it and start again:
```powershell
Stop-Process -Id $c.OwningProcess -Force -Confirm:$false
Start-Process node -ArgumentList '--env-file=.env','server.js' -WorkingDirectory (Get-Location) -WindowStyle Hidden
```
3. Verify port 3000 listens again with a new PID. Tell the user it now runs in a hidden window.

## SML tunnel
- Queries to SML hang (no error) when the tunnel is down. Don't wait past ~30 s: stop the task and ask the user to run `scripts/start-sml-tunnel.ps1` in a window they keep open.
- One-off read queries: create a pool with `options:'-c default_transaction_read_only=on'` (see `tools/inspect-sml-columns.mjs`), put scratch scripts in the session scratchpad, not the repo.
