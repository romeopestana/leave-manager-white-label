@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Named tunnel redfiniti-leave only. This does not start the accounts tunnel.
set "CFG=%USERPROFILE%\.cloudflared\leave-config.yml"
if not exist "%CFG%" (
  echo Leave tunnel config was not found, so the tunnel was skipped.
  exit /b 0
)

powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like '*leave-config.yml*' -and $_.CommandLine -like '*redfiniti-leave*' }) { exit 0 } else { exit 1 }"
if %ERRORLEVEL%==0 (
  echo Leave tunnel is already running.
  exit /b 0
)

set "CFEXE="
if exist "%USERPROFILE%\Redfiniti-Management-Accounts\tmp\cloudflared.exe" (
  set "CFEXE=%USERPROFILE%\Redfiniti-Management-Accounts\tmp\cloudflared.exe"
)
if not defined CFEXE (
  for /f "delims=" %%I in ('where cloudflared 2^>nul') do (
    if not defined CFEXE set "CFEXE=%%I"
  )
)
if not defined CFEXE (
  echo cloudflared.exe was not found, so the leave tunnel was skipped.
  exit /b 0
)

echo Starting leave.redfiniti.com tunnel...
"%CFEXE%" tunnel --config "%CFG%" --no-autoupdate run redfiniti-leave