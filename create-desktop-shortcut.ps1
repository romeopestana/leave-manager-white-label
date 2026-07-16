$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "Leave Manager.lnk"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$batPath = Join-Path $Root "start-leave-server.bat"
$Shortcut.TargetPath = "C:\Windows\System32\cmd.exe"
$Shortcut.Arguments = "/k `"$batPath`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = "Start Leave Manager server"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host "Desktop shortcut created: $ShortcutPath"
