@echo off
:: ============================================================
:: HybridTurtle Trading Dashboard — One-Click Installer
:: ============================================================
:: This script installs everything a novice needs to run
:: the HybridTurtle dashboard on a fresh Windows machine.
:: ============================================================

title HybridTurtle Installer v6.0
color 0A
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ===========================================================
echo       _  _      _        _    _  _____          _   _
echo     ^| ^|^| ^|_  _^| ^|__  _ ^(_) ^|^|_^|_   _^|_  _ _ ^|_^| ^| ___
echo     ^|  _  ^| ^|^| ^| '_ \^| '__^| ^| / _` ^| ^| ^|  ^| ^| ^| '_^|  _^|^| / -_^)
echo     ^|_^| ^|_^|\_, ^|_.__/^|_^|  ^|_^|\__,_^| ^|_^|  ^|___^|_^|  ^|_^|^| ^|_\___^|
echo            ^|__/
echo  ===========================================================
echo       Trading Dashboard Installer v6.0
echo  ===========================================================
echo.

:: ── Step 1: Check for Node.js ──
echo  [1/7] Checking for Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  !! Node.js is NOT installed.
    echo  !! Opening the Node.js download page...
    echo  !! Please install Node.js LTS, then re-run this installer.
    echo.
    start https://nodejs.org/en/download/
    echo  Press any key after you have installed Node.js...
    pause >nul
    where node >nul 2>&1
    if !errorlevel! neq 0 (
        echo.
        echo  !! Node.js still not found. Please install it and try again.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo         Found Node.js %NODE_VER%

:: ── Step 2: Check npm ──
echo  [2/7] Checking npm...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  !! npm not found. It should come with Node.js.
    echo  !! Please reinstall Node.js from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do set NPM_VER=%%i
echo         Found npm v%NPM_VER%

:: ── Step 3: Create .env if missing ──
echo  [3/7] Setting up environment...
if not exist ".env" (
    echo DATABASE_URL="file:./dev.db"> .env
    echo NEXTAUTH_URL="http://localhost:3000">> .env
    echo NEXTAUTH_SECRET="hybridturtle-local-secret-%RANDOM%%RANDOM%">> .env
    echo         Created .env with SQLite database
) else (
    echo         .env already exists — keeping existing config
)

:: ── Step 4: Install dependencies ──
echo  [4/7] Installing dependencies (this may take 2-5 minutes)...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  !! npm install failed.
    echo  !! Try: 1) Close antivirus  2) Run as Administrator  3) Reboot
    pause
    exit /b 1
)

:: ── Step 5: Setup database ──
echo.
echo  [5/7] Setting up database...
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

:: Seed the database with stock universe
echo         Seeding stock universe...
call npx prisma db seed 2>nul
if %errorlevel% neq 0 (
    echo         Note: Seed may have already been applied — continuing.
)

:: ── Step 6: Create desktop shortcut ──
echo  [6/7] Creating desktop shortcut...
set SCRIPT_DIR=%~dp0
set SHORTCUT_NAME=HybridTurtle Dashboard

:: Use PowerShell to create a proper shortcut
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\%SHORTCUT_NAME%.lnk'); ^
   $sc.TargetPath = '%SCRIPT_DIR%start.bat'; ^
   $sc.WorkingDirectory = '%SCRIPT_DIR%'; ^
   $sc.Description = 'Launch HybridTurtle Trading Dashboard'; ^
   $sc.IconLocation = 'shell32.dll,21'; ^
   $sc.Save()"

if %errorlevel% equ 0 (
    echo         Desktop shortcut created!
) else (
    echo         Could not create shortcut — you can run start.bat manually.
)

:: ── Step 7: Optional — Nightly Telegram Scheduled Task ──
echo.
echo  [7/7] Nightly Telegram Notifications (optional)
echo.
echo   This sets up a Windows Scheduled Task that runs every
echo   weeknight at 21:10 to send a Telegram summary of your
echo   portfolio — stops, risk gates, laggards, module alerts.
echo.
echo   Requirements:
echo     - TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env
echo     - PC must be on at 21:10 (runs late if missed)
echo.
set /p SETUP_TELEGRAM="  Set up the nightly Telegram task? (Y/N): "
if /i "%SETUP_TELEGRAM%"=="Y" (
    echo.
    echo         Registering scheduled task...

    :: Update nightly-task.bat to use the current install path
    (
        echo @echo off
        echo cd /d "%%~dp0"
        echo echo [%%date%% %%time%%] Starting nightly process... ^>^> nightly.log
        echo call npx ts-node src/cron/nightly.ts --run-now ^>^> nightly.log 2^>^&1
        echo echo [%%date%% %%time%%] Nightly process finished ^(exit code: %%ERRORLEVEL%%^) ^>^> nightly.log
    ) > "%~dp0nightly-task.bat"

    :: Create the Windows Scheduled Task
    powershell -NoProfile -Command ^
      "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c \"%SCRIPT_DIR%nightly-task.bat\"' -WorkingDirectory '%SCRIPT_DIR%'; ^
       $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '21:10'; ^
       $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd; ^
       Register-ScheduledTask -TaskName 'HybridTurtle-Nightly' -Action $action -Trigger $trigger -Settings $settings -Description 'HybridTurtle nightly Telegram summary' -Force"

    if !errorlevel! equ 0 (
        echo         Scheduled task 'HybridTurtle-Nightly' created!
        echo         Runs Mon-Fri at 21:10. View/edit in Task Scheduler.
    ) else (
        echo         !! Could not create scheduled task.
        echo         !! Try running this installer as Administrator.
    )
) else (
    echo         Skipped — you can set this up later by running:
    echo         install.bat or manually in Task Scheduler.
)

:: ── Done! ──
echo.
echo  ===========================================================
echo   INSTALLATION COMPLETE!
echo  ===========================================================
echo.
echo   To launch the dashboard:
echo     - Double-click "HybridTurtle Dashboard" on your Desktop
echo     - OR run start.bat in this folder
echo.
echo   The dashboard will open at: http://localhost:3000
echo.
echo   First run may take a moment while the app compiles.
if /i "%SETUP_TELEGRAM%"=="Y" (
    echo.
    echo   Telegram: Nightly summary at 21:10 Mon-Fri
)
echo  ===========================================================
echo.

set /p LAUNCH="  Launch the dashboard now? (Y/N): "
if /i "%LAUNCH%"=="Y" (
    call "%~dp0start.bat"
)

pause
