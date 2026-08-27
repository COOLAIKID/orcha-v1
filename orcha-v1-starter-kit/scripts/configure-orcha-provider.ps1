[CmdletBinding()]
param(
  [ValidateSet('openrouter', 'gemini', 'groq', 'openai')]
  [string]$Provider = '',
  [string]$Model = '',
  [ValidateRange(0, 7)]
  [int]$AdditionalKeyCount = -1,
  [string]$EnvironmentFile = ''
)

<#
Configures one server-side model provider for the local Orcha API.

This helper intentionally never accepts a key as a command-line argument. The
key is entered through Read-Host -AsSecureString, stored only in the private
API-host environment file, and is never printed. It does not make a provider
request, so running it does not spend quota. Restart the API after saving.
#>

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$exampleFile = Join-Path $root 'orcha.local.env.example'
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $root 'orcha.local.env' }

function Read-RequiredValue {
  param([Parameter(Mandatory)][string]$Prompt)

  do {
    $value = (Read-Host $Prompt).Trim()
    if (-not $value) { Write-Warning 'A value is required.' }
  } while (-not $value)
  return $value
}

function Read-RequiredSecret {
  param([Parameter(Mandatory)][string]$Prompt)

  do {
    $secure = Read-Host $Prompt -AsSecureString
    $value = [System.Net.NetworkCredential]::new('', $secure).Password
    if (-not $value) { Write-Warning 'A non-empty key is required.' }
  } while (-not $value)
  return $value
}

if (-not $Provider) {
  $Provider = (Read-Host 'Provider [openrouter, gemini, groq, openai] (default: openrouter)').Trim().ToLowerInvariant()
  if (-not $Provider) { $Provider = 'openrouter' }
}
if ($Provider -notin @('openrouter', 'gemini', 'groq', 'openai')) {
  throw "Unsupported provider '$Provider'. Use openrouter, gemini, groq, or openai."
}

if (-not $Model) {
  $Model = Read-RequiredValue "Model id for $Provider (for example provider/model-name)"
}

if ($AdditionalKeyCount -lt 0) {
  $additionalText = (Read-Host 'Additional temporary keys to add (0-7, default: 0)').Trim()
  if (-not $additionalText) { $AdditionalKeyCount = 0 }
  elseif ($additionalText -notmatch '^\d+$' -or [int]$additionalText -gt 7) {
    throw 'Additional key count must be a whole number from 0 through 7.'
  } else {
    $AdditionalKeyCount = [int]$additionalText
  }
}

$keys = [System.Collections.Generic.List[string]]::new()
[void]$keys.Add((Read-RequiredSecret "API key for $Provider (hidden)"))
for ($index = 1; $index -le $AdditionalKeyCount; $index += 1) {
  [void]$keys.Add((Read-RequiredSecret "Additional API key $index for $Provider (hidden)"))
}

$directory = Split-Path -Parent $EnvironmentFile
if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }

$lines = [System.Collections.Generic.List[string]]::new()
$seed = if (Test-Path -LiteralPath $EnvironmentFile) { $EnvironmentFile } elseif (Test-Path -LiteralPath $exampleFile) { $exampleFile } else { $null }
if ($seed) {
  foreach ($line in Get-Content -LiteralPath $seed) { [void]$lines.Add([string]$line) }
}

function Set-EnvValue {
  param(
    [Parameter(Mandatory)][System.Collections.Generic.List[string]]$Lines,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Value
  )

  $pattern = '^' + [regex]::Escape($Name) + '='
  $found = $false
  for ($lineIndex = 0; $lineIndex -lt $Lines.Count; $lineIndex += 1) {
    if ($Lines[$lineIndex] -match $pattern) {
      $Lines[$lineIndex] = "$Name=$Value"
      $found = $true
    }
  }
  if (-not $found) { [void]$Lines.Add("$Name=$Value") }
}

$providerUpper = $Provider.ToUpperInvariant()
Set-EnvValue -Lines $lines -Name 'ORCHA_AGENT_PROVIDER' -Value $Provider
Set-EnvValue -Lines $lines -Name "ORCHA_AGENT_${providerUpper}_MODEL" -Value $Model
# Prefer the namespaced pool. Clear compatible singular/unprefixed values so
# an older key cannot silently remain active alongside the newly configured one.
Set-EnvValue -Lines $lines -Name "ORCHA_AGENT_${providerUpper}_API_KEYS" -Value ($keys -join ',')
Set-EnvValue -Lines $lines -Name "${providerUpper}_API_KEYS" -Value ''
Set-EnvValue -Lines $lines -Name "${providerUpper}_API_KEY" -Value ''

Set-Content -LiteralPath $EnvironmentFile -Value @($lines) -Encoding utf8

# The API process reads this file as a secret-bearing host configuration. Drop
# inherited ACLs and grant the current interactive owner full control only.
$identity = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
& icacls.exe $EnvironmentFile /inheritance:r /grant:r "${identity}:(F)" 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Provider saved, but Windows could not tighten the ACL on $EnvironmentFile. Review its permissions before using a shared PC."
}

Write-Host "Saved private $Provider provider configuration to $EnvironmentFile."
Write-Host "Configured key count: $($keys.Count) (key values were not displayed)."
Write-Host 'Restart the API before starting a model-backed company:'
Write-Host '  .\scripts\stop-orcha-api.ps1'
Write-Host '  .\scripts\start-orcha-api.ps1'
Write-Host 'Then verify without exposing secrets:'
Write-Host '  Invoke-RestMethod http://127.0.0.1:8080/v1/runtime/health'
