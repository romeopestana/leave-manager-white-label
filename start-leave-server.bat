@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

if exist "%USERPROFILE%\.cloudflared\leave-config.yml" (
  start "Redfiniti leave tunnel" /D "%~dp0" "%~dp0start-leave-tunnel.bat"
)

echo Starting Leave Manager server...
echo Open http://localhost:3001 in your browser.
echo.
echo Backups and log (leave-manager-log.csv) saved to this folder.
echo Press Ctrl+C to stop the server.
echo.
set "PORT=3001"
set "NODEEXE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
"%NODEEXE%" start-server.js
