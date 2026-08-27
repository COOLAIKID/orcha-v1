[CmdletBinding()]
param(
  [string]$DistroName = 'orcha-worker',
  [string]$EnvironmentFile = '',
  [switch]$ForceRestart
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$wslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$originalPath = $env:PATH
$originalSetupToken = [Environment]::GetEnvironmentVariable('ORCHA_WORKER_SETUP_TOKEN', 'Process')
$originalWslEnv = [Environment]::GetEnvironmentVariable('WSLENV', 'Process')
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $projectRoot 'orcha.local.env' }

function Read-WorkerToken {
  if ($env:ORCHA_WORKER_AUTH_TOKEN) { return [string]$env:ORCHA_WORKER_AUTH_TOKEN }
  if (!(Test-Path -LiteralPath $EnvironmentFile)) { return '' }
  foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $pair = $trimmed -split '=', 2
    if ($pair.Count -eq 2 -and $pair[0].Trim() -eq 'ORCHA_WORKER_AUTH_TOKEN') {
      $value = $pair[1].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return ''
}

$workerToken = Read-WorkerToken
# Avoid feeding any agent/tool PATH into WSL's Windows-path translator. The
# worker has its own Linux PATH and does not need host executables; wslExe is
# absolute so the host command remains available with an empty PATH.
$env:PATH = ''
$env:ORCHA_WORKER_SETUP_TOKEN = $workerToken
$wslEnvValues = @($originalWslEnv -split ':' | Where-Object { $_ -and $_ -ne 'ORCHA_WORKER_SETUP_TOKEN' })
$env:WSLENV = (($wslEnvValues + 'ORCHA_WORKER_SETUP_TOKEN') -join ':')

function Test-WorkerReady {
  & $wslExe -d $DistroName -u orcha -- /opt/orcha/.venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3).read()" 1>$null 2>$null
  return $LASTEXITCODE -eq 0
}

# Keep the dedicated worker source in sync without mounting Windows drives
# inside the worker distro. Copying through the distro's UNC filesystem avoids
# PowerShell's native-command binary-pipeline conversion, which can corrupt a
# Python file while streaming a tar archive through wsl.exe.
$sourceRoot = Join-Path $projectRoot 'src\orcha'
$destinationRoot = '\\wsl$\' + $DistroName + '\opt\orcha\src\orcha'
try {
  # The supervisor can invoke this script after a transient false-negative
  # probe. Do not bounce a healthy service and interrupt active work; source
  # refresh/configuration remains available through the explicit switch.
  if (-not $ForceRestart -and (Test-WorkerReady)) {
    Write-Host "orcha-worker already ready inside $DistroName on 127.0.0.1:8765"
    return
  }
  if (!(Test-Path -LiteralPath $sourceRoot)) { throw "Worker source not found at $sourceRoot" }
  New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
  Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force |
    Where-Object { $_.Extension -ne '.pyc' -and $_.FullName -notmatch '\\__pycache__(\\|$)' } |
    ForEach-Object {
      # Windows PowerShell 5.1 does not expose Path.GetRelativePath; every
      # enumerated file is beneath sourceRoot, so this is equivalent and bounded.
      $relative = $_.FullName.Substring($sourceRoot.Length + 1)
      $destination = Join-Path $destinationRoot $relative
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
      [System.IO.File]::Copy($_.FullName, $destination, $true)
    }
  # Persist only the worker token in a root-owned systemd EnvironmentFile. The
  # token travels through the child environment/WSLENV and never appears in a
  # visible wsl.exe argument, source file, or startup log.
  $configure = @'
set -euo pipefail
install -d -m 0750 -o root -g root /etc/orcha
umask 077
token="${ORCHA_WORKER_SETUP_TOKEN:-}"
if [ -n "$token" ]; then
  printf 'ORCHA_WORKER_AUTH_TOKEN=%s\n' "$token" > /etc/orcha/worker.env
else
  rm -f /etc/orcha/worker.env
fi
install -d -m 0755 /etc/systemd/system/orcha-worker.service.d
printf '[Service]\nEnvironmentFile=-/etc/orcha/worker.env\n' > /etc/systemd/system/orcha-worker.service.d/10-environment.conf
chown -R orcha:orcha /opt/orcha
systemctl daemon-reload
systemctl restart orcha-worker.service
'@
  & $wslExe -d $DistroName -u root -- bash -lc $configure
  if ($LASTEXITCODE -ne 0) { throw 'orcha-worker configuration or restart failed.' }
  $health = & $wslExe -d $DistroName -u orcha -- /opt/orcha/.venv/bin/python -c "import time, urllib.request; time.sleep(1); print(urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=5).read().decode())"
  if ($LASTEXITCODE -ne 0) { throw 'orcha-worker did not become ready.' }
  Write-Host "orcha-worker ready inside $DistroName on 127.0.0.1:8765"
} finally {
  $env:PATH = $originalPath
  if ($null -eq $originalSetupToken) { Remove-Item -LiteralPath 'Env:ORCHA_WORKER_SETUP_TOKEN' -ErrorAction SilentlyContinue } else { $env:ORCHA_WORKER_SETUP_TOKEN = $originalSetupToken }
  if ($null -eq $originalWslEnv) { Remove-Item -LiteralPath 'Env:WSLENV' -ErrorAction SilentlyContinue } else { $env:WSLENV = $originalWslEnv }
}
