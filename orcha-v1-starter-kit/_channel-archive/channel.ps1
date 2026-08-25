#requires -version 5
<#
  Shared agent channel.
    .\channel.ps1                    open replies + the last 30 lines
    .\channel.ps1 <who> --inbox      only what <who> owes a reply to
    .\channel.ps1 <who> --typing     signal "responding"; --done clears it
    .\channel.ps1 <who> "message"    post
#>
param(
  [Parameter(Position = 0)][string]$From,
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Message
)

$file = Join-Path $PSScriptRoot 'CHANNEL.md'
$api = 'http://127.0.0.1:5173/api/channel'
if (-not (Test-Path $file)) { Write-Error "CHANNEL.md not found next to this script"; exit 1 }

function Show-Owed([string]$Only) {
  try { $data = Invoke-RestMethod -Uri $api -TimeoutSec 4 } catch { return }
  $owed = @($data.owed)
  if ($Only) { $owed = @($owed | Where-Object { $_.to -eq $Only }) }
  if ($owed.Count -eq 0) {
    if ($Only) { Write-Host "Nothing owed by @$Only." } else { Write-Host 'OPEN REPLIES: none' }
    return
  }
  Write-Host 'OPEN REPLIES - reply to these before other work:'
  foreach ($o in $owed) {
    Write-Host ("  @{0,-9} owes @{1,-8} ({2})  {3}" -f $o.to, $o.from, $o.time, $o.excerpt)
  }
}

if (-not $From) {
  Show-Owed
  Write-Host ''
  Get-Content $file -Tail 30
  exit 0
}

if ($Message.Count -eq 1 -and $Message[0] -eq '--inbox') { Show-Owed $From; exit 0 }

if ($Message.Count -eq 1 -and ($Message[0] -eq '--typing' -or $Message[0] -eq '--done')) {
  $on = if ($Message[0] -eq '--typing') { 'true' } else { 'false' }
  try {
    Invoke-RestMethod -Method Post -Uri $api -ContentType 'application/json' -Body "{""from"":""$From"",""typing"":$on}" | Out-Null
    Write-Host "@$From typing=$on"
  } catch { Write-Error 'dev server not reachable on :5173' }
  exit 0
}
if (-not $Message) { Write-Error 'Usage: .\channel.ps1 <who> "<message>"'; exit 1 }

$body = ($Message -join ' ')
# Prefer the Vite API so sandboxed agents (Codex) can post without writing the file.
try {
  $payload = @{ from = $From; body = $body } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri $api -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 6 | Out-Null
  Write-Host "posted to CHANNEL.md as @$From"
  Show-Owed $From
  exit 0
} catch {
  # fall through to direct file append
}

$today = Get-Date -Format 'yyyy-MM-dd'
if (-not (Select-String -Path $file -SimpleMatch "## $today" -Quiet)) {
  Add-Content $file "`n## $today" -Encoding utf8
}

$stamp = Get-Date -Format 'HH:mm'
Add-Content $file "`n### $stamp @$From`n$body" -Encoding utf8
Write-Host "posted to CHANNEL.md as @$From"
Show-Owed $From
