<#
Registers the local Orcha runtime to start when the current Windows user logs
in. This keeps the API, scheduler, and dedicated WSL worker available after a
normal reboot; it does not run before login and it cannot survive a powered-off
PC. Use -IncludePhonePilot to also supervise Vite and the temporary Cloudflare
Quick Tunnel. Use -Uninstall to remove only this named task.
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'Orcha Local Runtime',
  [string]$DistroName = 'orcha-worker',
  [string]$EnvironmentFile = '',
  [int]$ApiPort = 8080,
  [int]$UiPort = 5175,
  [string]$NpmPath = '',
  [ValidateRange(5, 180)]
  [int]$ReadyTimeoutSeconds = 30,
  [switch]$IncludePhonePilot,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvironmentFile = if ($EnvironmentFile) { $EnvironmentFile } else { Join-Path $root 'orcha.local.env' }
$watchScript = if ($IncludePhonePilot) {
  Join-Path $PSScriptRoot 'watch-orcha-pilot.ps1'
} else {
  Join-Path $PSScriptRoot 'watch-orcha-local.ps1'
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$TaskName'."
  exit 0
}

if (-not (Test-Path -LiteralPath $watchScript)) {
  throw "Orcha supervisor script not found at $watchScript"
}
if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
  Write-Warning "No private environment file found at $EnvironmentFile. The runtime can start, but model-backed agents will remain blocked until it is configured."
}

$shell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -DistroName "{1}" -EnvironmentFile "{2}" -ApiPort {3}' -f $watchScript, $DistroName, $EnvironmentFile, $ApiPort
$description = 'Supervises the Orcha local API, scheduler, and dedicated WSL worker after this user logs in.'
if ($IncludePhonePilot) {
  $arguments += ' -UiPort {0} -NpmPath "{1}" -ReadyTimeoutSeconds {2}' -f $UiPort, $NpmPath, $ReadyTimeoutSeconds
  $description = 'Supervises the Orcha local API, WSL worker, Vite cockpit, and temporary phone tunnel after this user logs in.'
}
$action = New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force | Out-Null
Write-Host "Registered '$TaskName' for $env:USERDOMAIN\$env:USERNAME."
if ($IncludePhonePilot) {
  Write-Host 'The phone-pilot supervisor checks API, worker, Vite, and the managed Cloudflare tunnel.'
} else {
  Write-Host 'The supervisor checks the local API, scheduler, and dedicated worker.'
}
Write-Host 'The runtime still requires this PC to be on and the user to be logged in.'
