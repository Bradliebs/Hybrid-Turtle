@echo off
:: ============================================================
:: HybridTurtle Trading Dashboard — One-Click Installer
:: ============================================================
:: This script installs everything a novice needs to run
:: the HybridTurtle dashboard on a fresh Windows machine.
:: ============================================================

title HybridTurtle Installer v6.0
color 0A
setlocal EnableExtensions EnableDelayedExpansion
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
    echo  !! Please install Node.js LTS.
    echo  !! Important: after install finishes, close this window
    echo  !! and run install.bat again.
    echo.
    start https://nodejs.org/en/download/
    echo  Press any key to exit installer...
    pause >nul
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo         Found Node.js %NODE_VER%

:: ── Node.js version compatibility check ──
set "NODE_VER_NO_V=%NODE_VER:v=%"
for /f "tokens=1 delims=." %%i in ("%NODE_VER_NO_V%") do set NODE_MAJOR=%%i
if not "%NODE_MAJOR%"=="20" if not "%NODE_MAJOR%"=="22" (
    echo.
    echo  !! This installer currently supports Node.js 20 or 22 LTS.
    echo  !! You have Node.js %NODE_VER% installed.
    echo  !! Please install Node.js 22 LTS or 20 LTS, then run install.bat again.
    echo  !! On the Node.js website, choose the LTS tab.
    echo.
    echo  !! Opening Node.js download page...
    start https://nodejs.org/en/download/
    pause
    exit /b 1
)

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
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString(''N'')"') do set NEXTAUTH_SECRET=hybridturtle-local-secret-%%i
    echo NEXTAUTH_SECRET="!NEXTAUTH_SECRET!">> .env
    echo.>> .env
    echo # Telegram nightly reports - fill these in during Step 7 or later>> .env
    echo # TELEGRAM_BOT_TOKEN=your-bot-token-here>> .env
    echo # TELEGRAM_CHAT_ID=your-chat-id-here>> .env
    echo         Created .env with SQLite database
) else (
    echo         .env already exists - keeping existing config
)

:: ── Step 4: Install dependencies ──
echo  [4/7] Installing dependencies (this may take 2-5 minutes)...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  !! npm install failed. Common fixes:
    echo  !!   1. Close VS Code and any other editors, then re-run
    echo  !!   2. Run: npm install --ignore-scripts
    echo  !!      then: npx prisma generate
    echo  !!   3. Disable antivirus temporarily
    echo  !!   4. Run installer as Administrator
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

:: Use PowerShell to create a proper shortcut (single line for reliability)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $lnk = Join-Path $desktop '%SHORTCUT_NAME%.lnk'; $sc = $ws.CreateShortcut($lnk); $sc.TargetPath = Join-Path '%SCRIPT_DIR%' 'start.bat'; $sc.WorkingDirectory = '%SCRIPT_DIR%'; $sc.Description = 'Launch HybridTurtle Trading Dashboard'; $sc.IconLocation = 'shell32.dll,21'; $sc.Save()"

if %errorlevel% equ 0 (
    echo         Desktop shortcut created!
) else (
    echo         Could not create shortcut. No problem - you can run start.bat manually.
)

:: ── Step 7: Optional — Nightly Telegram Scheduled Task ──
echo.
echo  [7/7] Nightly Telegram Notifications (optional)
echo.
echo   This sets up a Windows Scheduled Task that runs every
echo   weeknight at 21:10 to send a Telegram summary of your
echo   portfolio - stops, risk gates, laggards, module alerts.
echo.
echo   Requirements:
echo     - A Telegram bot token (from @BotFather)
echo     - Your Telegram chat ID (from @userinfobot)
echo     - PC must be on at 21:10 (runs late if missed)
echo.
set /p SETUP_TELEGRAM="  Set up the nightly Telegram task? (Y/N): "
if /i not "%SETUP_TELEGRAM%"=="Y" if /i not "%SETUP_TELEGRAM%"=="N" (
    echo         Input not recognized, defaulting to N.
    set "SETUP_TELEGRAM=N"
)
if /i "%SETUP_TELEGRAM%"=="Y" (
    echo.
    echo   --- Telegram Credentials ---
    echo.
    echo   To get your bot token:
    echo     1. Open Telegram and message @BotFather
    echo     2. Send /newbot and follow the prompts
    echo     3. Copy the token it gives you
    echo.
    echo   To get your chat ID:
    echo     1. Open Telegram and message @userinfobot
    echo     2. It replies with your numeric ID
    echo.

    :: Check if credentials already exist in .env
    set "HAS_TOKEN="
    set "HAS_CHATID="
    for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
        if "%%a"=="TELEGRAM_BOT_TOKEN" if not "%%b"=="" if not "%%b"=="" set "HAS_TOKEN=1"
        if "%%a"=="TELEGRAM_CHAT_ID" if not "%%b"=="" set "HAS_CHATID=1"
    )

    if defined HAS_TOKEN if defined HAS_CHATID (
        echo         Telegram credentials already found in .env
        echo.
        set /p TG_REPLACE="  Replace existing credentials? (Y/N): "
        if /i not "!TG_REPLACE!"=="Y" (
            echo         Keeping existing credentials.
            goto :skip_tg_creds
        )
    )

    set /p TG_TOKEN="  Paste your Bot Token: "
    if "!TG_TOKEN!"=="" (
        echo         No token entered - skipping Telegram setup.
        set "SETUP_TELEGRAM=N"
        goto :skip_tg_setup
    )

    set /p TG_CHATID="  Paste your Chat ID: "
    if "!TG_CHATID!"=="" (
        echo         No chat ID entered - skipping Telegram setup.
        set "SETUP_TELEGRAM=N"
        goto :skip_tg_setup
    )

    :: Remove any existing Telegram lines from .env, then append new ones
    powershell -NoProfile -Command "$f = Get-Content '.env' | Where-Object { $_ -notmatch '^TELEGRAM_BOT_TOKEN=' -and $_ -notmatch '^TELEGRAM_CHAT_ID=' }; $f += 'TELEGRAM_BOT_TOKEN=!TG_TOKEN!'; $f += 'TELEGRAM_CHAT_ID=!TG_CHATID!'; Set-Content '.env' $f"
    echo         Telegram credentials saved to .env

    :: Send a test message to confirm it works
    echo.
    echo         Sending test message to your Telegram...
    powershell -NoProfile -Command "$r = Invoke-RestMethod -Uri 'https://api.telegram.org/bot!TG_TOKEN!/sendMessage' -Method Post -ContentType 'application/json' -Body ('{\"chat_id\":\"!TG_CHATID!\",\"text\":\"HybridTurtle connected! Nightly reports will arrive here at 21:10 Mon-Fri.\"}'); if ($r.ok) { Write-Output '         Test message sent successfully!' } else { Write-Output '         !! Test message failed - check your token and chat ID.' }" 2>nul || echo         !! Could not reach Telegram API - check your internet connection.

    :skip_tg_creds
    echo.
    echo         Registering scheduled task...

    :: Update nightly-task.bat to use the current install path
    (
        echo @echo off
        echo cd /d "%%~dp0"
        echo echo [%%date%% %%time%%] Starting nightly process... ^>^> nightly.log
        echo call npx tsx src/cron/nightly.ts --run-now ^>^> nightly.log 2^>^&1
        echo echo [%%date%% %%time%%] Nightly process finished ^(exit code: %%ERRORLEVEL%%^) ^>^> nightly.log
    ) > "%~dp0nightly-task.bat"

    :: Create/replace scheduled task using schtasks (more robust across machines)
    set "TASK_NAME=HybridTurtle-Nightly"
    set "NIGHTLY_BAT=%SCRIPT_DIR%nightly-task.bat"
    set "TASK_RUN=cmd.exe /c \"\"%NIGHTLY_BAT%\"\""
    schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
    schtasks /Create /TN "%TASK_NAME%" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 21:10 /TR "%TASK_RUN%" /F >nul 2>&1

    if !errorlevel! equ 0 (
        echo         Scheduled task 'HybridTurtle-Nightly' created!
        echo         Runs Mon-Fri at 21:10. View/edit in Task Scheduler.
        echo         Action: cmd.exe /c ""%NIGHTLY_BAT%""
    ) else (
        echo         !! Could not create scheduled task.
        echo         !! Try running this installer as Administrator.
        echo         !! Manual action should be:
        echo         !! Program/script: cmd.exe
        echo         !! Add arguments: /c ""%NIGHTLY_BAT%""
    )
) else (
    echo         Skipped - you can set this up later by running:
    echo         install.bat or manually in Task Scheduler.
)
:skip_tg_setup

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
if /i not "%LAUNCH%"=="Y" if /i not "%LAUNCH%"=="N" (
    echo         Input not recognized, defaulting to N.
    set "LAUNCH=N"
)
if /i "%LAUNCH%"=="Y" (
    call "%~dp0start.bat"
)

pause
