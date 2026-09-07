param(
    [switch]$SkipInstall,
    [switch]$SkipTests,
    [switch]$VerifyDesktop
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previousOutput = $env:ATELIER_PACKAGE_OUT
$previousExecutable = $env:ATELIER_DESKTOP_EXE
$releaseLock = $null

function Invoke-NpmStep([string[]]$Arguments)
{
    & npm.cmd @Arguments
    if ($LASTEXITCODE -ne 0) { throw "npm $($Arguments -join ' ') failed (exit $LASTEXITCODE)." }
}

Push-Location -LiteralPath $projectRoot
try
{
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24+ first.' }
    $nodeMajor = [int](& node.exe -p "process.versions.node.split('.')[0]")
    if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 24) { throw 'Packaging checks require Node.js 24+.' }
    $releaseRoot = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    # A crash releases the handle; the empty lock file may safely remain.
    $releaseLock = [System.IO.File]::Open((Join-Path $releaseRoot '.package.lock'),
        [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)

    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    if ($package.version -notmatch '^[0-9A-Za-z.+-]+$') { throw 'Invalid package version.' }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
    $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $buildName = "fuse-beads-ms-$($package.version)-win-x64-$stamp-$suffix"
    $buildRoot = Join-Path $releaseRoot "builds\$buildName"
    $env:ATELIER_PACKAGE_OUT = $buildRoot
    $env:ATELIER_DESKTOP_EXE = Join-Path $buildRoot 'Fuse Beads MS-win32-x64\FuseBeadsMS.exe'

    if (-not $SkipInstall) { Invoke-NpmStep -Arguments @('ci') }
    if (-not $SkipTests) { Invoke-NpmStep -Arguments @('test') }
    Invoke-NpmStep -Arguments @('run', 'desktop:package')
    if (-not (Test-Path -LiteralPath $env:ATELIER_DESKTOP_EXE -PathType Leaf)) { throw 'Packaged executable is missing.' }
    if ($VerifyDesktop) { Invoke-NpmStep -Arguments @('run', 'selfcheck:desktop') }

    $revision = $null
    $dirty = $null
    if (Get-Command git.exe -ErrorAction SilentlyContinue)
    {
        $revision = & git.exe rev-parse HEAD
        if ($LASTEXITCODE -ne 0) { throw 'Could not read Git revision.' }
        $changes = & git.exe status --porcelain
        if ($LASTEXITCODE -ne 0) { throw 'Could not read Git status.' }
        $dirty = -not [string]::IsNullOrWhiteSpace(($changes -join "`n"))
    }
    $manifest = [ordered]@{
        name = $package.name
        version = $package.version
        platform = 'win32-x64'
        builtAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        gitRevision = $revision
        workingTreeDirty = $dirty
        node = (& node.exe --version)
        electron = $package.devDependencies.electron
        unitTests = $(if ($SkipTests) { 'skipped' } else { 'passed' })
        desktopSelfcheck = $(if ($VerifyDesktop) { 'passed' } else { 'not-run' })
        signed = $false
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $appRoot = Split-Path -Parent $env:ATELIER_DESKTOP_EXE
    $manifestText = $manifest | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $appRoot 'build-info.json'), $manifestText, $utf8)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archivePath = Join-Path $releaseRoot "$buildName.zip"
    $pendingArchive = "$archivePath.partial"
    [System.IO.Compression.ZipFile]::CreateFromDirectory($appRoot, $pendingArchive,
        [System.IO.Compression.CompressionLevel]::Optimal, $true)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $archiveStream = [System.IO.File]::OpenRead($pendingArchive)
    try
    {
        $checksum = [System.BitConverter]::ToString($hasher.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant()
    }
    finally
    {
        $archiveStream.Dispose()
        $hasher.Dispose()
    }
    [System.IO.File]::WriteAllText("$archivePath.sha256", "$checksum  $buildName.zip`n", $utf8)
    [System.IO.File]::WriteAllText((Join-Path $releaseRoot "$buildName.json"), $manifestText, $utf8)
    Move-Item -LiteralPath $pendingArchive -Destination $archivePath
    Write-Host "Release ready: $archivePath"
    Write-Host "SHA256: $checksum"
    Write-Host "Executable: $env:ATELIER_DESKTOP_EXE"
}
finally
{
    $env:ATELIER_PACKAGE_OUT = $previousOutput
    $env:ATELIER_DESKTOP_EXE = $previousExecutable
    if ($null -ne $releaseLock) { $releaseLock.Dispose() }
    Pop-Location
}
