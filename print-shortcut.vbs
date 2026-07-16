Option Explicit

Dim WshShell, Shortcut, ShortcutPath
Dim TargetPath, Arguments, WorkingDirectory, Description
Dim WindowStyle

ShortcutPath = WScript.Arguments(0)

Set WshShell = CreateObject("WScript.Shell")
Set Shortcut = WshShell.CreateShortcut(ShortcutPath)

TargetPath = Shortcut.TargetPath
Arguments = Shortcut.Arguments
WorkingDirectory = Shortcut.WorkingDirectory
Description = Shortcut.Description
WindowStyle = Shortcut.WindowStyle

WScript.Echo "TargetPath=" & TargetPath
WScript.Echo "Arguments=" & Arguments
WScript.Echo "WorkingDirectory=" & WorkingDirectory
WScript.Echo "Description=" & Description
WScript.Echo "WindowStyle=" & WindowStyle

