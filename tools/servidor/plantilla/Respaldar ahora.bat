@echo off
rem Limablue Agenda - respaldo inmediato (base de datos + archivos subidos + copia al NAS si esta configurada).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ProgramData%\Limablue Agenda\herramientas\respaldar.ps1"
echo.
echo   Respaldos en: %ProgramData%\Limablue Agenda\respaldos
echo.
pause
