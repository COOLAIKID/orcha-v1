<##
Stops only the Cloudflare Quick Tunnel recorded by start-orcha-tunnel.ps1.
##>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateFile = Join-Path $root 'var\tunnel\orcha-tunnel.json'
$cloudflaredName = 'cloudflared.exe'

if (!(Test-Path -LiteralPath $stateFile)) {
  Write-Host 'No Orcha tunnel is recorded.'
  exit 0
}

try {
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $process = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
  $managed = $false
  if ($process -and $process.Path -and ([IO.Path]::GetFileName($process.Path) -ieq $cloudflaredName) -and $state.startedAt) {
    try {
      $recordedStart = if ($state.startedAt -is [DateTime]) {
        [DateTimeOffset]::new([DateTime]$state.startedAt)
      } else {
        [DateTimeOffset]::Parse([string]$state.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
      }
      $actualStart = [DateTimeOffset]::new($process.StartTime.ToUniversalTime())
      $delta = ($actualStart - $recordedStart).TotalSeconds
      $managed = if ([string]$state.version -eq '2') {
        [Math]::Abs($delta) -le 8
      } else {
        # Version 1 recorded readiness time. Keep the old state usable only
        # for the short window in which it could describe this process.
        $delta -le 0 -and $delta -ge -90
      }
    } catch {
      $managed = $false
    }
  }
  if ($managed) {
    Stop-Process -Id $process.Id -ErrorAction Stop
    Write-Host "Stopped Orcha tunnel process $($process.Id)."
  } elseif ($process) {
    Write-Host "The recorded PID does not match Orcha's managed tunnel process; left it running."
  } else {
    Write-Host 'The recorded tunnel process is no longer running.'
  }
} finally {
  Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
}
