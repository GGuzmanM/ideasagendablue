@echo off
rem Limablue Agenda - quitar el servicio. NO borra la base de datos ni los datos (C:\ProgramData\Limablue Agenda).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
echo.
echo   Esto quita el servicio "Limablue Agenda" y la regla del firewall.
echo   La base de datos y los archivos en C:\ProgramData\Limablue Agenda NO se borran.
echo.
set /p OK=  Escribe SI para continuar:
if /i not "%OK%"=="SI" exit /b
powershell -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName 'Limablue Agenda' -ErrorAction SilentlyContinue; $app = Join-Path '%~dp0' 'app'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like ('*' + $app + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Unregister-ScheduledTask -TaskName 'Limablue Agenda' -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'Limablue Agenda - Respaldo' -Confirm:$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -DisplayName 'Limablue Agenda' -ErrorAction SilentlyContinue"
echo.
echo   Servicio quitado.
echo.
pause
