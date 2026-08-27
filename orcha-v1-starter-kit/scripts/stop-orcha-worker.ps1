[CmdletBinding()]
param(
  [string]$DistroName = 'orcha-worker',
  [string]$EnvironmentFile = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$wslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $projectRoot 'orcha.local.env' }
$originalPath = $env:PATH
$originalBridgeToken = [Environment]::GetEnvironmentVariable('ORCHA_WORKER_BRIDGE_TOKEN', 'Process')
$originalWslEnv = [Environment]::GetEnvironmentVariable('WSLENV', 'Process')
$workerToken = if ($env:ORCHA_WORKER_AUTH_TOKEN) { [string]$env:ORCHA_WORKER_AUTH_TOKEN } else { '' }
if (-not $workerToken -and (Test-Path -LiteralPath $EnvironmentFile)) {
  foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $pair = $trimmed -split '=', 2
    if ($pair.Count -eq 2 -and $pair[0].Trim() -eq 'ORCHA_WORKER_AUTH_TOKEN') {
      $workerToken = $pair[1].Trim()
      if (($workerToken.StartsWith('"') -and $workerToken.EndsWith('"')) -or ($workerToken.StartsWith("'") -and $workerToken.EndsWith("'"))) {
        $workerToken = $workerToken.Substring(1, $workerToken.Length - 2)
      }
      break
    }
  }
}

$env:PATH = ''
$env:ORCHA_WORKER_BRIDGE_TOKEN = $workerToken
$wslEnvValues = @($originalWslEnv -split ':' | Where-Object { $_ -and $_ -ne 'ORCHA_WORKER_BRIDGE_TOKEN' })
$env:WSLENV = (($wslEnvValues + 'ORCHA_WORKER_BRIDGE_TOKEN') -join ':')
try {
  & $wslExe -d $DistroName -u orcha -- /opt/orcha/.venv/bin/python -c "import os, urllib.request; token=os.environ.get('ORCHA_WORKER_BRIDGE_TOKEN',''); headers={'Content-Type':'application/json'}; headers.update({'X-Orcha-Worker-Token':token} if token else {}); request=urllib.request.Request('http://127.0.0.1:8765/execute', data=b'{\"company_id\":\"runtime\",\"action\":\"stop_all\"}', method='POST', headers=headers); urllib.request.urlopen(request, timeout=5).read()" 2>$null
  $null = & $wslExe --terminate $DistroName
} finally {
  $env:PATH = $originalPath
  if ($null -eq $originalBridgeToken) { Remove-Item -LiteralPath 'Env:ORCHA_WORKER_BRIDGE_TOKEN' -ErrorAction SilentlyContinue } else { $env:ORCHA_WORKER_BRIDGE_TOKEN = $originalBridgeToken }
  if ($null -eq $originalWslEnv) { Remove-Item -LiteralPath 'Env:WSLENV' -ErrorAction SilentlyContinue } else { $env:WSLENV = $originalWslEnv }
}
Write-Host 'orcha-worker stopped.'
