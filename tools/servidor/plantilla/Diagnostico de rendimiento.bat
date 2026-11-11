@echo off
rem Limablue Agenda - diagnostico de rendimiento (SOLO LEE: no cambia nada). Mide el servidor, revisa los registros y consulta PostgreSQL.
rem Para encontrar una lentitud que aparece "a veces", dejarlo corriendo en horario de atencion (60 minutos o mas).
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" & exit /b)
cd /d "%~dp0"
echo.
echo   Cuantos minutos medir? (Enter = 2; para cazar la lentitud "a veces" escriba 60 o mas)
set /p MIN=  Minutos:
if "%MIN%"=="" set MIN=2
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\diagnostico.ps1" -Minutos %MIN%
echo.
echo   El informe quedo en: %ProgramData%\Limablue Agenda\diagnostico
echo.
pause
