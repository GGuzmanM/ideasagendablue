@echo off
rem Limablue Agenda - prueba de rendimiento (SOLO LEE). Entra con un usuario de la agenda y mide cuanto tardan la agenda del dia,
rem la busqueda de pacientes y los horarios libres, de a una y varias a la vez. Correr en el servidor, antes y despues de actualizar.
cd /d "%~dp0"
echo.
set /p CORREO=  Correo de un usuario de la agenda:
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0herramientas\prueba-rendimiento.ps1" -Base https://localhost:5180 -Correo "%CORREO%"
echo.
pause
