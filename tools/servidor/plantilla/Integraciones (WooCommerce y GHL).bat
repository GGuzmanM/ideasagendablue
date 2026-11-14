@echo off
rem Limablue Agenda - integraciones del chat de WhatsApp: tienda WooCommerce (pago previo) y aviso 2 h antes (GHL). Las claves quedan solo en este servidor.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\integraciones.ps1"
echo.
pause
