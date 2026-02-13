@echo off
setlocal

cd /d "%~dp0"

echo [HybridTurtle] Installing dependencies (first run may take a few minutes)...
echo [HybridTurtle] Stopping any running Node processes...
taskkill /F /IM node.exe >nul 2>&1

echo [HybridTurtle] Clearing Prisma cache...
rmdir /s /q node_modules\.prisma >nul 2>&1

call npm install

if errorlevel 1 (
  echo.
  echo [HybridTurtle] npm install failed. Try closing antivirus or rebooting, then run again.
  pause
  exit /b 1
)

echo.
echo [HybridTurtle] Initializing database...
call npx prisma db push

if errorlevel 1 (
  echo.
  echo [HybridTurtle] Database setup failed.
  pause
  exit /b 1
)

echo.
echo [HybridTurtle] Starting dashboard...
start http://localhost:3000/dashboard
call npm run dev

pause
