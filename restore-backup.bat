@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: HybridTurtle — Database Restore (emergency, app not required)
:: ============================================================
:: Use this when the app won't start and you need to restore
:: from a backup. The app must be STOPPED before running this.
:: ============================================================

cd /d "%~dp0"

echo ========================================
echo   HybridTurtle Database Restore
echo ========================================
echo.

:: Check the app isn't running
tasklist /FI "IMAGENAME eq node.exe" /FO CSV 2>nul | find /i "node.exe" >nul
if not errorlevel 1 (
    echo WARNING: Node.js is running. Please stop the app first
    echo          ^(close the terminal running start.bat^)
    echo.
    set /p CONTINUE="Continue anyway? (y/N): "
    if /i not "!CONTINUE!"=="y" (
        echo Cancelled.
        pause
        exit /b 1
    )
)

:: Check backup directory exists
if not exist "prisma\backups\" (
    echo ERROR: No backup directory found at prisma\backups\
    echo        Run a backup from Settings first, or run the nightly.
    pause
    exit /b 1
)

:: List available backups
echo Available backups:
echo.
set COUNT=0
for /f "delims=" %%f in ('dir /b /o-n "prisma\backups\dev.db.backup-*" 2^>nul') do (
    set /a COUNT+=1
    set "BACKUP_!COUNT!=%%f"
    
    :: Get file size
    for %%s in ("prisma\backups\%%f") do (
        set "SIZE=%%~zs"
    )
    
    echo   !COUNT!. %%f  ^(!SIZE! bytes^)
)

if %COUNT%==0 (
    echo   No backup files found in prisma\backups\
    echo.
    echo   Run a backup from Settings or wait for the nightly pipeline.
    pause
    exit /b 1
)

echo.
set /p CHOICE="Enter backup number to restore (1-%COUNT%), or Q to quit: "

if /i "%CHOICE%"=="q" (
    echo Cancelled.
    pause
    exit /b 0
)

:: Validate choice
set "SELECTED=!BACKUP_%CHOICE%!"
if "%SELECTED%"=="" (
    echo Invalid selection.
    pause
    exit /b 1
)

echo.
echo You selected: %SELECTED%
echo.
echo This will:
echo   1. Create a safety backup of the CURRENT database
echo   2. Replace prisma\dev.db with the selected backup
echo.
set /p CONFIRM="Are you sure? (y/N): "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

:: Create safety backup of current DB
if exist "prisma\dev.db" (
    echo.
    echo Creating safety backup of current database...
    copy /y "prisma\dev.db" "prisma\backups\dev.db.pre-restore-%date:~-4%%date:~3,2%%date:~0,2%" >nul 2>&1
    if errorlevel 1 (
        echo WARNING: Could not create safety backup. Proceeding anyway...
    ) else (
        echo   Saved as: dev.db.pre-restore-%date:~-4%%date:~3,2%%date:~0,2%
    )
)

:: Perform the restore
echo.
echo Restoring from %SELECTED%...
copy /y "prisma\backups\%SELECTED%" "prisma\dev.db" >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Restore failed! The file copy did not succeed.
    echo        Check that no other process has dev.db locked.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Restore complete!
echo ========================================
echo.
echo   Restored from: %SELECTED%
echo   Database file:  prisma\dev.db
echo.
echo   Start the app with: start.bat
echo ========================================
echo.

pause
