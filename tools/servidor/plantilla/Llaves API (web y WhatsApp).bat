@echo off
rem Limablue Agenda - llaves de las APIs: la WEB, el chat de WhatsApp y una de SOLO LECTURA (se muestran una sola vez).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\llaves-reservas.ps1"
echo.
pause
