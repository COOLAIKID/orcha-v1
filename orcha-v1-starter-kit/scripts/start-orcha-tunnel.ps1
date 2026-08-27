<##
Starts a temporary Cloudflare Quick Tunnel for the local Vite cockpit.

The tunnel targets Vite rather than the static preview server because Vite
owns the /v1 and /api proxies. The API (8080) and worker (8765) are never
exposed directly.

Quick Tunnel URLs are temporary and unauthenticated. Use this only for a
private pilot, and stop it when the share window ends.
##>
[CmdletBinding()]
param(
  [int]$UiPort = 5175,
  [string]$OriginHost = '127.0.0.1',
  [string]$CloudflaredPath = '',
  [int]$ReadyTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateDir = Join-Path $root 'var\tunnel'
$stateFile = Join-Path $stateDir 'orcha-tunnel.json'
$stdout = Join-Path $stateDir 'cloudflared.out.log'
$stderr = Join-Path $stateDir 'cloudflared.err.log'
$origin = "http://$OriginHost`:$UiPort"

function Resolve-Cloudflared {
  if ($CloudflaredPath) {
    if (!(Test-Path -LiteralPath $CloudflaredPath)) { throw "cloudflared was not found at $CloudflaredPath" }
    return (Resolve-Path -LiteralPath $CloudflaredPath).Path
  }
  $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $known = 'C:\Program Files (x86)\cloudflared\cloudflared.exe', 'C:\Program Files\cloudflared\cloudflared.exe'
  $found = $known | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($found) { return $found }
  throw 'cloudflared.exe is not installed or is not on PATH.'
}

function Read-TunnelUrl {
  foreach ($path in @($stderr, $stdout)) {
    if (!(Test-Path -LiteralPath $path)) { continue }
    $match = Select-String -Path $path -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
      ForEach-Object { $_.Matches } |
      Select-Object -Last 1
    if ($match) { return $match.Value }
  }
  return $null
}

function Test-Origin {
  try {
    $response = Invoke-WebRequest "$origin/" -UseBasicParsing -TimeoutSec 4
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-ManagedProcess {
  param(
    [System.Diagnostics.Process]$Candidate,
    [object]$RecordedState
  )
  if (!$Candidate -or !$Candidate.Path) { return $false }
  try {
    if ((Resolve-Path -LiteralPath $Candidate.Path).Path -ne $cloudflared) { return $false }
    if (!$RecordedState.startedAt) { return $false }
    $recordedStart = if ($RecordedState.startedAt -is [DateTime]) {
      [DateTimeOffset]::new([DateTime]$RecordedState.startedAt)
    } else {
      [DateTimeOffset]::Parse([string]$RecordedState.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    }
    $actualStart = [DateTimeOffset]::new($Candidate.StartTime.ToUniversalTime())
    $delta = ($actualStart - $recordedStart).TotalSeconds
    if ([string]$RecordedState.version -eq '2') {
      return [Math]::Abs($delta) -le 8
    }
    # Version 1 wrote the verification time instead of the process start
    # time. Accept only that narrow, backwards-compatible window.
    return $delta -le 0 -and $delta -ge -90
  } catch {
    return $false
  }
}

if (!(Test-Origin)) {
  throw "The Orcha UI is not reachable at $origin. Start the Vite server first (cd ui; npm run dev)."
}

$cloudflared = Resolve-Cloudflared
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if (Test-Path -LiteralPath $stateFile) {
  $existing = $null
  try {
    $existing = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  } catch { $existing = $null }
  if ($existing) {
    $recordedProcess = Get-Process -Id ([int]$existing.pid) -ErrorAction SilentlyContinue
    if (Test-ManagedProcess -Candidate $recordedProcess -RecordedState $existing) {
      $url = [string]$existing.url
      if ($url) {
        try {
          $probe = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 5
          if ($probe.StatusCode -eq 200) {
            Write-Host "Orcha tunnel already ready: $url"
            exit 0
          }
        } catch { }
      }
      # The recorded process is ours, but its Quick Tunnel may have lost its
      # public connection while the PID stayed alive and retrying. Recycle
      # only after the executable and start timestamp prove ownership; never
      # terminate an unrelated cloudflared process that happens to share a PID.
      if ($recordedProcess -and -not $recordedProcess.HasExited) {
        Write-Host "Recorded Orcha tunnel is stale; recycling managed process $($recordedProcess.Id)."
        try {
          Stop-Process -Id $recordedProcess.Id -ErrorAction Stop
          $recordedProcess.WaitForExit(5000)
        } catch {
          throw "Could not recycle the stale managed tunnel process $($recordedProcess.Id). Refusing to start a second tunnel."
        }
      }
    }
  }
}

# Rotate only this wrapper's own logs. Do not touch other cloudflared processes.
Set-Content -LiteralPath $stdout -Value ''
Set-Content -LiteralPath $stderr -Value ''
$process = Start-Process -FilePath $cloudflared -ArgumentList @(
  'tunnel', '--no-autoupdate', '--url', $origin, '--loglevel', 'info'
) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$startedAt = [DateTimeOffset]::UtcNow

$deadline = (Get-Date).AddSeconds([Math]::Max(5, $ReadyTimeoutSeconds))
$url = $null
try {
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
      throw "cloudflared exited before creating a tunnel. Read $stderr."
    }
    $url = Read-TunnelUrl
    if (!$url) { continue }
    try {
      $probe = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 5
      if ($probe.StatusCode -ne 200) { continue }
    } catch {
      continue
    }
    [ordered]@{
      version = 2
      pid = $process.Id
      url = $url
      origin = $origin
      startedAt = $startedAt.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
    Write-Host "Orcha tunnel ready: $url"
    Write-Host "Origin: $origin (API and worker remain private)"
    exit 0
  }
} catch {
  if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  throw
}

if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
throw "cloudflared did not produce a reachable Quick Tunnel within $ReadyTimeoutSeconds seconds. Read $stderr."
