@echo off
rem Double-click to start OmniPilot. Needs Node.js 20.12+ and MongoDB running.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages, please wait...
  call npm install
)
if not exist .env (
  copy .env.example .env >nul
  echo.
  echo A settings file was created: %~dp0.env
  echo Open it, fill in OMNIPILOT_LLM_MODEL and OMNIPILOT_LLM_API_KEY, save it, then run this file again.
  start notepad "%~dp0.env"
  pause
  exit /b
)
set OMNIPILOT_OPEN=1
call npm run web
echo.
echo OmniPilot stopped. Press any key to close.
pause >nul
