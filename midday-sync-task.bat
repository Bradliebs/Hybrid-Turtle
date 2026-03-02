@echo off
:: ============================================================
:: HybridTurtle — Midday Position Sync
:: ============================================================
:: Lightweight intra-day T212 position sync.
:: Runs position-closure detection only (no stops, no scans).
:: Double-click to run manually, or schedule via Task Scheduler.
:: ============================================================

title HybridTurtle Midday Sync
color 0B
setlocal
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   HybridTurtle — Midday Position Sync
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

echo  [%date% %time%] Starting midday position sync...
echo.

:: Log start timestamp
echo [%date% %time%] Starting midday sync... >> midday-sync.log

:: Run midday sync — show output in console AND save to log
call npx tsx src/cron/midday-sync.ts 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath 'midday-sync.log' -Append"

set EXIT_CODE=%ERRORLEVEL%

echo.
echo  [%date% %time%] Midday sync finished (exit code: %EXIT_CODE%)
echo [%date% %time%] Midday sync finished (exit code: %EXIT_CODE%) >> midday-sync.log

if %EXIT_CODE% neq 0 (
    echo.
    echo  !! Midday sync failed. Check midday-sync.log for details.
)

echo.
echo  Full log saved to: midday-sync.log
echo.
:: Only pause when running interactively (not from Task Scheduler)
if /i NOT "%~1"=="--scheduled" pause
