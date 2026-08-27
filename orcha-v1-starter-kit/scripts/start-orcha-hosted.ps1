[CmdletBinding()]
param(
  [string]$EnvironmentFile = '',
  [switch]$NoBuild,
  [ValidateRange(5, 180)]
  [int]$ReadyTimeoutSeconds = 60
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
  if (Test-Path -LiteralPath $defaultEnv) {
    $envArgs = @('--env-file', $defaultEnv)
  }
}

function Invoke-Compose {
  param([string[]]$Arguments)
  & $docker @('compose') @envArgs @composeFiles @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed with exit code $LASTEXITCODE." }
}

try {
  & $docker info --format '{{.ServerVersion}}' 1>$null 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Engine is unavailable. Start Docker Desktop or the host Docker service, then retry.'
  }

  # Compose interpolation enforces the required worker secret for this profile;
  # validate without printing resolved environment or secret values.
  Invoke-Compose @('config', '--quiet')
  $up = @('up', '-d')
  if (-not $NoBuild) { $up += '--build' }
  Invoke-Compose $up

  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $cockpitReady = $false
  $apiReady = $false
  do {
    try {
      $cockpit = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 3
      $cockpitReady = $cockpit.StatusCode -eq 200
    } catch { $cockpitReady = $false }
    try {
      $api = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/health/ready' -TimeoutSec 3
      $apiReady = $api.StatusCode -eq 200
    } catch { $apiReady = $false }
    if ($cockpitReady -and $apiReady) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  if (-not ($cockpitReady -and $apiReady)) {
    throw 'Hosted services did not become ready before the timeout. Inspect `docker compose ps` and service logs.'
  }
  Write-Host 'Hosted Orcha ready: cockpit http://127.0.0.1:3000 · API readiness verified.'
  Write-Host 'Use the scoped stop script to shut it down without deleting durable volumes.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
