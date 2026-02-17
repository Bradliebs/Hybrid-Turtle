@echo off
setlocal

cd /d "%~dp0"

echo [HybridTurtle] Redirecting to nightly-task.bat...
call "%~dp0nightly-task.bat"

if errorlevel 1 (
  echo.
  echo [HybridTurtle] nightly-task.bat reported an error.
  echo [HybridTurtle] Check nightly.log for details.
  pause
  exit /b 1
)

exit /b 0
