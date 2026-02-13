@echo off
setlocal

cd /d "%~dp0"

echo [HybridTurtle] Redirecting to start.bat...
call "%~dp0start.bat"

if errorlevel 1 (
  echo.
  echo [HybridTurtle] start.bat reported an error.
  pause
  exit /b 1
)

exit /b 0
