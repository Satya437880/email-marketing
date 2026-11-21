@echo off
rem Starts Memurai (Redis) without admin rights, with its data kept in the .memurai folder.
cd /d "%~dp0.memurai"
"C:\Program Files\Memurai\memurai-cli.exe" -h 127.0.0.1 ping >nul 2>&1
if %errorlevel%==0 (
  echo Memurai is already running.
  pause
  exit /b
)
start "" /min "C:\Program Files\Memurai\memurai.exe" memurai.conf
timeout /t 3 >nul
"C:\Program Files\Memurai\memurai-cli.exe" -h 127.0.0.1 ping
pause
