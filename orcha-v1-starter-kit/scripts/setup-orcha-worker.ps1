<#
Creates a dedicated WSL distro for the local ORCHA worker. Download an official
Ubuntu 24.04 WSL image first, then pass it with -ImagePath. This script never
uses the owner's existing Ubuntu instance as a base.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$ImagePath,
  [string]$DistroName = 'orcha-worker',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Orcha\wsl\orcha-worker')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$wslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$originalPath = $env:PATH
# Keep WSL from attempting to translate the host agent/tool PATH. The worker
# uses its own Linux PATH and does not need host executables; wslExe is
# absolute so the host command remains available with an empty PATH.
$env:PATH = ''
if (!(Test-Path -LiteralPath $ImagePath)) { throw "Ubuntu WSL image not found: $ImagePath" }
$exists = [bool](& $wslExe -l -q | Where-Object { $_.Trim() -eq $DistroName })
if (!$exists) {
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  & $wslExe --import $DistroName $InstallRoot $ImagePath --version 2
} else {
  Write-Host "Reconfiguring existing $DistroName."
}
$rootCommand = @'
set -euo pipefail
id -u orcha >/dev/null 2>&1 || useradd --create-home --shell /bin/bash orcha
install -d -m 0750 -o orcha -g orcha /home/orcha/workspaces /opt/orcha
install -d -m 0750 -o root -g root /etc/orcha
cat >/etc/wsl.conf <<'EOF'
[automount]
enabled=false
[interop]
appendWindowsPath=false
[boot]
systemd=true
[user]
default=orcha
EOF
apt-get update
apt-get install -y python3 python3-venv git
python3 -m venv /opt/orcha/.venv
/opt/orcha/.venv/bin/pip install --upgrade pip fastapi 'uvicorn[standard]' pydantic httpx playwright
/opt/orcha/.venv/bin/python -m playwright install-deps chromium
su -s /bin/bash -c '/opt/orcha/.venv/bin/python -m playwright install chromium' orcha
chown -R orcha:orcha /opt/orcha /home/orcha/workspaces
cat >/etc/systemd/system/orcha-worker.service <<'EOF'
[Unit]
Description=Orcha local workspace worker
After=network.target

[Service]
Type=simple
User=orcha
Group=orcha
WorkingDirectory=/home/orcha
EnvironmentFile=-/etc/orcha/worker.env
Environment=PYTHONPATH=/opt/orcha/src
ExecStart=/opt/orcha/.venv/bin/python -m orcha.worker.app
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload || true
systemctl enable orcha-worker.service || true
'@
& $wslExe -d $DistroName -u root -- bash -lc $rootCommand

# Copy only the worker source into the distro; drive automounting is disabled
# for the worker itself. Use the distro's UNC filesystem rather than a native
# tar pipeline so PowerShell cannot reinterpret the binary archive stream.
$sourceRoot = Join-Path $projectRoot 'src\orcha'
$destinationRoot = '\\wsl$\' + $DistroName + '\opt\orcha\src\orcha'
if (!(Test-Path -LiteralPath $sourceRoot)) { throw "Worker source not found at $sourceRoot" }
New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force |
  Where-Object { $_.Extension -ne '.pyc' -and $_.FullName -notmatch '\\__pycache__(\\|$)' } |
  ForEach-Object {
    # Windows PowerShell 5.1 does not expose Path.GetRelativePath; every
    # enumerated file is beneath sourceRoot, so this is equivalent and bounded.
    $relative = $_.FullName.Substring($sourceRoot.Length + 1)
    $destination = Join-Path $destinationRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    [System.IO.File]::Copy($_.FullName, $destination, $true)
  }
& $wslExe -d $DistroName -u root -- bash -lc 'chown -R orcha:orcha /opt/orcha && chmod 750 /home/orcha/workspaces'
$null = & $wslExe --terminate $DistroName
$env:PATH = $originalPath
Write-Host "Created $DistroName. Start it with .\scripts\start-orcha-worker.ps1"
