[CmdletBinding()]
param(
  [string]$DistroName = 'orcha-worker',
  [int]$ApiPort = 8080,
  [string]$EnvironmentFile = ''
)

$ErrorActionPreference = 'Stop'
$apiScript = Join-Path $PSScriptRoot 'stop-orcha-api.ps1'
$workerScript = Join-Path $PSScriptRoot 'stop-orcha-worker.ps1'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $root 'orcha.local.env' }
$errors = @()

try {
  & $apiScript -Port $ApiPort
} catch {
  $errors += $_.Exception.Message
}

try {
  & $workerScript -DistroName $DistroName -EnvironmentFile $EnvironmentFile
} catch {
  $errors += $_.Exception.Message
}

if ($errors.Count -gt 0) {
  throw ($errors -join ' ')
}

Write-Host "Orcha local runtime stopped: API port $ApiPort and worker $DistroName."
