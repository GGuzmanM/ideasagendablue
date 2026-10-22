@echo off
rem Limablue Agenda - reserva web para pacientes (pagina /reserva): vitrina o apagada (la cita solo se crea cuando el pago queda aprobado).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\reserva-prueba.ps1"
echo.
pause
