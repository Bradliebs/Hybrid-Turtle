@echo off
:: Registers HybridTurtle Watchdog scheduled task (self-elevates)
:: Runs daily at 10:00 AM to check for missed nightly/midday heartbeats.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process cmd -Verb RunAs -ArgumentList '/c \"%~f0\"'"
    exit /b
)

echo.
echo  ==========================================================
echo   HybridTurtle — Registering Watchdog Scheduled Task
echo  ==========================================================
echo.

:: Delete existing task
schtasks /delete /tn "HybridTurtle Watchdog" /f >nul 2>&1

:: Register: runs daily at 10:00 AM
schtasks /create /tn "HybridTurtle Watchdog" /tr "\"%~dp0watchdog-task.bat\"" /sc daily /st 10:00 /rl highest /f

if %errorlevel% equ 0 (
    echo.
    echo  [OK] Task "HybridTurtle Watchdog" registered — runs daily at 10:00 AM
) else (
    echo.
    echo  [FAIL] Could not register task. Try running as Administrator.
)

echo.
pause
