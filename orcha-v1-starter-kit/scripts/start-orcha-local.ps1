[CmdletBinding()]
param(
  [string]$DistroName = 'orcha-worker',
  [string]$EnvironmentFile = '',
  [int]$ApiPort = 8080
)

$ErrorActionPreference = 'Stop'
$wslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$originalPath = $env:PATH
# The dedicated worker does not need host executables; keep WSL startup free
# from path-translation noise even when this wrapper launches both services.
$env:PATH = ''
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $root 'orcha.local.env' }
$workerScript = Join-Path $PSScriptRoot 'start-orcha-worker.ps1'
$apiScript = Join-Path $PSScriptRoot 'start-orcha-api.ps1'

try {
  if (-not (Test-Path -LiteralPath $workerScript)) { throw "Worker start script not found at $workerScript" }
  if (-not (Test-Path -LiteralPath $apiScript)) { throw "API start script not found at $apiScript" }

  $installedDistros = @(& $wslExe --list --quiet 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($installedDistros -notcontains $DistroName) {
    throw "WSL distro '$DistroName' is not installed. Run .\scripts\setup-orcha-worker.ps1 first."
  }

  Write-Host "Starting the dedicated $DistroName worker..."
  & $workerScript -DistroName $DistroName -EnvironmentFile $EnvironmentFile
  if ($LASTEXITCODE -ne 0) { throw "The $DistroName worker did not start." }

  Write-Host "Starting the Orcha API..."
  & $apiScript -EnvironmentFile $EnvironmentFile -Port $ApiPort
  if ($LASTEXITCODE -ne 0) { throw "The Orcha API did not start." }

  Write-Host "Orcha local runtime ready: worker 127.0.0.1:8765 · API 127.0.0.1:$ApiPort"
  Write-Host "Stop both with .\scripts\stop-orcha-local.ps1 -ApiPort $ApiPort -DistroName $DistroName"
} finally {
  $env:PATH = $originalPath
}
