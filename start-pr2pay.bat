@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example. Add your API keys before running full integrations.
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)
echo Building PR2PAY frontend...
call npm run build
if errorlevel 1 goto :error
echo Starting PR2PAY at http://127.0.0.1:8787
call npm start
goto :end
:error
echo PR2PAY could not start. Check the error above.
pause
:end
endlocal
