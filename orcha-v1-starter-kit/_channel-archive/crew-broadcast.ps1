#requires -version 5
<#
  Push every new channel message into every other agent's window.

  The earlier design was pull: an agent had to be woken, open its inbox, work out
  whether anything applied to it, and then answer. That put a decision in front of
  every reply and most turns died there.

  This is push. A message posted by anyone is typed straight into the other agents'
  desktop apps, together with a standing instruction to answer unless it genuinely
  does not concern them. The author never receives their own message.

    .\crew-broadcast.ps1                 run it (Ctrl+C stops)
    .\crew-broadcast.ps1 -Once           one pass
    .\crew-broadcast.ps1 -DryRun         log the targets, type nothing
    .\crew-broadcast.ps1 -CatchUp        also push the newest existing message
#>
param(
  [int]$IntervalSeconds = 3,
  [int]$PerAgentCooldownSeconds = 45,
  [int]$MaxExcerptChars = 420,
  [switch]$Once,
  [switch]$DryRun,
  [switch]$CatchUp
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$api = 'http://127.0.0.1:5173/api/channel'
$logPath = Join-Path $root 'crew-broadcast.log'
$statePath = Join-Path $root '.crew-broadcast-state.json'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logPath -Value $line -Encoding utf8
}

# Every agent that can receive a pushed message, and the desktop app to type into.
# @claude is absent on purpose: the "Claude" window is @bents' own live session, so
# typing there would inject text into their conversation instead of starting a turn.
$Targets = @{
  codex    = 'chatgpt'    # ChatGPT.exe ships from the OpenAI.Codex package
  cursor   = 'cursor'
  opencode = 'opencode'
}

function Get-State {
  if (Test-Path $statePath) {
    try { return (Get-Content -Raw $statePath) -replace '^﻿', '' | ConvertFrom-Json } catch { }
  }
  return $null
}

function Set-State([string]$lastId) {
  $payload = @{ lastId = $lastId; updated = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
  try { Set-Content -Path $statePath -Value $payload -Encoding utf8 } catch { }
}

function Test-Window([string]$app) {
  $pattern = '^' + $app + '$'
  return [bool](Get-Process | Where-Object { $_.ProcessName -match $pattern -and $_.MainWindowHandle -ne 0 })
}

<#
  The standing instruction every agent receives with every message.
  Deliberately biased toward answering: silence is the failure mode this whole
  system exists to remove, so "not sure" resolves to replying, not skipping.
#>
function New-BroadcastLine([string]$who, $message) {
  $body = ($message.body -replace '\s+', ' ').Trim()
  if ($body.Length -gt $MaxExcerptChars) { $body = $body.Substring(0, $MaxExcerptChars) + '...(full text in CHANNEL.md)' }
  $from = $message.from
  $time = $message.time

  return "[CREW CHANNEL] @$from at $time said: $body " +
         "-- You are @$who. Reply if this affects your work, if you can help, if you disagree, or if you know something the others do not. " +
         "Post with: bash ./channel.sh $who 'your reply'. " +
         "Only skip if it genuinely has nothing to do with you, and if you skip, say nothing at all. " +
         "If you are unsure whether it applies to you, reply. Answer the agent who spoke, not just @bents."
}

$lastSent = @{}

Write-Log "crew-broadcast starting - poll ${IntervalSeconds}s$(if ($DryRun) { ' [DRY RUN]' })"
foreach ($who in $Targets.Keys) {
  Write-Log ('  target {0,-9} {1}' -f $who, $(if (Test-Window $Targets[$who]) { 'window ready' } else { 'NO WINDOW' }))
}
Write-Log '  claude    excluded - that window is @bents own session'

$state = Get-State
$lastId = if ($state) { $state.lastId } else { $null }

do {
  try {
    $data = Invoke-RestMethod -Uri $api -TimeoutSec 5
  } catch {
    Write-Log 'dev server unreachable on :5173 - retrying'
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  $messages = @($data.messages)
  if ($messages.Count -eq 0) { Start-Sleep -Seconds $IntervalSeconds; continue }

  # On a cold start, adopt the current tail so history is not re-broadcast.
  if (-not $lastId) {
    if ($CatchUp) {
      $lastId = if ($messages.Count -ge 2) { $messages[$messages.Count - 2].id } else { $null }
    } else {
      $lastId = $messages[$messages.Count - 1].id
      Set-State $lastId
      Write-Log "cold start - watching from '$lastId'"
      if ($Once) { break }
      Start-Sleep -Seconds $IntervalSeconds
      continue
    }
  }

  $index = -1
  for ($i = 0; $i -lt $messages.Count; $i++) { if ($messages[$i].id -eq $lastId) { $index = $i; break } }
  $fresh = if ($index -ge 0) { $messages[($index + 1)..($messages.Count - 1)] } else { @($messages[$messages.Count - 1]) }
  $fresh = @($fresh | Where-Object { $_ -ne $null })

  foreach ($message in $fresh) {
    $author = ($message.from).ToLower()
    Write-Log "new message from @$author ($($message.time)) - pushing to everyone else"

    foreach ($who in $Targets.Keys) {
      if ($who -eq $author) { continue }                              # never echo to the author
      $app = $Targets[$who]
      if (-not (Test-Window $app)) { Write-Log "  @$who skipped - no window"; continue }
      if ($lastSent.ContainsKey($who) -and ((Get-Date) - $lastSent[$who]).TotalSeconds -lt $PerAgentCooldownSeconds) {
        Write-Log "  @$who skipped - cooling down"
        continue
      }

      $line = New-BroadcastLine $who $message
      if ($DryRun) { Write-Log "  @$who would receive $($line.Length) chars"; continue }

      $lastSent[$who] = Get-Date
      $result = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'desktop-wake.ps1') -App $app -Message $line 2>&1
      Write-Log "  @$who <- $($result | Select-Object -Last 1)"
    }

    $lastId = $message.id
    Set-State $lastId
  }

  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)

Write-Log 'crew-broadcast stopped'
