@echo off
rem Limablue Agenda - llave de la API de reservas para el chat de WhatsApp (se muestra una sola vez).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\llave-chat.ps1"
echo.
pause
