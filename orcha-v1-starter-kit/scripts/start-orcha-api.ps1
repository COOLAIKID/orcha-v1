[CmdletBinding()]
param(
  [string]$EnvironmentFile = '',
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $root 'orcha.local.env' }
$python = Join-Path $root '.venv\Scripts\python.exe'
$stateDir = Join-Path $root 'var'
$logDir = Join-Path $stateDir 'logs'

# Provider values are needed by the child API process, but should not remain
# in the interactive PowerShell session after this wrapper returns.
$trackedEnvironment = @{}
function Set-TrackedEnvironment {
  param([Parameter(Mandatory)][string]$Name, [AllowEmptyString()][string]$Value)
  if (-not $trackedEnvironment.ContainsKey($Name)) {
    $previous = [Environment]::GetEnvironmentVariable($Name, 'Process')
    $trackedEnvironment[$Name] = @{ Exists = $null -ne $previous; Value = $previous }
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}
function Restore-TrackedEnvironment {
  foreach ($entry in $trackedEnvironment.GetEnumerator()) {
    $previous = $entry.Value
    if ($previous.Exists) {
      [Environment]::SetEnvironmentVariable($entry.Key, [string]$previous.Value, 'Process')
    } else {
      # PowerShell treats a .NET null assignment as an empty value in some
      # hosts. Remove the process-scoped variable explicitly instead.
      Remove-Item -LiteralPath "Env:$($entry.Key)" -ErrorAction SilentlyContinue
    }
  }
}

try {
  if (-not (Test-Path -LiteralPath $python)) {
    throw "Orcha virtual environment not found at $python. Create it before starting the API."
  }

  if (Test-Path -LiteralPath $EnvironmentFile) {
    foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
      $trimmed = $line.Trim()
      if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
      $pair = $trimmed -split '=', 2
      if ($pair.Count -ne 2 -or $pair[0].Trim() -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        throw "Invalid environment entry in $EnvironmentFile. Use NAME=value."
      }
      $name = $pair[0].Trim()
      $value = $pair[1].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      Set-TrackedEnvironment -Name $name -Value $value
    }
  } else {
    Write-Warning "No private environment file found at $EnvironmentFile. The API will start, but model-backed agents stay blocked."
  }

  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already listening. Stop the existing Orcha API before starting another one."
  }

  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  Set-TrackedEnvironment -Name 'PYTHONPATH' -Value (Join-Path $root 'src')
  $stdout = Join-Path $logDir 'orcha-api.out.log'
  $stderr = Join-Path $logDir 'orcha-api.err.log'
  $process = Start-Process -FilePath $python -ArgumentList '-m','uvicorn','orcha.api.app:app','--app-dir','src','--host','127.0.0.1','--port',"$Port" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $process.Id | Set-Content -LiteralPath (Join-Path $stateDir "orcha-api-$Port.pid") -NoNewline

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 300
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if ($health.status -eq 'ok') {
        Write-Host "Orcha API ready on http://127.0.0.1:$Port"
        return
      }
    } catch { }
  }

  throw "Orcha API did not become ready. Read $stderr for the startup error."
} finally {
  Restore-TrackedEnvironment
}
