$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$WshShell = New-Object -ComObject WScript.Shell
$StartupPath = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupPath "Leave Manager.lnk"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = Join-Path $Root "start-leave-server.bat"
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = "Start Leave Manager server and the leave tunnel at login"
$Shortcut.Save()

Write-Host "Leave Manager has been added to Windows Startup."
Write-Host "At login this starts the server on port 3001 and, when leave-config.yml is present, the leave tunnel."
Write-Host ""
Write-Host "To remove from startup, run: remove-from-startup.ps1"
Write-Host "Or delete: $ShortcutPath"
