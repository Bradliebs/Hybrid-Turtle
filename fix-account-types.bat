@echo off
:: ============================================================
:: HybridTurtle — Fix Account Types (ISA vs Invest)
:: ============================================================
:: Double-click this if stop-loss placements are failing with
:: "selling-equity-not-owned" errors.
::
:: It checks each open position against Trading 212 and
:: corrects any ISA/Invest mismatches.
:: ============================================================

title HybridTurtle — Fix Account Types
color 0E
setlocal
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   HybridTurtle — Account Type Fix (ISA vs Invest)
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
    echo  !! Dependencies not found. Please run install.bat first.
    pause
    exit /b 1
)

:: Run the fix script (interactive — will ask for confirmation)
call npx tsx scripts/fix-account-types.ts

echo.
pause
