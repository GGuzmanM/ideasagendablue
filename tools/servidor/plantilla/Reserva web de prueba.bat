@echo off
rem Limablue Agenda - reserva web para pacientes (pagina /agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva): encendida (crea citas reales; se paga en la sede), vitrina o apagada.
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\reserva-prueba.ps1"
echo.
pause
