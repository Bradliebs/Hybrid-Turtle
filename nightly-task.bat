@echo off
cd /d "%~dp0"
echo [%date% %time%] Starting nightly process... >> nightly.log
call npx tsx src/cron/nightly.ts --run-now >> nightly.log 2>&1
echo [%date% %time%] Nightly process finished (exit code: %ERRORLEVEL%) >> nightly.log
