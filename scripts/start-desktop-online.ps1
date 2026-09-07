param([string]$Server = 'https://101.132.62.222', [string]$Profile = 'online')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'release\Fuse Beads MS-win32-x64\FuseBeadsMS.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Run npm run desktop:package first.' }
if ($Server -notmatch '^https://') { throw 'An HTTPS server URL is required.' }
if ($Profile -notmatch '^[a-zA-Z0-9_-]{1,80}$') { throw 'Invalid profile name.' }
$previousServer = $env:ATELIER_MULTIPLAYER_URL
try
{
    $env:ATELIER_MULTIPLAYER_URL = $Server
    Start-Process -FilePath $executable -ArgumentList "--profile=$Profile" -WorkingDirectory (Split-Path -Parent $executable)
    Write-Host "Online client launched with profile: $Profile."
}
finally { $env:ATELIER_MULTIPLAYER_URL = $previousServer }
