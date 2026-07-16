@echo off
cd /d "%~dp0"

rem --- Optional Postgres auto-enable ---
rem If DATABASE_URL is not already set, try to load it from a local ".env" file
rem in this same folder.

if "%DATABASE_URL%"=="" (
  set "ENV_FILE=%~dp0.env"
  if exist "%ENV_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
      if /i "%%A"=="DATABASE_URL" (
        set "DATABASE_URL=%%B"
      )
    )
  )
)

if not "%DATABASE_URL%"=="" (
  echo Postgres enabled (DATABASE_URL loaded).
) else (
  echo Postgres disabled (set DATABASE_URL or create a .env file with DATABASE_URL=...).
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Starting Leave Manager server...
echo Open http://localhost:3000 in your browser.
echo.
echo Backups and log (leave-manager-log.csv) saved to this folder.
echo Press Ctrl+C to stop the server.
echo.
node server.js
pause

