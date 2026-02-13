@echo off
:: ============================================================
:: HybridTurtle — Package for Distribution
:: ============================================================
:: Creates a zip file ready to give to someone else.
:: Excludes node_modules, .next, database files, etc.
:: ============================================================

title HybridTurtle Packager
color 0D
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-for-distribution.ps1"

if %errorlevel% neq 0 (
    echo.
    echo  !! Packaging failed.
)

pause
