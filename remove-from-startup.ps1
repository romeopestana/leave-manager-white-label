$StartupPath = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupPath "Leave Manager.lnk"

if (Test-Path $ShortcutPath) {
    Remove-Item $ShortcutPath -Force
    Write-Host "Leave Manager has been removed from Windows Startup."
} else {
    Write-Host "Leave Manager was not in the Startup folder."
}
