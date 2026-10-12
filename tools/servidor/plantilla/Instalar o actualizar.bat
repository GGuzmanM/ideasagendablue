@echo off
rem Limablue Agenda - instalar (primera vez) o actualizar (version nueva). Pide permisos de administrador.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\instalar.ps1"
if errorlevel 1 (echo. & echo   Hubo un error. Revisa el mensaje de arriba y el LEEME.txt.)
echo.
pause
