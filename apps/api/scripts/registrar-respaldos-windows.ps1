<#
.SYNOPSIS
  Registra (o actualiza) la tarea programada de Windows que respalda la BD de la Agenda 2 veces al día.

.DESCRIPTION
  - Corre backup-db-windows.ps1 a las 13:00 y a las 20:00, todos los días.
  - Guarda en C:\Users\User\Documents\Respaldos Agenda\Automaticos (diarios / semanales / mensuales + respaldos.log).
  - Conserva 14 diarios (= 7 días), 4 semanales y 6 mensuales. Cada respaldo pesa ~46 MB → ~1.1 GB en total.
  - Copia cada respaldo al NAS de la clínica (\\192.168.0.77\it limablue\BK Agenda) y ahí guarda 30 días (60).
  - Corre con la sesión del usuario iniciada (la Agenda misma corre en esa sesión con npm run dev), así usa la
    credencial del NAS ya guardada en Windows. Si a esa hora no había sesión o la PC estaba apagada, corre
    apenas se inicie sesión.

.EXAMPLE
  # Ejecutar UNA VEZ en PowerShell COMO ADMINISTRADOR:
  powershell -ExecutionPolicy Bypass -File "C:\Users\User\Documents\Desarrollo LimaBlue\Agenda-lb\apps\api\scripts\registrar-respaldos-windows.ps1"

.EXAMPLE
  # Sin copia al NAS (solo en esta PC):
  powershell -ExecutionPolicy Bypass -File "...\registrar-respaldos-windows.ps1" -CopiaDir ""
#>
[CmdletBinding()]
param(
  [string]$CopiaDir = '\\192.168.0.77\it limablue\BK Agenda',
  [string]$Destino = 'C:\Users\User\Documents\Respaldos Agenda\Automaticos',
  [string]$NombreTarea = 'Limablue - Respaldo BD Agenda'
)
$ErrorActionPreference = 'Stop'

$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'backup-db-windows.ps1'
if (-not (Test-Path $script)) { throw "No encuentro $script" }

$argumentos = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -BackupRoot `"$Destino`" -KeepDiarios 14 -KeepSemanales 4 -KeepMensuales 6"
if ($CopiaDir) { $argumentos += " -CopiaDir `"$CopiaDir`"" }

$accion    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentos
$disparos  = @(
  New-ScheduledTaskTrigger -Daily -At '13:00'
  New-ScheduledTaskTrigger -Daily -At '20:00'
)
$usuario   = "$env:USERDOMAIN\$env:USERNAME"
# Interactive: usa la sesión del usuario → tiene su credencial del NAS (S4U no tiene acceso a la red).
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Highest
$ajustes   = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
               -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $NombreTarea -Action $accion -Trigger $disparos -Principal $principal -Settings $ajustes `
  -Description 'Respaldo de la BD de Limablue Agenda (Agendav2) a las 13:00 y 20:00. Registro en respaldos.log.' -Force | Out-Null

$info = Get-ScheduledTask -TaskName $NombreTarea | Get-ScheduledTaskInfo
Write-Output "Tarea '$NombreTarea' registrada para $usuario."
Write-Output "Próxima ejecución: $($info.NextRunTime)"
Write-Output "Respaldos en: $Destino$(if ($CopiaDir) { "  (+ copia en $CopiaDir)" })"
Write-Output "Para probarla ahora:  Start-ScheduledTask -TaskName '$NombreTarea'"
