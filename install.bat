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

:: ── Install log ──
set "LOG=%~dp0install.log"
>> "%LOG%" echo.
>> "%LOG%" echo [%date% %time%] ====== Starting install ======
echo  (logging to install.log)

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
>> "%LOG%" echo [%date% %time%] Node.js %NODE_VER%

:: ── Node.js version compatibility check ──
set "NODE_VER_NO_V=%NODE_VER:v=%"
for /f "tokens=1 delims=." %%i in ("%NODE_VER_NO_V%") do set NODE_MAJOR=%%i
if %NODE_MAJOR% LSS 18 (
    echo.
    echo  !! This installer requires Node.js 18 or higher.
    echo  !! You have Node.js %NODE_VER% installed.
    echo  !! Please install a current Node.js LTS version, then run install.bat again.
    echo  !! On the Node.js website, choose the LTS tab.
    echo.
    echo  !! Opening Node.js download page...
    >> "%LOG%" echo [%date% %time%] FAIL: Node.js too old: %NODE_VER%
    start https://nodejs.org/en/download/
    pause
    exit /b 1
)

:: ── Node.js architecture check ──
for /f "tokens=*" %%i in ('node -e "console.log(process.arch)"') do set NODE_ARCH=%%i
echo         Architecture: %NODE_ARCH%
echo %NODE_ARCH% | findstr /i "x64 arm64" >nul
if %errorlevel% neq 0 (
    echo.
    echo  !! 64-bit Node.js is required. You have: %NODE_ARCH%
    echo  !! Please install the 64-bit ^(x64^) version from https://nodejs.org
    >> "%LOG%" echo [%date% %time%] FAIL: Wrong architecture: %NODE_ARCH%
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

:: ── Pre-flight: Verify PowerShell ──
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo  !! PowerShell not found. Required for installation.
    >> "%LOG%" echo [%date% %time%] FAIL: PowerShell not found
    pause
    exit /b 1
)

:: ── Step 3: Create .env if missing ──
echo  [3/7] Setting up environment...
if not exist ".env" (
    :: Generate a cryptographically random secret (32 bytes, base64)
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)"') do set NEXTAUTH_SECRET=%%i
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)"') do set CRON_SECRET=%%i
    > ".env" echo DATABASE_URL=file:./dev.db
    >> ".env" echo NEXTAUTH_URL=http://localhost:3000
    >> ".env" echo NEXTAUTH_SECRET=!NEXTAUTH_SECRET!
    >> ".env" echo CRON_SECRET=!CRON_SECRET!
    >> ".env" echo.
    >> ".env" echo # Telegram nightly reports - fill these in during Step 7 or later
    >> ".env" echo # TELEGRAM_BOT_TOKEN=your-bot-token-here
    >> ".env" echo # TELEGRAM_CHAT_ID=your-chat-id-here
    echo         Created .env with SQLite database
    >> "%LOG%" echo [%date% %time%] Created .env
) else (
    echo         .env already exists - keeping existing config
    >> "%LOG%" echo [%date% %time%] .env already exists - skipped
)

:: ── Step 4: Install dependencies ──
echo  [4/7] Installing dependencies (this may take 2-5 minutes)...
echo.
:: Use npm ci for reproducible installs when lockfile exists; fall back to npm install
if exist "package-lock.json" (
    call npm ci >> "%LOG%" 2>&1
) else (
    call npm install >> "%LOG%" 2>&1
)
if errorlevel 1 (
    echo.
    echo  !! npm install failed. Common fixes:
    echo  !!   1. Close VS Code and any other editors, then re-run
    echo  !!   2. Run: npm install --ignore-scripts
    echo  !!      then: npx prisma generate
    echo  !!   3. Disable antivirus temporarily
    echo  !!   4. Run installer as Administrator
    echo  !! See install.log for details.
    >> "%LOG%" echo [%date% %time%] FAIL: npm install
    goto :fail
)
>> "%LOG%" echo [%date% %time%] npm install OK

:: ── Step 5: Setup database ──
echo.
echo  [5/7] Setting up database...
call npx prisma generate >> "%LOG%" 2>&1
if errorlevel 1 (
    echo  !! Prisma generate failed. See install.log for details.
    >> "%LOG%" echo [%date% %time%] FAIL: prisma generate
    goto :fail
)

call npx prisma db push >> "%LOG%" 2>&1
if errorlevel 1 (
    echo  !! Database push failed. See install.log for details.
    >> "%LOG%" echo [%date% %time%] FAIL: prisma db push
    goto :fail
)

:: Seed the database with stock universe (idempotent — safe to re-run)
echo         Seeding stock universe...
call npx prisma db seed >> "%LOG%" 2>&1
if errorlevel 1 (
    echo         Note: Seed may have already been applied — continuing.
)
>> "%LOG%" echo [%date% %time%] Database setup OK

:: ── Step 6: Create desktop shortcut ──
echo  [6/7] Creating desktop shortcut...
set "SCRIPT_DIR=%~dp0"
set "SHORTCUT_NAME=HybridTurtle Dashboard"

:: Use PowerShell to create a proper shortcut (paths are escaped to handle special chars)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$scriptDir = '%SCRIPT_DIR%' -replace \"'\", \"''\"; $ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $lnk = Join-Path $desktop '%SHORTCUT_NAME%.lnk'; $sc = $ws.CreateShortcut($lnk); $sc.TargetPath = Join-Path $scriptDir 'start.bat'; $sc.WorkingDirectory = $scriptDir; $sc.Description = 'Launch HybridTurtle Trading Dashboard'; $sc.IconLocation = 'shell32.dll,21'; $sc.Save()"

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
        if "%%a"=="TELEGRAM_BOT_TOKEN" if not "%%b"=="" if not "%%b"=="your-bot-token-here" set "HAS_TOKEN=1"
        if "%%a"=="TELEGRAM_CHAT_ID" if not "%%b"=="" if not "%%b"=="your-chat-id-here" set "HAS_CHATID=1"
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

    call :read_tg_token
    if "!TG_TOKEN!"=="" (
        echo         No token entered - skipping Telegram setup.
        set "SETUP_TELEGRAM=N"
        goto :skip_tg_setup
    )

    call :read_tg_chatid
    if "!TG_CHATID!"=="" (
        echo         No chat ID entered - skipping Telegram setup.
        set "SETUP_TELEGRAM=N"
        goto :skip_tg_setup
    )

    :: Remove any existing Telegram lines from .env, then append new ones
    :: Credentials are passed via environment variables (not command-line args)
    :: to avoid leaking them in process listings.
    set "_TG_TOKEN=!TG_TOKEN!"
    set "_TG_CHATID=!TG_CHATID!"
    powershell -NoProfile -Command "$tok = $env:_TG_TOKEN; $cid = $env:_TG_CHATID; $f = Get-Content '.env' | Where-Object { $_ -notmatch '^TELEGRAM_BOT_TOKEN=' -and $_ -notmatch '^TELEGRAM_CHAT_ID=' }; $f += \"TELEGRAM_BOT_TOKEN=$tok\"; $f += \"TELEGRAM_CHAT_ID=$cid\"; Set-Content '.env' $f"
    echo         Telegram credentials saved to .env

    :: Send a test message to confirm it works
    :: Token and chat ID are read from env vars, not embedded in args.
    echo.
    echo         Sending test message to your Telegram...
    powershell -NoProfile -Command "$tok = $env:_TG_TOKEN; $cid = $env:_TG_CHATID; $r = Invoke-RestMethod -Uri \"https://api.telegram.org/bot$tok/sendMessage\" -Method Post -ContentType 'application/json' -Body ('{\"chat_id\":\"' + $cid + '\",\"text\":\"HybridTurtle connected! Nightly reports will arrive here at 21:10 Mon-Fri.\"}'); if ($r.ok) { Write-Output '         Test message sent successfully!' } else { Write-Output '         !! Test message failed - check your token and chat ID.' }" 2>nul || echo         !! Could not reach Telegram API - check your internet connection.

    :skip_tg_creds
    echo.
    echo         Registering scheduled task...

    :: Check for admin privileges (schtasks usually requires elevation)
    net session >nul 2>&1
    if !errorlevel! neq 0 (
        echo.
        echo  !! Creating a scheduled task requires Administrator privileges.
        echo  !! Please re-run install.bat as Administrator to set up the nightly task.
        echo  !! ^(Right-click install.bat ^> Run as administrator^)
        echo  !! Everything else is installed — only the scheduled task was skipped.
        >> "%LOG%" echo [%date% %time%] WARN: Skipped schtasks - no admin
        goto :skip_tg_setup
    )

    :: Write nightly-task.bat using subroutine to avoid quoting pitfalls
    call :create_nightly_bat
    if errorlevel 1 (
        echo  !! Failed to create nightly-task.bat. See install.log.
        >> "%LOG%" echo [%date% %time%] FAIL: create nightly-task.bat
        goto :fail
    )

    :: Create/replace scheduled task using schtasks (more robust across machines)
    set "TASK_NAME=HybridTurtle-Nightly"
    set "NIGHTLY_BAT=%SCRIPT_DIR%nightly-task.bat"
    schtasks /Delete /TN "%TASK_NAME%" /F >> "%LOG%" 2>&1
    schtasks /Create /TN "%TASK_NAME%" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 21:10 /TR "\"%NIGHTLY_BAT%\"" /RL HIGHEST /F >> "%LOG%" 2>&1

    if !errorlevel! equ 0 (
        echo         Scheduled task 'HybridTurtle-Nightly' created!
        echo         Runs Mon-Fri at 21:10. View/edit in Task Scheduler.
        >> "%LOG%" echo [%date% %time%] Scheduled task created
    ) else (
        echo         !! Could not create scheduled task.
        echo         !! Try running this installer as Administrator.
        >> "%LOG%" echo [%date% %time%] FAIL: schtasks create
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
echo.
echo   Full install log: install.log
echo  ===========================================================
echo.
>> "%LOG%" echo [%date% %time%] ====== Install complete ======

set /p LAUNCH="  Launch the dashboard now? (Y/N): "
if /i not "%LAUNCH%"=="Y" if /i not "%LAUNCH%"=="N" (
    echo         Input not recognized, defaulting to N.
    set "LAUNCH=N"
)
if /i "%LAUNCH%"=="Y" (
    call "%~dp0start.bat"
)

pause
exit /b 0

:: ── Error handler ──
:fail
echo.
echo  ===========================================================
echo   INSTALLATION FAILED
echo  ===========================================================
echo.
echo   Check install.log for details.
echo.
>> "%LOG%" echo [%date% %time%] ====== Install FAILED ======
pause
exit /b 1

:: ── Helper subroutines ──

:read_tg_token
setlocal DisableDelayedExpansion
set /p TG_TOKEN="  Paste your Bot Token: "
endlocal & set "TG_TOKEN=%TG_TOKEN%"
goto :eof

:read_tg_chatid
setlocal DisableDelayedExpansion
set /p TG_CHATID="  Paste your Chat ID: "
endlocal & set "TG_CHATID=%TG_CHATID%"
goto :eof

:create_nightly_bat
> "%~dp0nightly-task.bat" echo @echo off
>> "%~dp0nightly-task.bat" echo cd /d "%%~dp0"
>> "%~dp0nightly-task.bat" echo echo [%%date%% %%time%%] Starting nightly process... ^>^> nightly.log
>> "%~dp0nightly-task.bat" echo call npx tsx src/cron/nightly.ts --run-now 2^>^&1 ^| powershell -NoProfile -Command "$input ^| Tee-Object -FilePath 'nightly.log' -Append"
>> "%~dp0nightly-task.bat" echo echo [%%date%% %%time%%] Nightly process finished ^(exit code: %%ERRORLEVEL%%^) ^>^> nightly.log
goto :eof
