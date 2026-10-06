# Pull the latest code and restart the "SML Dashboard" scheduled task.
# Run from an Administrator PowerShell: powershell -ExecutionPolicy Bypass -File scripts\update-dashboard.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (git status --porcelain --untracked-files=no) {
    throw 'Uncommitted changes in tracked files. Commit or stash them before updating.'
}
$before = git rev-parse HEAD
git pull --ff-only
if ($LASTEXITCODE) { throw 'git pull failed' }
if (git diff --name-only $before HEAD -- package.json package-lock.json) {
    npm install --omit=dev
    if ($LASTEXITCODE) { throw 'npm install failed' }
}

schtasks /End /TN 'SML Dashboard' | Out-Null
$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) { Stop-Process -Id $c.OwningProcess -Force -Confirm:$false }
Start-Sleep 2
schtasks /Run /TN 'SML Dashboard' | Out-Null
Start-Sleep 8
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Dashboard restarted at $(git log -1 --format='%h %s')"
} else {
    throw 'Dashboard did not start. See logs\server.log'
}
