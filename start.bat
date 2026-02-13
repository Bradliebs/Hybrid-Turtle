@echo off
:: ============================================================
:: HybridTurtle Trading Dashboard — Launcher
:: ============================================================
:: Double-click this to start the dashboard.
:: It will open your browser automatically.
:: ============================================================

title HybridTurtle Dashboard
color 0B
setlocal
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   HybridTurtle Trading Dashboard v5.11
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

:: Check node_modules
if not exist "node_modules" (
    echo  Dependencies not found — installing now...
    call npm install
    if %errorlevel% neq 0 (
        echo  !! npm install failed.
        pause
        exit /b 1
    )
)

:: Ensure Prisma client is generated
if not exist "node_modules\.prisma" (
    echo  Generating Prisma client...
    call npx prisma generate
    if %errorlevel% neq 0 (
        echo  !! Prisma generate failed.
        pause
        exit /b 1
    )
)

:: Ensure database exists
if not exist "prisma\dev.db" (
    echo  Setting up database...
    call npx prisma db push
    call npx prisma db seed 2>nul
)

:: Kill any stale node processes on port 3000
echo  Checking for stale processes...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: Wait a moment for the port to free up
timeout /t 1 /nobreak >nul

echo  Starting dashboard server...
echo.
echo  ───────────────────────────────────────────────────────────
echo   Dashboard will open at: http://localhost:3000
echo.
echo   Keep this window open while using the dashboard.
echo   Press Ctrl+C or close this window to stop.
echo  ───────────────────────────────────────────────────────────
echo.

:: Open browser after a short delay (background task)
start /min cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000/dashboard"

:: Start the dev server (blocks until user closes)
call npm run dev

pause
