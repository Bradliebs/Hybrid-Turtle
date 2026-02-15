@echo off
:: ============================================================
:: HybridTurtle — Update Script v6.0
:: ============================================================
:: Run this after pulling new code to update dependencies
:: and apply any database changes.
:: ============================================================

title HybridTurtle Updater v6.0
color 0E
setlocal
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   HybridTurtle — Updating (v6.0)...
echo  ===========================================================
echo.

:: Stop any running instances
echo  [1/4] Stopping any running instances...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Update dependencies
echo  [2/4] Updating dependencies...
if exist "package-lock.json" (
    call npm ci
) else (
    call npm install
)
if %errorlevel% neq 0 (
    echo  !! npm install failed.
    pause
    exit /b 1
)

:: Regenerate Prisma client
echo  [3/4] Updating database schema...
call npx prisma generate
if %errorlevel% neq 0 (
    echo  !! Prisma generate failed.
    pause
    exit /b 1
)
call npx prisma db push
if %errorlevel% neq 0 (
    echo  !! Database push failed.
    pause
    exit /b 1
)

:: Re-seed (upserts, so safe to re-run)
echo  [4/4] Refreshing stock universe...
call npx prisma db seed 2>nul

echo.
echo  ===========================================================
echo   UPDATE COMPLETE!
echo  ===========================================================
echo.
echo   Run start.bat or double-click the desktop shortcut to launch.
echo.

pause
