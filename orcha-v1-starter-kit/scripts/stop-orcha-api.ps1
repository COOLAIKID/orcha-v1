[CmdletBinding()]
param(
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ownerIds = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'")
$byId = @{}
foreach ($process in $processes) { $byId[[int]$process.ProcessId] = $process }
$targetIds = [System.Collections.Generic.HashSet[int]]::new()

foreach ($ownerId in $ownerIds) {
  $current = $byId[[int]$ownerId]
  for ($depth = 0; $depth -lt 5 -and $null -ne $current; $depth += 1) {
    if ($current.CommandLine -like '*orcha.api.app*') { [void]$targetIds.Add([int]$current.ProcessId) }
    if ($current.CommandLine -like '*orcha.api.app*' -and $current.CommandLine -like "*$root*") { break }
    $current = $byId[[int]$current.ParentProcessId]
  }
}
$targets = $processes | Where-Object { $targetIds.Contains([int]$_.ProcessId) }

if (-not $targets) {
  Write-Host 'No Orcha API process is running.'
  exit 0
}

foreach ($target in $targets) {
  Stop-Process -Id $target.ProcessId -ErrorAction Stop
}

$pidFile = Join-Path $root "var\orcha-api-$Port.pid"
if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
Write-Host "Stopped Orcha API process(es) for port $Port."
