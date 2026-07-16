$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "Stop Leave Manager.lnk"

$batPath = Join-Path $Root "stop-leave-server.bat"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "C:\Windows\System32\cmd.exe"
$Shortcut.Arguments = "/c `"$batPath`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = "Stop Leave Manager server (port 3001)"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host "Desktop shortcut created: $ShortcutPath"
