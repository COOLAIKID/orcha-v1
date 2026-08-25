#requires -version 5
<#
  Always-on relay for the crew channel.

  Watches /api/channel for open replies and immediately gives a turn to any agent
  that owes one, so a reply lands without @bents prompting anybody.

  What this can and cannot do:
    - It can wake agents that expose a HEADLESS CLI (claude, codex).
    - It cannot wake GUI-only agents. Cursor and OpenCode are Electron apps with
      no command-line entry point, so nothing outside them can start a turn.

  Usage:
    .\crew-daemon.ps1                 run in the foreground (Ctrl+C to stop)
    .\crew-daemon.ps1 -Once           single pass, useful for testing
    .\crew-daemon.ps1 -DryRun         log what it would wake, wake nothing
    .\crew-daemon.ps1 -MockRunner     use a stub agent to exercise the loop
#>
param(
  [int]$IntervalSeconds = 4,
  [int]$RecheckBlockedMinutes = 10,
  [int]$DesktopCooldownSeconds = 240,
  [switch]$NoDesktop,
  [int]$CooldownSeconds = 90,
  [int]$MaxTurnsPerHour = 30,
  [switch]$Once,
  [switch]$DryRun,
  [switch]$MockRunner
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$api = 'http://127.0.0.1:5173/api/channel'
$logPath = Join-Path $root 'crew-daemon.log'
$statusPath = Join-Path $root '.crew-daemon-status.json'

function Write-Log([string]$msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $logPath -Value $line -Encoding utf8
}

# ---- runners -------------------------------------------------------------
# Each entry turns "this agent owes a reply" into a real, unattended turn.
$claudeExe = Join-Path $env:APPDATA 'Claude\claude-code\2.1.237\claude.exe'

function New-Prompt([string]$who) {
  @"
You are @$who in a shared agent channel. Run this first (PowerShell, from the repo root):

.\channel.ps1 $who --inbox

It prints what you owe a reply to. Post exactly one short reply with:

.\channel.ps1 $who 'your reply'

Posts go through http://127.0.0.1:5173/api/channel so a sandboxed write to CHANNEL.md is not required. Answer the agent who addressed you, not only @bents. Do not modify any other file. Stop after posting.
"@
}

# Start-Job runs in a clean runspace: no variables from this script exist there,
# which is why an earlier closure-based version silently produced no output.
# Everything the command needs is passed in as an argument instead.
$TurnBody = {
  param($kind, $who, $root, $claudeExe, $prompt)
  Set-Location $root
  switch ($kind) {
    'claude' { & $claudeExe -p $prompt --allowedTools Bash --output-format text 2>&1 }
    'codex'  { & codex exec --cd $root --skip-git-repo-check -c 'sandbox_mode="danger-full-access"' $prompt 2>&1 }
    'mock'   { & bash ./channel.sh $who "mock runner reply from @$who (daemon self-test)" 2>&1 }
  }
}

# Every agent has a desktop app, so every agent can be given a turn even when its
# CLI is missing or broken: focus the window and type, the way a person would.
# ChatGPT.exe ships from the OpenAI.Codex package and is Codex's GUI.
# @claude is deliberately absent: the "Claude" desktop window is @bents' own live
# session, so typing into it would inject text into their conversation rather than
# start an agent turn. @claude answers from that session directly.
$DesktopApp = @{ codex = 'chatgpt'; cursor = 'cursor'; opencode = 'opencode' }
$CliAgents = @('claude', 'codex')

function Test-DesktopWindow([string]$app) {
  $pattern = '^' + $app + '$'
  return [bool](Get-Process | Where-Object { $_.ProcessName -match $pattern -and $_.MainWindowHandle -ne 0 })
}

# Known blocking failures. A runner that hits one of these cannot answer at all,
# so it is retired with the reason instead of being woken every cooldown forever.
$BlockedPatterns = @(
  @{ match = 'OAuth session expired';        why = 'auth expired - run: claude login' },
  @{ match = 'Invalid API key';              why = 'invalid API key' },
  @{ match = 'requires a newer version of';  why = 'model/CLI version mismatch - run: codex update' },
  @{ match = 'model .* not found';           why = 'configured model unavailable' },
  @{ match = '4\d\d status code';            why = 'API rejected the request' }
)

function Get-BlockReason([string]$output) {
  foreach ($p in $BlockedPatterns) { if ($output -match $p.match) { return $p.why } }
  return $null
}

# Which mechanism, if any, can start a turn for this agent right now.
function Get-WakePath([string]$who) {
  if ((Test-Runner $who) -and ($CliAgents -contains $who)) { return 'cli' }
  if (-not $NoDesktop -and $DesktopApp.ContainsKey($who) -and (Test-DesktopWindow $DesktopApp[$who])) { return 'desktop' }
  return 'none'
}

function Test-Runner([string]$who) {
  if (-not ($CliAgents -contains $who)) { return $false }
  if ($unhealthy.ContainsKey($who)) {
    # give a retired runner another chance periodically, so fixing the CLI takes
    # effect without restarting the daemon
    if (((Get-Date) - $unhealthy[$who].at).TotalMinutes -ge $RecheckBlockedMinutes) {
      Write-Log "@$who rechecking blocked runner ($($unhealthy[$who].why))"
      $unhealthy.Remove($who)
    } else {
      return $false
    }
  }
  if ($MockRunner) { return $true }
  switch ($who) {
    'claude' { return (Test-Path $claudeExe) }
    'codex'  { return [bool](Get-Command codex -ErrorAction SilentlyContinue) }
  }
  return $false
}

# Publish runner health so the dashboard can tell @bents who the daemon will
# handle and who they have to prompt themselves.
function Write-Status {
  $runners = @{}
  foreach ($who in @('claude', 'codex', 'cursor', 'opencode')) {
    $path = Get-WakePath $who
    switch ($path) {
      'cli'     { $runners[$who] = @{ state = 'ready'; why = 'headless CLI' } }
      'desktop' {
        $why = if ($unhealthy.ContainsKey($who)) { 'CLI blocked (' + $unhealthy[$who].why + ') - using the desktop app instead' } else { 'desktop app - the relay types into its window' }
        $runners[$who] = @{ state = 'ready'; why = $why }
      }
      default   {
        $why = if ($who -eq 'claude') { 'answers from @bents own Claude session, not via the relay' } else { 'no CLI and no desktop window open' }
        $runners[$who] = @{ state = 'blocked'; why = $why }
      }
    }
  }
  $payload = @{ updated = (Get-Date).ToString('o'); runners = $runners } | ConvertTo-Json -Compress -Depth 4
  try { Set-Content -Path $statusPath -Value $payload -Encoding utf8 } catch { }
}

function Set-Typing([string]$who, [bool]$on) {
  $body = '{"from":"' + $who + '","typing":' + $(if ($on) { 'true' } else { 'false' }) + '}'
  try { Invoke-RestMethod -Method Post -Uri $api -ContentType 'application/json' -Body $body -TimeoutSec 4 | Out-Null } catch { }
}

# ---- state ---------------------------------------------------------------
$jobs = @{}          # who -> running job
$unhealthy = @{}     # who -> @{ why = reason; at = when it was retired }
$lastTurn = @{}      # who -> datetime of last wake
$turnTimes = @()     # for the hourly cap

Write-Log "crew-daemon starting - poll ${IntervalSeconds}s, cooldown ${CooldownSeconds}s, cap ${MaxTurnsPerHour}/h$(if ($DryRun) { ' [DRY RUN]' })$(if ($MockRunner) { ' [MOCK]' })"
foreach ($who in @('claude', 'codex')) {
  Write-Log ("  runner {0,-8} {1}" -f $who, $(if (Test-Runner $who) { 'available' } else { 'MISSING' }))
}
foreach ($who in @('claude', 'codex', 'cursor', 'opencode')) {
  Write-Log ("  wake path {0,-8} {1}" -f $who, (Get-WakePath $who))
}

Write-Status

do {
  Write-Status
  try {
    $data = Invoke-RestMethod -Uri $api -TimeoutSec 5
  } catch {
    Write-Log "dev server unreachable on :5173 - retrying"
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  # reap finished turns
  foreach ($who in @($jobs.Keys)) {
    $job = $jobs[$who]
    if ($job.State -ne 'Running') {
      $out = (Receive-Job $job -ErrorAction SilentlyContinue | Out-String).Trim()
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      $jobs.Remove($who)
      Set-Typing $who $false
      $tail = if ($out.Length -gt 200) { $out.Substring($out.Length - 200) } else { $out }
      $reason = Get-BlockReason $out
      if ($reason) {
        $unhealthy[$who] = @{ why = $reason; at = Get-Date }
        Write-Log "@$who RUNNER BLOCKED: $reason - retrying in ${RecheckBlockedMinutes}m"
      } else {
        Write-Log "@$who turn finished: $tail"
      }
    }
  }

  $turnTimes = @($turnTimes | Where-Object { $_ -gt (Get-Date).AddHours(-1) })

  # presence tells us who is mid-turn; poking a thinking agent just interrupts it
  $busy = @{}
  foreach ($a in @($data.agents)) { if ($a.working) { $busy[$a.from] = $true } }

  foreach ($item in @($data.owed)) {
    $who = $item.to
    if ($jobs.ContainsKey($who)) { continue }                       # turn already in flight
    if ($busy.ContainsKey($who)) { continue }                       # already thinking
    if ($turnTimes.Count -ge $MaxTurnsPerHour) { Write-Log "hourly cap reached - holding"; break }

    $path = Get-WakePath $who
    if ($path -eq 'none') { continue }

    # typing into a window steals focus, so desktop wakes wait longer between tries
    $cool = if ($path -eq 'desktop') { $DesktopCooldownSeconds } else { $CooldownSeconds }
    if ($lastTurn.ContainsKey($who) -and ((Get-Date) - $lastTurn[$who]).TotalSeconds -lt $cool) { continue }

    Write-Log "@$who owes @$($item.from) ($($item.time)) - waking via $path"
    if ($DryRun) { $lastTurn[$who] = Get-Date; continue }

    $lastTurn[$who] = Get-Date
    $turnTimes += (Get-Date)
    Set-Typing $who $true

    if ($path -eq 'desktop') {
      $app = $DesktopApp[$who]
      $msg = "Run: .\channel.ps1 $who --inbox   then reply with: .\channel.ps1 $who 'your reply'"
      $jobs[$who] = Start-Job -ScriptBlock {
        param($root, $app, $msg)
        Set-Location $root
        & powershell -NoProfile -ExecutionPolicy Bypass -File ./desktop-wake.ps1 -App $app -Message $msg 2>&1
      } -ArgumentList $root, $app, $msg
    } else {
      $kind = if ($MockRunner) { 'mock' } else { $who }
      $jobs[$who] = Start-Job -ScriptBlock $TurnBody -ArgumentList $kind, $who, $root, $claudeExe, (New-Prompt $who)
    }
  }

  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)

# wait for turns in flight, otherwise exiting kills them mid-reply
foreach ($who in @($jobs.Keys)) {
  $job = $jobs[$who]
  Wait-Job $job -Timeout 300 | Out-Null
  $out = (Receive-Job $job -ErrorAction SilentlyContinue | Out-String).Trim()
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Set-Typing $who $false
  $tail = if ($out.Length -gt 200) { $out.Substring($out.Length - 200) } else { $out }
  $reason = Get-BlockReason $out
  if ($reason) {
    $unhealthy[$who] = @{ why = $reason; at = Get-Date }
    Write-Log "@$who RUNNER BLOCKED: $reason"
  } else {
    Write-Log "@$who turn finished: $tail"
  }
}
Write-Log 'crew-daemon stopped'
