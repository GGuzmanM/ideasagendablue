@echo off
rem Limablue Agenda - detener (por ejemplo, antes de actualizar).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName 'Limablue Agenda' -ErrorAction SilentlyContinue; $app = Join-Path '%~dp0' 'app'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like ('*' + $app + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo.
echo   Limablue Agenda detenida.
echo.
pause
