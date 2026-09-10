$ErrorActionPreference = 'Stop'
$smlIdentity = Join-Path $env:USERPROFILE '.ssh\sml_dashboard_ed25519'
if (!(Test-Path -LiteralPath $smlIdentity)) {
    throw "SSH key not found: $smlIdentity"
}
Write-Host 'Starting SML tunnel on 127.0.0.1:15432. Keep this window open. Press Ctrl+C to stop.'
ssh -N -i $smlIdentity -L 127.0.0.1:15432:127.0.0.1:5432 -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 hp@192.168.1.225
exit $LASTEXITCODE
