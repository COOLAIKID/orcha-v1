<##
Keeps the local Orcha API and dedicated WSL worker available after login.

This is a narrow process supervisor for the PC pilot. It only probes the
named Orcha API port and the named orcha-worker distro, and it only invokes
the existing Orcha start scripts when one of those services is unavailable.
It does not kill an unknown process that owns the API port and it cannot keep
the company running while Windows is logged out, asleep, or powered off.
##>
[CmdletBinding()]
param(
  [string]$DistroName = 'orcha-worker',
  [string]$EnvironmentFile = '',
  [int]$ApiPort = 8080,
  [ValidateRange(5, 300)]
  [int]$CheckIntervalSeconds = 15,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$wslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$originalPath = $env:PATH
# Only the named WSL distro is probed. Do not ask WSL to translate the host's
# agent/tool PATH on every supervisor health pass.
$env:PATH = ''
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $root 'orcha.local.env' }
$workerScript = Join-Path $PSScriptRoot 'start-orcha-worker.ps1'
$apiScript = Join-Path $PSScriptRoot 'start-orcha-api.ps1'
$logDir = Join-Path $root 'var\logs'
$logFile = Join-Path $logDir 'orcha-supervisor.log'
$apiPidFile = Join-Path $root "var\orcha-api-$ApiPort.pid"
$lastReady = $null
$script:apiReadinessFailures = 0

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-SupervisorLog {
  param([Parameter(Mandatory)][string]$Message)
  $line = "{0:u} {1}" -f (Get-Date).ToUniversalTime(), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
}

function Test-WorkerReady {
  & $wslExe -d $DistroName -u orcha -- /opt/orcha/.venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3).read()" 1>$null 2>$null
  return $LASTEXITCODE -eq 0
}

function Test-ApiReady {
  for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/health/ready" -TimeoutSec 3
      if ($health.status -eq 'ready') {
        $script:apiReadinessFailures = 0
        return $true
      }
    } catch {
      # /health/ready can briefly return 503 while a bounded WSL health refresh
      # transitions from starting to ready. Retry before declaring the API bad.
    }
    if ($attempt -lt 2) { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

function Test-ApiLiveness {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$ApiPort/health" -TimeoutSec 3
    return $health.status -eq 'ok'
  } catch {
    return $false
  }
}

function Test-ApiPortOccupied {
  return [bool](Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue)
}

function Get-OwnedApiProcess {
  if (-not (Test-Path -LiteralPath $apiPidFile)) { return $null }
  $apiPid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $apiPidFile -Raw).Trim(), [ref]$apiPid)) { return $null }
  if ($apiPid -le 0) { return $null }
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $apiPid" -ErrorAction Stop
    if (-not $process) { return $null }
    # The PID file alone is not an ownership proof. Require both the active
    # Orcha module and this exact repository root before restarting anything.
    if ($process.CommandLine -notlike '*orcha.api.app*' -or $process.CommandLine -notlike "*$root*") { return $null }
    return $process
  } catch {
    Write-SupervisorLog 'Could not verify API process ownership; refusing to restart the occupied port.'
    return $null
  }
}

function Test-DistroInstalled {
  $installed = @(& $wslExe --list --quiet 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  return $installed -contains $DistroName
}

function Ensure-Worker {
  if (Test-WorkerReady) { return $true }
  Write-SupervisorLog 'Worker is not ready; invoking the dedicated worker start script.'
  try {
    & $workerScript -DistroName $DistroName -EnvironmentFile $EnvironmentFile | Out-Null
    if (Test-WorkerReady) {
      Write-SupervisorLog 'Worker recovered.'
      return $true
    }
    Write-SupervisorLog 'Worker start script returned, but the health probe is still offline.'
  } catch {
    Write-SupervisorLog 'Worker recovery attempt failed.'
  }
  return $false
}

function Ensure-Api {
  if (Test-ApiReady) { return $true }
  if (Test-ApiPortOccupied) {
    if (Test-ApiLiveness) {
      # A live API may be waiting for the worker refresh or scheduler startup.
      # Do not restart it on one readiness 503; require three consecutive
      # failed passes (about 45 seconds at the default interval) first.
      $script:apiReadinessFailures += 1
      if ($script:apiReadinessFailures -lt 3) {
        Write-SupervisorLog "API liveness is healthy while readiness is transitioning; leaving the verified process running (pass $script:apiReadinessFailures/3)."
        return $false
      }
      Write-SupervisorLog 'API liveness is healthy but readiness stayed unavailable across three supervisor passes; attempting verified API recovery.'
    }
    $script:apiReadinessFailures = 0
    $owned = Get-OwnedApiProcess
    if (-not $owned) {
      Write-SupervisorLog "API readiness is unavailable, but port $ApiPort is occupied by an unverified process; refusing to terminate it."
      return $false
    }
    Write-SupervisorLog "API readiness is unavailable; restarting the verified Orcha API process $($owned.ProcessId)."
    try {
      Stop-Process -Id ([int]$owned.ProcessId) -ErrorAction Stop
      Remove-Item -LiteralPath $apiPidFile -Force -ErrorAction SilentlyContinue
      for ($attempt = 0; $attempt -lt 20 -and (Test-ApiPortOccupied); $attempt += 1) {
        Start-Sleep -Milliseconds 250
      }
    } catch {
      Write-SupervisorLog 'Verified API restart failed; leaving the process state unchanged.'
      return $false
    }
  }
  Write-SupervisorLog 'API is not ready; invoking the dedicated API start script.'
  try {
    & $apiScript -EnvironmentFile $EnvironmentFile -Port $ApiPort | Out-Null
    if (Test-ApiReady) {
      Write-SupervisorLog 'API recovered.'
      return $true
    }
    Write-SupervisorLog 'API start script returned, but the health probe is still offline.'
  } catch {
    Write-SupervisorLog 'API recovery attempt failed.'
  }
  return $false
}

function Test-AndRepair {
  if (-not (Test-DistroInstalled)) {
    Write-SupervisorLog "WSL distro '$DistroName' is not installed; waiting without starting any other process."
    return $false
  }
  $workerReady = Ensure-Worker
  if (-not $workerReady) {
    Write-SupervisorLog 'Worker is not ready; deferring API recovery until the execution boundary is available.'
    return $false
  }
  $apiReady = Ensure-Api
  return $workerReady -and $apiReady
}

do {
  try {
    $ready = Test-AndRepair
  } catch {
    Write-SupervisorLog 'Supervisor health pass failed unexpectedly; it will retry.'
    $ready = $false
  }
  if ($null -eq $lastReady -or $lastReady -ne $ready) {
    Write-SupervisorLog $(if ($ready) { 'Local runtime is ready.' } else { 'Local runtime is not ready.' })
    $lastReady = $ready
  }
  if ($Once) {
    if ($ready) { exit 0 }
    exit 1
  }
  Start-Sleep -Seconds $CheckIntervalSeconds
} while ($true)
