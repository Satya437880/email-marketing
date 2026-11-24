@echo off
rem Double-click to start the app and its public address. Keep this window closed after it says Done; the app keeps running.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-public.ps1"
pause
