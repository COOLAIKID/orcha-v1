#requires -version 5
<#
  Keep the crew updated on what changed in Orcha.

  When one agent iterates on the repo, the others need to know what it touched so
  they do not clobber it or re-derive it. This watches the source tree and posts a
  short summary of every change burst to the channel, which every agent reads at
  the start of its turn.

  Nothing here wakes anybody, types into any window, or needs agent cooperation.

    .\crew-watch.ps1              run it (Ctrl+C stops)
    .\crew-watch.ps1 -Once        single pass
    .\crew-watch.ps1 -DryRun      print the summary instead of posting
    .\crew-watch.ps1 -Reset       re-baseline and post nothing
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
$api = 'http://127.0.0.1:5173/api/channel'
$statePath = Join-Path $root '.crew-watch-state.json'
$logPath = Join-Path $root 'crew-watch.log'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logPath -Value $line -Encoding utf8
}

# What counts as "Orcha changed". Generated files, logs and the channel itself are
# excluded, otherwise the watcher reports its own noise.
$IncludeRoots = @('ui\src', 'src', 'tests', 'docs')
$IncludeRootFiles = @('PRODUCT.md', 'DESIGN.md', 'AGENTS.md', 'START_HERE.md', 'README.md', 'ui\index.html', 'ui\vite.config.ts', 'ui\package.json')
$ExcludePattern = '\\(node_modules|\.venv|dist|__pycache__|\.pytest_cache|\.git)\\|\.log$|CHANNEL\.md$|^\.crew-|\.tsbuildinfo$'

function Get-TrackedFiles {
  $files = @()
  foreach ($rel in $IncludeRoots) {
    $dir = Join-Path $root $rel
    if (Test-Path $dir) {
      $files += Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue
    }
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
    $snap[$rel] = @{ lines = $lines; hash = $hash; mtime = $f.LastWriteTimeUtc.ToString('o') }
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

# Presence tells us which agent was burning CPU while the edits landed. It is a
# strong hint, not proof, so the summary says "likely" rather than asserting it.
function Get-LikelyAuthor {
  try {
    $data = Invoke-RestMethod -Uri $api -TimeoutSec 4
    $busy = @($data.agents | Where-Object { $_.working } | Sort-Object load -Descending)
    if ($busy.Count -gt 0) { return $busy[0].from }
  } catch { }
  return $null
}

function Compare-Snapshots($old, $new) {
  $added = @(); $removed = @(); $changed = @()
  foreach ($k in $new.Keys) {
    if (-not $old.ContainsKey($k)) { $added += $k }
    elseif ($old[$k].hash -ne $new[$k].hash) {
      $delta = [int]$new[$k].lines - [int]$old[$k].lines
      $changed += [PSCustomObject]@{ file = $k; delta = $delta }
    }
  }
  foreach ($k in $old.Keys) { if (-not $new.ContainsKey($k)) { $removed += $k } }
  return [PSCustomObject]@{ added = $added; removed = $removed; changed = $changed }
}

function Format-Summary($diff, [string]$author) {
  $parts = @()
  $who = if ($author) { "while @$author was active (likely author)" } else { 'author unknown' }
  $parts += "ORCHA CHANGED - $who"

  if ($diff.changed.Count -gt 0) {
    $parts += 'Edited:'
    foreach ($c in ($diff.changed | Sort-Object { [Math]::Abs($_.delta) } -Descending)) {
      $sign = if ($c.delta -gt 0) { "+$($c.delta) lines" } elseif ($c.delta -lt 0) { "$($c.delta) lines" } else { 'same length' }
      $parts += "  $($c.file) ($sign)"
    }
  }
  if ($diff.added.Count -gt 0) {
    $parts += 'Added:'
    foreach ($a in $diff.added) { $parts += "  $a" }
  }
  if ($diff.removed.Count -gt 0) {
    $parts += 'Deleted:'
    foreach ($r in $diff.removed) { $parts += "  $r" }
  }
  $parts += 'Re-read these before editing the same surface.'
  return ($parts -join "`n")
}

function Send-Summary([string]$text) {
  $payload = @{ from = 'changes'; body = $text } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Method Post -Uri $api -ContentType 'application/json; charset=utf-8' `
      -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 8 | Out-Null
    return $true
  } catch { return $false }
}

$previous = Load-Snapshot
if ($Reset -or -not $previous) {
  $previous = Get-Snapshot
  Save-Snapshot $previous
  Write-Log "baseline taken - $($previous.Keys.Count) files tracked"
  if ($Reset -or $Once) { if ($Reset) { Write-Log 'reset only, nothing posted'; exit 0 } }
}

Write-Log "crew-watch starting - poll ${IntervalSeconds}s, settle ${SettleSeconds}s, $($previous.Keys.Count) files$(if ($DryRun) { ' [DRY RUN]' })"

$pendingSince = $null

do {
  Start-Sleep -Seconds $IntervalSeconds
  $current = Get-Snapshot
  $diff = Compare-Snapshots $previous $current
  $any = ($diff.added.Count + $diff.removed.Count + $diff.changed.Count) -gt 0

  if ($any) {
    # Wait for a burst of edits to settle so one turn produces one summary,
    # not a message per keystroke-save.
    if (-not $pendingSince) {
      $pendingSince = Get-Date
      Write-Log "change detected in $($diff.changed.Count + $diff.added.Count + $diff.removed.Count) file(s) - waiting ${SettleSeconds}s to settle"
      $pendingAuthor = Get-LikelyAuthor
      continue
    }
    if (((Get-Date) - $pendingSince).TotalSeconds -lt $SettleSeconds) { continue }

    $summary = Format-Summary $diff $pendingAuthor
    if ($DryRun) {
      Write-Log "would post:`n$summary"
    } else {
      if (Send-Summary $summary) { Write-Log "posted summary ($($diff.changed.Count) edited, $($diff.added.Count) added, $($diff.removed.Count) deleted)" }
      else { Write-Log 'post failed - dev server unreachable, will retry' ; continue }
    }
    $previous = $current
    Save-Snapshot $previous
    $pendingSince = $null
    $pendingAuthor = $null
  } else {
    $pendingSince = $null
  }
} while ((-not $Once) -or $pendingSince)

Write-Log 'crew-watch stopped'
