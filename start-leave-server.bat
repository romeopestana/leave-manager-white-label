@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Starting Leave Manager server...
echo Open http://localhost:3001 in your browser.
echo.
echo Backups and log (leave-manager-log.csv) saved to this folder.
echo Press Ctrl+C to stop the server.
echo.
node start-server.js

