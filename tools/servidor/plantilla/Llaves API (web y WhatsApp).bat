@echo off
rem Limablue Agenda - llaves de las APIs de reservas: una para la WEB y otra para el chat de WhatsApp (se muestran una sola vez).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\llaves-reservas.ps1"
echo.
pause
