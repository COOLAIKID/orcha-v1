#requires -version 5
<#
  Record what changed in Orcha, so an agent picking up the work can see what moved
  since it last looked.

  This is a log, not a conversation. There is no channel, no agent-to-agent chat,
  and nothing that wakes or types into anything. It watches the source tree and
  appends a short entry to ORCHA-CHANGES.md.

    .\crew-watch.ps1              run it (Ctrl+C stops)
    .\crew-watch.ps1 -Once        single pass
    .\crew-watch.ps1 -DryRun      print the entry instead of writing it
    .\crew-watch.ps1 -Reset       re-baseline and write nothing
#>
param(
  [int]$IntervalSeconds = 10,
  [int]$SettleSeconds = 20,
  [switch]$Once,
  [switch]$DryRun,
  [switch]$Reset
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$statePath = Join-Path $root '.crew-watch-state.json'
$logPath = Join-Path $root 'crew-watch.log'
$changesPath = Join-Path $root 'ORCHA-CHANGES.md'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logPath -Value $line -Encoding utf8
}

# Generated output, logs and the change log itself are excluded, otherwise the
# watcher reports its own noise.
$IncludeRoots = @('ui\src', 'src', 'tests', 'docs')
$IncludeRootFiles = @('PRODUCT.md', 'DESIGN.md', 'AGENTS.md', 'START_HERE.md', 'README.md', 'ui\index.html', 'ui\vite.config.ts', 'ui\package.json')
$ExcludePattern = '\\(node_modules|\.venv|dist|__pycache__|\.pytest_cache|\.git|_channel-archive)\\|\.log$|ORCHA-CHANGES\.md$|^\.crew-|\.tsbuildinfo$'

function Get-TrackedFiles {
  $files = @()
  foreach ($rel in $IncludeRoots) {
    $dir = Join-Path $root $rel
    if (Test-Path $dir) { $files += Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue }
  }
  foreach ($rel in $IncludeRootFiles) {
    $f = Join-Path $root $rel
    if (Test-Path $f) { $files += Get-Item $f -ErrorAction SilentlyContinue }
  }
  return $files | Where-Object { $_.FullName -notmatch $ExcludePattern }
}

function Get-Snapshot {
  $snap = @{}
  foreach ($f in Get-TrackedFiles) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\')
    try {
      $lines = (Get-Content -LiteralPath $f.FullName -ErrorAction Stop | Measure-Object -Line).Lines
      $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm MD5 -ErrorAction Stop).Hash
    } catch { continue }
    $snap[$rel] = @{ lines = $lines; hash = $hash }
  }
  return $snap
}

function Save-Snapshot($snap) {
  try { ($snap | ConvertTo-Json -Compress -Depth 5) | Set-Content -Path $statePath -Encoding utf8 } catch { }
}

function Load-Snapshot {
  if (-not (Test-Path $statePath)) { return $null }
  try {
    $raw = (Get-Content -Raw $statePath) -replace '^\uFEFF', ''
    $obj = $raw | ConvertFrom-Json
    $snap = @{}
    foreach ($p in $obj.PSObject.Properties) { $snap[$p.Name] = $p.Value }
    return $snap
  } catch { return $null }
}

function Compare-Snapshots($old, $new) {
  $added = @(); $removed = @(); $changed = @()
  foreach ($k in $new.Keys) {
    if (-not $old.ContainsKey($k)) { $added += $k }
    elseif ($old[$k].hash -ne $new[$k].hash) {
      $changed += [PSCustomObject]@{ file = $k; delta = ([int]$new[$k].lines - [int]$old[$k].lines) }
    }
  }
  foreach ($k in $old.Keys) { if (-not $new.ContainsKey($k)) { $removed += $k } }
  return [PSCustomObject]@{ added = $added; removed = $removed; changed = $changed }
}

function Format-Entry($diff) {
  $parts = @()
  $parts += "## $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  if ($diff.changed.Count -gt 0) {
    $parts += ''
    $parts += 'Edited:'
    foreach ($c in ($diff.changed | Sort-Object { [Math]::Abs($_.delta) } -Descending)) {
      $sign = if ($c.delta -gt 0) { "+$($c.delta) lines" } elseif ($c.delta -lt 0) { "$($c.delta) lines" } else { 'same length' }
      $parts += "- ``$($c.file)`` ($sign)"
    }
  }
  if ($diff.added.Count -gt 0) {
    $parts += ''
    $parts += 'Added:'
    foreach ($a in $diff.added) { $parts += "- ``$a``" }
  }
  if ($diff.removed.Count -gt 0) {
    $parts += ''
    $parts += 'Deleted:'
    foreach ($r in $diff.removed) { $parts += "- ``$r``" }
  }
  return (($parts -join "`n") + "`n")
}

function Write-Entry([string]$text) {
  if (-not (Test-Path $changesPath)) {
    $header = "# Orcha changes`n`nAppend-only log of what moved in the source tree, newest at the bottom.`nWritten by ``crew-watch.ps1``. Read this before editing a surface someone else touched.`n"
    Set-Content -Path $changesPath -Value $header -Encoding utf8
  }
  Add-Content -Path $changesPath -Value "`n$text" -Encoding utf8
}

$previous = Load-Snapshot
if ($Reset -or -not $previous) {
  $previous = Get-Snapshot
  Save-Snapshot $previous
  Write-Log "baseline taken - $($previous.Keys.Count) files tracked"
  if ($Reset) { Write-Log 'reset only, nothing written'; exit 0 }
}

Write-Log "crew-watch starting - poll ${IntervalSeconds}s, settle ${SettleSeconds}s, $($previous.Keys.Count) files$(if ($DryRun) { ' [DRY RUN]' })"

$pendingSince = $null

do {
  Start-Sleep -Seconds $IntervalSeconds
  $current = Get-Snapshot
  $diff = Compare-Snapshots $previous $current
  $any = ($diff.added.Count + $diff.removed.Count + $diff.changed.Count) -gt 0

  if ($any) {
    # Wait for a burst of edits to settle so one turn produces one entry.
    if (-not $pendingSince) {
      $pendingSince = Get-Date
      Write-Log "change detected in $($diff.changed.Count + $diff.added.Count + $diff.removed.Count) file(s) - waiting ${SettleSeconds}s to settle"
      continue
    }
    if (((Get-Date) - $pendingSince).TotalSeconds -lt $SettleSeconds) { continue }

    $entry = Format-Entry $diff
    if ($DryRun) {
      Write-Log "would write:`n$entry"
    } else {
      Write-Entry $entry
      Write-Log "logged ($($diff.changed.Count) edited, $($diff.added.Count) added, $($diff.removed.Count) deleted)"
    }
    $previous = $current
    Save-Snapshot $previous
    $pendingSince = $null
  } else {
    $pendingSince = $null
  }
} while ((-not $Once) -or $pendingSince)

Write-Log 'crew-watch stopped'
