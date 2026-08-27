<##
Keeps the complete local phone pilot available after login.

This is a narrow wrapper around start-orcha-pilot.ps1. The pilot launcher
already owns the safety checks for the API, Vite, and managed Quick Tunnel;
this watcher simply retries that launcher when one of those services is gone.
It cannot keep the runtime alive while Windows is logged out, asleep, or
powered off, and it never terminates an unverified process.
##>
[CmdletBinding()]
param(
  [string]$DistroName = 'orcha-worker',
  [string]$EnvironmentFile = '',
  [int]$ApiPort = 8080,
  [int]$UiPort = 5175,
  [string]$NpmPath = '',
  [ValidateRange(5, 300)]
  [int]$CheckIntervalSeconds = 30,
  [ValidateRange(5, 180)]
  [int]$ReadyTimeoutSeconds = 30,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pilotScript = Join-Path $PSScriptRoot 'start-orcha-pilot.ps1'
$logDir = Join-Path $root 'var\logs'
$logFile = Join-Path $logDir 'orcha-pilot-supervisor.log'
$passStdout = Join-Path $logDir 'orcha-pilot-pass.out.log'
$passStderr = Join-Path $logDir 'orcha-pilot-pass.err.log'

if (-not (Test-Path -LiteralPath $pilotScript)) {
  throw "Pilot launcher not found at $pilotScript"
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-PilotLog {
  param([Parameter(Mandatory)][string]$Message)
  $line = "{0:u} {1}" -f (Get-Date).ToUniversalTime(), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
}

function Invoke-PilotPass {
  # start-orcha-pilot.ps1 uses process-level exit codes for its direct CLI
  # contract. Run it as a child PowerShell process so those exits cannot stop
  # this long-lived supervisor after the first successful pass.
  $shell = (Get-Command powershell.exe -ErrorAction Stop).Source
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -DistroName "{1}" -EnvironmentFile "{2}" -ApiPort {3} -UiPort {4} -NpmPath "{5}" -ReadyTimeoutSeconds {6}' -f `
    $pilotScript, $DistroName, $EnvironmentFile, $ApiPort, $UiPort, $NpmPath, $ReadyTimeoutSeconds
  Set-Content -LiteralPath $passStdout -Value ''
  Set-Content -LiteralPath $passStderr -Value ''
  $process = Start-Process -FilePath $shell -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $passStdout -RedirectStandardError $passStderr -Wait -PassThru
  foreach ($path in @($passStdout, $passStderr)) {
    if (Test-Path -LiteralPath $path) {
      Get-Content -LiteralPath $path -Tail 20 -ErrorAction SilentlyContinue |
        ForEach-Object { Write-PilotLog ([string]$_) }
    }
  }
  return $process.ExitCode -eq 0
}

$lastReady = $null
do {
  $ready = $false
  try {
    # The launcher performs all ownership checks. In particular, a stale
    # tunnel is recycled only when its executable and recorded start time
    # prove that it belongs to this pilot.
    $ready = Invoke-PilotPass
  } catch {
    Write-PilotLog "Pilot recovery pass failed: $($_.Exception.GetType().Name)"
    $ready = $false
  }

  if ($null -eq $lastReady -or $lastReady -ne $ready) {
    Write-PilotLog $(if ($ready) { 'Phone pilot is ready.' } else { 'Phone pilot is not ready; retrying.' })
    $lastReady = $ready
  }
  if ($Once) {
    if ($ready) { exit 0 }
    exit 1
  }
  Start-Sleep -Seconds $CheckIntervalSeconds
} while ($true)
