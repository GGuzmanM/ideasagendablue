@echo off
rem Limablue Agenda - el dia del CORTE: reemplaza los datos de prueba por los definitivos (pide confirmacion).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\cargar-corte.ps1"
if errorlevel 1 (echo. & echo   Hubo un error. Revisa el mensaje de arriba.)
echo.
pause
