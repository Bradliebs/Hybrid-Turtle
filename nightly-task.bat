@echo off
:: ============================================================
:: HybridTurtle — Nightly Automation
:: ============================================================
:: Double-click to run manually, or schedule via Task Scheduler.
:: Output is shown in the console AND saved to nightly.log.
:: ============================================================

title HybridTurtle Nightly Task
color 0E
setlocal
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   HybridTurtle — Nightly Task
echo  ===========================================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  !! Node.js not found. Please run install.bat first.
    pause
    exit /b 1
)

:: Check .env
if not exist ".env" (
    echo  !! No .env file found. Please run install.bat first.
    pause
    exit /b 1
)

echo  [%date% %time%] Starting nightly process...
echo.

:: Log start timestamp
echo [%date% %time%] Starting nightly process... >> nightly.log

:: Run nightly task — show output in console AND append to log
call npx tsx src/cron/nightly.ts --run-now 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { Write-Host $_; Add-Content -Path 'nightly.log' -Value $_ }"

set EXIT_CODE=%ERRORLEVEL%

echo.
echo  [%date% %time%] Nightly process finished (exit code: %EXIT_CODE%)
echo [%date% %time%] Nightly process finished (exit code: %EXIT_CODE%) >> nightly.log

if %EXIT_CODE% neq 0 (
    echo.
    echo  !! Nightly task failed. Check nightly.log for details.
)

echo.
echo  Full log saved to: nightly.log
echo.
pause
