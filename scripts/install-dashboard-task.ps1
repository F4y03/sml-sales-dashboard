# Registers the "SML Dashboard" scheduled task: runs server.js as SYSTEM at startup,
# restarts on failure, logs to logs\server.log. Run in an elevated PowerShell.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force (Join-Path $repo 'logs') | Out-Null

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$node`" --env-file=.env server.js >> logs\server.log 2>&1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName 'SML Dashboard' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered 'SML Dashboard' (node: $node, dir: $repo)"
