@echo off
setlocal

set "PORT=3001"
echo Stopping Leave Manager server on port %PORT% ...

set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  set "FOUND=1"
  echo Killing PID %%P ...
  taskkill /PID %%P /F >nul 2>&1
)

if "%FOUND%"=="0" (
  echo No LISTENING process found on port %PORT%.
) else (
  echo Stop command sent. Verifying port ...
  netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING" >nul 2>&1
  if %errorlevel%==0 (
    echo Warning: something is still listening on port %PORT%.
  ) else (
    echo Server stopped.
  )
)

endlocal

