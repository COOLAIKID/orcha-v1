[CmdletBinding()]
param(
  [string]$EnvironmentFile = ''
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$docker = (Get-Command docker -ErrorAction Stop).Source
$composeFiles = @('-f', (Join-Path $root 'infra\docker-compose.yml'), '-f', (Join-Path $root 'infra\docker-compose.hosted.yml'))
$envArgs = @()

if ($EnvironmentFile) {
  $resolvedEnv = (Resolve-Path -LiteralPath $EnvironmentFile -ErrorAction Stop).Path
  $envArgs = @('--env-file', $resolvedEnv)
} else {
  $defaultEnv = Join-Path $root '.env'
  if (Test-Path -LiteralPath $defaultEnv) { $envArgs = @('--env-file', $defaultEnv) }
}

& $docker @('compose') @envArgs @composeFiles @('down')
if ($LASTEXITCODE -ne 0) { throw "Docker Compose shutdown failed with exit code $LASTEXITCODE." }
Write-Host 'Hosted Orcha stopped. Durable named volumes were retained.'
