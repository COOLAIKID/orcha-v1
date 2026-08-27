[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path '..\outputs\orcha-v1-starter-kit-2026-08-27.zip')
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$archivePath = [IO.Path]::GetFullPath($OutputPath)
$archiveDirectory = Split-Path -Parent $archivePath
$stage = Join-Path $env:TEMP ('orcha-release-' + [guid]::NewGuid().ToString('N'))
$temporaryArchive = $archivePath + '.' + $PID + '.tmp'
$skipDirectories = @('.venv', '.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache', '.cache', 'node_modules', 'var', '.git', '_channel-archive', 'dist')
$skipNames = @('.crew-watch-state.json')

function Copy-ReleaseTree([string]$currentPath, [string]$relativePath) {
    foreach ($item in @(Get-ChildItem -LiteralPath $currentPath -Force -ErrorAction SilentlyContinue)) {
        if ($item.PSIsContainer) {
            if ($skipDirectories -contains $item.Name) { continue }
            $childRelative = if ($relativePath) { Join-Path $relativePath $item.Name } else { $item.Name }
            New-Item -ItemType Directory -Force -Path (Join-Path $stage $childRelative) | Out-Null
            Copy-ReleaseTree $item.FullName $childRelative
            continue
        }

        if ($skipNames -contains $item.Name -or
            $item.Name -like '*.env' -or
            $item.Name -like '*.db' -or
            $item.Name -like '*.log' -or
            $item.Name -like '*.pid' -or
            $item.Name -like '*.zip' -or
            $item.Name -like '*.png' -or
            $item.Name -like '*.pyc' -or
            $item.Name -like '*.pyo' -or
            $item.Name -eq '.coverage' -or
            $item.Name -like '*.tsbuildinfo') { continue }

        $targetRelative = if ($relativePath) { Join-Path $relativePath $item.Name } else { $item.Name }
        $targetPath = Join-Path $stage $targetRelative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null
        Copy-Item -LiteralPath $item.FullName -Destination $targetPath -Force
    }
}

try {
    New-Item -ItemType Directory -Force -Path $archiveDirectory, $stage | Out-Null
    Copy-ReleaseTree $sourceRoot ''
    if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive -Force }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $temporaryArchive -CompressionLevel Optimal
    Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $names = @($archive.Entries | ForEach-Object FullName)
    } finally {
        $archive.Dispose()
    }

    $unexpected = @($names | Where-Object {
        $_ -match '(^|/)\.env$' -or
        $_ -match '(^|/)(var|node_modules|\.venv|\.git|dist|_channel-archive)/' -or
        $_ -match '(^|/)(\.pytest_cache|__pycache__|\.mypy_cache|\.ruff_cache|\.cache)/' -or
        $_ -match '(\.db|\.log|\.pid|\.zip|\.png|\.pyc|\.pyo|\.tsbuildinfo)$' -or
        $_ -match '(^|/)(\.coverage)$' -or
        $_ -eq '.crew-watch-state.json'
    })
    if ($unexpected.Count -gt 0) {
        throw "Release archive contains excluded paths: $($unexpected -join ', ')"
    }

    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    [pscustomobject]@{
        path = $archivePath
        bytes = (Get-Item -LiteralPath $archivePath).Length
        entries = $names.Count
        sha256 = $hash
        excludedEntriesFound = 0
    } | ConvertTo-Json -Compress
} finally {
    if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
