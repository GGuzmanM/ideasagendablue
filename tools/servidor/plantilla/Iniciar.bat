@echo off
rem Limablue Agenda - iniciar.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
schtasks /Run /TN "Limablue Agenda"
echo.
echo   Iniciando. En unos segundos la Agenda responde desde las PCs de la red.
echo.
pause
