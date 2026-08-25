#requires -version 5
<#
  Give a GUI agent a turn by typing into its window.

  Cursor, OpenCode and the ChatGPT/Codex desktop app have no CLI, so the only way
  to start a turn in them is the same way a person does: focus the window, type,
  press Enter.

  Safety: the target window is verified to be foreground AND owned by the expected
  process before a single key is sent. If focus lands anywhere else the script
  aborts rather than typing into whatever happens to be in front.

    .\desktop-wake.ps1 -App opencode -Message "check your inbox"
    .\desktop-wake.ps1 -App cursor   -Message "..." -WhatIf
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('cursor', 'opencode', 'chatgpt', 'claude')][string]$App,
  [Parameter(Mandatory = $true)][string]$Message,
  [int]$FocusTimeoutMs = 4000,
  [switch]$WhatIf
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  // Windows refuses SetForegroundWindow from a background process. Attaching to
  // the current foreground thread lifts that restriction; the ALT tap is the
  // long-standing companion trick for the same lock.
  public static void Force(IntPtr hWnd) {
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
    uint thisThread = GetCurrentThreadId();
    keybd_event(0x12, 0, 0, UIntPtr.Zero);        // ALT down
    keybd_event(0x12, 0, 2, UIntPtr.Zero);        // ALT up
    if (fgThread != thisThread) AttachThreadInput(thisThread, fgThread, true);
    ShowWindow(hWnd, 9);
    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);
    if (fgThread != thisThread) AttachThreadInput(thisThread, fgThread, false);
  }
}
"@ -ErrorAction SilentlyContinue

$patterns = @{
  cursor   = '^cursor$'
  opencode = '^opencode$'
  chatgpt  = '^chatgpt$'
  claude   = '^claude$'
}

$proc = Get-Process |
  Where-Object { $_.ProcessName -match $patterns[$App] -and $_.MainWindowHandle -ne 0 } |
  Sort-Object { $_.MainWindowTitle.Length } -Descending |
  Select-Object -First 1

if (-not $proc) { Write-Output "FAIL no window for $App"; exit 1 }

$hwnd = $proc.MainWindowHandle
if ([Win32Fg]::IsIconic($hwnd)) { [Win32Fg]::ShowWindow($hwnd, 9) | Out-Null }  # SW_RESTORE
[Win32Fg]::Force($hwnd)

# Confirm the window we asked for actually took focus before sending any keys.
$deadline = (Get-Date).AddMilliseconds($FocusTimeoutMs)
$ok = $false
while ((Get-Date) -lt $deadline) {
  $fg = [Win32Fg]::GetForegroundWindow()
  $fgPid = 0
  [Win32Fg]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
  if ($fg -eq $hwnd -and $fgPid -eq $proc.Id) { $ok = $true; break }
  Start-Sleep -Milliseconds 150
}
if (-not $ok) { Write-Output "FAIL $App did not take focus - no keys sent"; exit 2 }

if ($WhatIf) { Write-Output "WHATIF would type into $App ($($proc.MainWindowTitle))"; exit 0 }

# SendKeys treats these as control characters; send them literally instead.
$escaped = $Message -replace '([+^%~(){}\[\]])', '{$1}'

Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait($escaped)
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')

Write-Output "OK typed into $App (pid $($proc.Id))"
