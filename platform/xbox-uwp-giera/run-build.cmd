@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-giera.ps1" > "%~dp0build.log" 2>&1
echo %ERRORLEVEL% > "%~dp0build.exit"