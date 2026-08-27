[CmdletBinding()]
param(
  [string]$DistroName = 'orcha-worker',
  [string]$EnvironmentFile = '',
  [int]$ApiPort = 8080,
  [int]$UiPort = 5175,
  [string]$NpmPath = '',
  [switch]$NoTunnel,
  [int]$ReadyTimeoutSeconds = 30
)

<#
Starts the local Orcha pilot in one safe, repeatable command:
  worker + API -> Vite cockpit -> optional Cloudflare Quick Tunnel.

Existing healthy services are reused. A port occupied by an unknown or
unhealthy process is never terminated; the script stops with an explanation.
The API and worker remain private. Only the Vite cockpit is shared by the
optional tunnel, preserving its /v1 and /api proxies.
#>

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$uiRoot = Join-Path $root 'ui'
$localScript = Join-Path $PSScriptRoot 'start-orcha-local.ps1'
$supervisorScript = Join-Path $PSScriptRoot 'watch-orcha-local.ps1'
$tunnelScript = Join-Path $PSScriptRoot 'start-orcha-tunnel.ps1'
$stateDir = Join-Path $root 'var\ui'
$stateFile = Join-Path $stateDir "orcha-ui-$UiPort.json"
$stdout = Join-Path $stateDir "vite-$UiPort.out.log"
$stderr = Join-Path $stateDir "vite-$UiPort.err.log"

function Test-HttpReady {
  param([Parameter(Mandatory)][string]$Url)
  try {
    $response = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-ListeningProcess {
  param([Parameter(Mandatory)][int]$Port)
  return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty OwningProcess
}

function Wait-HttpReady {
  param([Parameter(Mandatory)][string]$Url)
  $deadline = (Get-Date).AddSeconds([Math]::Max(5, $ReadyTimeoutSeconds))
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpReady $Url) { return $true }
    Start-Sleep -Milliseconds 350
  }
  return $false
}

function Resolve-Npm {
  if ($NpmPath) {
    if (-not (Test-Path -LiteralPath $NpmPath)) { throw "npm was not found at $NpmPath" }
    return (Resolve-Path -LiteralPath $NpmPath).Path
  }
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command npm -ErrorAction SilentlyContinue }
  if ($command) { return $command.Source }
  $known = @(
    (Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\npm.cmd'),
    (Join-Path ${env:LOCALAPPDATA} 'Programs\nodejs\npm.cmd'),
    (Join-Path ${env:APPDATA} 'npm\npm.cmd')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($known) { return (Resolve-Path -LiteralPath $known).Path }
  throw 'npm was not found. Install Node.js or pass -NpmPath <path-to-npm.cmd>, then run the pilot launcher again.'
}

if (-not (Test-Path -LiteralPath $localScript)) { throw "Local runtime script not found at $localScript" }
if (-not (Test-Path -LiteralPath $supervisorScript)) { throw "Local runtime supervisor not found at $supervisorScript" }
if (-not (Test-Path -LiteralPath $tunnelScript)) { throw "Tunnel script not found at $tunnelScript" }
if (-not (Test-Path -LiteralPath $uiRoot)) { throw "UI directory not found at $uiRoot" }

$apiUrl = "http://127.0.0.1:$ApiPort"
$uiUrl = "http://127.0.0.1:$UiPort"

if (Test-HttpReady "$apiUrl/health/ready") {
  Write-Host "Orcha local runtime already ready on $apiUrl"
} else {
  $apiProcess = Get-ListeningProcess -Port $ApiPort
  if ($apiProcess) {
    Write-Host 'The API port is occupied; asking the scoped supervisor to recover only verified Orcha services...'
    & $supervisorScript -DistroName $DistroName -EnvironmentFile $EnvironmentFile -ApiPort $ApiPort -Once
    if ($LASTEXITCODE -ne 0 -or -not (Test-HttpReady "$apiUrl/health/ready")) {
      throw "Port $ApiPort is occupied but the Orcha runtime is not ready. Unknown processes are never terminated."
    }
    Write-Host "Orcha local runtime recovered on $apiUrl"
  }
  else {
    Write-Host 'Starting the dedicated worker and Orcha API...'
    & $localScript -DistroName $DistroName -EnvironmentFile $EnvironmentFile -ApiPort $ApiPort
    if ($LASTEXITCODE -ne 0) { throw 'The local Orcha runtime did not start.' }
  }
}

$uiReady = Test-HttpReady "$uiUrl/"
$uiProcessId = Get-ListeningProcess -Port $UiPort
if ($uiReady) {
  $pidLabel = if ($uiProcessId) { " (PID $uiProcessId)" } else { '' }
  Write-Host "Vite cockpit already ready on $uiUrl$pidLabel"
} elseif ($uiProcessId) {
  throw "Port $UiPort is occupied by an unhealthy process (PID $uiProcessId). Refusing to terminate it."
} else {
  $npm = Resolve-Npm
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  Set-Content -LiteralPath $stdout -Value ''
  Set-Content -LiteralPath $stderr -Value ''
  $process = Start-Process -FilePath $npm.Source -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$UiPort") -WorkingDirectory $uiRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  [ordered]@{
    version = 1
    pid = $process.Id
    origin = $uiUrl
    startedAt = [DateTimeOffset]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
  if (-not (Wait-HttpReady "$uiUrl/")) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    throw "Vite did not become ready at $uiUrl. Read $stderr."
  }
  Write-Host "Vite cockpit ready on $uiUrl"
}

if ($NoTunnel) {
  Write-Host "Local pilot ready: $uiUrl"
  Write-Host 'Cloudflare tunnel skipped (-NoTunnel).'
  exit 0
}

& $tunnelScript -UiPort $UiPort -ReadyTimeoutSeconds $ReadyTimeoutSeconds
if ($LASTEXITCODE -ne 0) { throw 'The Cloudflare Quick Tunnel did not start.' }
Write-Host 'Local pilot ready. API and worker remain private; stop the stack with stop-orcha-local.ps1 and stop-orcha-tunnel.ps1.'
