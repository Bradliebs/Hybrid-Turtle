@echo off
:: ============================================================
:: HybridTurtle Research Refresh — Scheduled Task Entry Point
:: ============================================================
:: Refreshes the research dataset: backfills scores, enriches
:: forward outcomes, links trades. Safe to rerun (idempotent).
::
:: Usage:
::   research-refresh-task.bat              (interactive, pauses on finish)
::   research-refresh-task.bat --scheduled  (silent, for Task Scheduler)
:: ============================================================

title HybridTurtle Research Refresh
setlocal
cd /d "%~dp0"

:: Run migrations first (handles DB lock gracefully)
call node scripts/auto-migrate.mjs --quiet

:: Run the research refresh job
call npx tsx src/cron/research-refresh.ts --run-now 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath 'research-refresh.log' -Append"

set EXIT_CODE=%ERRORLEVEL%

if "%~1"=="--scheduled" goto :end

echo.
if %EXIT_CODE% equ 0 (
    echo  Research refresh completed successfully.
) else (
    echo  Research refresh encountered errors. Check research-refresh.log
)
echo.
pause

:end
exit /b %EXIT_CODE%
