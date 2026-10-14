# Restarts the dashboard through the "SML Dashboard" scheduled task (SYSTEM).
# Self-elevates via UAC. Stops any node server.js holding the port first, including one started by hand.
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`""
  exit
}
$repo = Split-Path -Parent $PSScriptRoot
$port = 3000

schtasks /End /TN 'SML Dashboard' 2>$null | Out-Null
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'product-sheet' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }

for ($i = 0; $i -lt 10 -and (netstat -ano | Select-String ":$port .*LISTEN"); $i++) { Start-Sleep 1 }
schtasks /Run /TN 'SML Dashboard' | Out-Null

$listening = $null
for ($i = 0; $i -lt 30 -and -not $listening; $i++) { Start-Sleep 1; $listening = netstat -ano | Select-String ":$port .*LISTEN" }
if ($listening) { Write-Host "OK: dashboard is listening on port $port" -ForegroundColor Green; $listening }
else { Write-Host "FAILED: nothing listening on port $port. Last log lines:" -ForegroundColor Red; Get-Content (Join-Path $repo 'logs\server.log') -Tail 20 }
Read-Host 'Press Enter to close'
