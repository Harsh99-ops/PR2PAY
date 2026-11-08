@echo off
setlocal
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
if not exist node_modules (
  call npm install
  if errorlevel 1 goto :error
)
call npm run dev
goto :end
:error
echo Dependency installation failed.
pause
:end
endlocal
