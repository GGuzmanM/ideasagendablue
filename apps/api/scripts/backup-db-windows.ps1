<#
.SYNOPSIS
  Backup de PostgreSQL para Limablue Agenda en WINDOWS (equivalente a backup-postgres.sh).

.DESCRIPTION
  - Lee DATABASE_URL de apps/api/.env (o del parámetro -DatabaseUrl).
  - Dump en formato custom (-Fc) → restauración selectiva con pg_restore.
  - Verifica integridad (pg_restore -l).
  - Retención escalonada con rotación: 7 diarios + 4 semanales + 3 mensuales.
  - Sirve para Postgres NATIVO o en Docker (pg_dump.exe conecta por TCP a la URL).

.EXAMPLE
  # Manual:
  powershell -ExecutionPolicy Bypass -File apps\api\scripts\backup-db-windows.ps1

.EXAMPLE
  # 30-sep-2026 — lo que usa la clínica: 2 respaldos diarios (13:00 y 20:00) en Documentos\Respaldos Agenda\Automaticos,
  # 14 diarios (= 7 días) + 4 semanales + 6 mensuales, y copia opcional en OneDrive (-CopiaDir). Ver registrar-respaldos-windows.ps1.
  powershell -ExecutionPolicy Bypass -File apps\api\scripts\backup-db-windows.ps1 -BackupRoot "C:\Users\User\Documents\Respaldos Agenda\Automaticos" -KeepDiarios 14 -KeepMensuales 6

.EXAMPLE
  # Programar diario 02:30 (una sola vez, como administrador):
  $acc = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-ExecutionPolicy Bypass -File "C:\Users\User\Documents\Desarrollo LimaBlue\Agenda-lb\apps\api\scripts\backup-db-windows.ps1"'
  $trg = New-ScheduledTaskTrigger -Daily -At 2:30am
  Register-ScheduledTask -TaskName 'LimablueBackupDB' -Action $acc -Trigger $trg `
    -Description 'Backup diario de la BD Limablue' -RunLevel Highest
#>
[CmdletBinding()]
param(
  [string]$DatabaseUrl,
  [string]$BackupRoot,
  [int]$KeepDiarios = 7,
  [int]$KeepSemanales = 4,
  [int]$KeepMensuales = 3,
  # Copia extra FUERA de esta PC (el NAS de la clínica \\192.168.0.77\it limablue\BK Agenda). Vacío = sin copia.
  [string]$CopiaDir,
  # Cuántos respaldos se conservan en la copia (60 = 30 días a 2 por día).
  [int]$KeepCopia = 60
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiDir    = Split-Path -Parent $scriptDir           # apps/api

# ── DATABASE_URL (parámetro o .env) ──────────────────────────────────────────
if (-not $DatabaseUrl) {
  $envFile = Join-Path $apiDir '.env'
  if (-not (Test-Path $envFile)) { throw "No encuentro $envFile ni se pasó -DatabaseUrl." }
  $line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
  if (-not $line) { throw 'DATABASE_URL no está en el .env.' }
  $DatabaseUrl = ($line.Line -replace '^\s*DATABASE_URL\s*=', '').Trim().Trim('"').Trim("'")
}

# ── Parsear postgres://user:pass@host:port/db(?...) ──────────────────────────
$m = [regex]::Match($DatabaseUrl, '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)')
if (-not $m.Success) { throw "DATABASE_URL con formato inesperado: $DatabaseUrl" }
$pgUser = $m.Groups[1].Value
$pgPass = $m.Groups[2].Value
$pgHost = $m.Groups[3].Value
$pgPort = $m.Groups[4].Value
$pgDb   = $m.Groups[5].Value

# ── Localizar pg_dump.exe / pg_restore.exe (PG18, fallback a la más nueva) ────
function Find-PgTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cands = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter $name -ErrorAction SilentlyContinue |
           Sort-Object FullName -Descending
  if ($cands) { return $cands[0].FullName }
  throw "No encuentro $name (instala PostgreSQL o ponlo en el PATH)."
}
$pgDump    = Find-PgTool 'pg_dump.exe'
$pgRestore = Find-PgTool 'pg_restore.exe'

# ── Carpetas ─────────────────────────────────────────────────────────────────
if (-not $BackupRoot) { $BackupRoot = Join-Path $apiDir 'backups\postgres' }
$dirDiarios   = Join-Path $BackupRoot 'diarios'
$dirSemanales = Join-Path $BackupRoot 'semanales'
$dirMensuales = Join-Path $BackupRoot 'mensuales'
foreach ($d in @($dirDiarios, $dirSemanales, $dirMensuales)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# Registro de cada corrida (para saber si falló sin mirar la tarea programada).
$log = Join-Path $BackupRoot 'respaldos.log'
function Log([string]$msg) { $l = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg; Write-Output $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
trap { Log "ERROR: $($_.Exception.Message)"; break }

$ts     = Get-Date -Format 'yyyyMMdd-HHmmss'
$semana = '{0}-W{1:00}' -f (Get-Date -UFormat '%G'), [int](Get-Date -UFormat '%V')
$mes    = Get-Date -Format 'yyyy-MM'
$arch   = Join-Path $dirDiarios "$pgDb-$ts.dump"

Log "Backup $ts -> $arch  (db=$pgDb host=${pgHost}:$pgPort)"

# ── Dump ─────────────────────────────────────────────────────────────────────
$env:PGPASSWORD = $pgPass
try {
  & $pgDump -Fc --no-owner --no-privileges -h $pgHost -p $pgPort -U $pgUser -d $pgDb -f $arch
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falló (exit $LASTEXITCODE)." }

  # ── Verificación de integridad ──
  & $pgRestore -l $arch | Out-Null
  if ($LASTEXITCODE -ne 0) { Remove-Item $arch -Force -ErrorAction SilentlyContinue; throw "Backup corrupto: pg_restore -l falló." }
  $mb = [math]::Round((Get-Item $arch).Length / 1MB, 1)
  Log "OK verificado ($mb MB)"
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# ── Promoción a semanal / mensual (una por periodo) ──────────────────────────
$sem = Join-Path $dirSemanales "$pgDb-$semana.dump"
$men = Join-Path $dirMensuales "$pgDb-$mes.dump"
if (-not (Test-Path $sem)) { Copy-Item $arch $sem; Write-Output "Semanal -> $sem" }
if (-not (Test-Path $men)) { Copy-Item $arch $men; Write-Output "Mensual -> $men" }

# ── Rotación (conserva los N más recientes) ──────────────────────────────────
function Rotar([string]$dir, [int]$keep) {
  # Solo NUESTROS respaldos (Agendav2-*.dump): nunca toca otros archivos de la carpeta (importa en el NAS).
  Get-ChildItem -LiteralPath $dir -Filter "$pgDb-*.dump" | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $keep | Remove-Item -Force -ErrorAction SilentlyContinue
}
Rotar $dirDiarios   $KeepDiarios
Rotar $dirSemanales $KeepSemanales
Rotar $dirMensuales $KeepMensuales
Log "Rotacion OK (diarios<=$KeepDiarios, semanales<=$KeepSemanales, mensuales<=$KeepMensuales)"

# ── Copia fuera de esta carpeta (OneDrive / disco externo) ───────────────────
if ($CopiaDir) {
  try {
    if (-not (Test-Path -LiteralPath $CopiaDir)) { New-Item -ItemType Directory -Force -Path $CopiaDir | Out-Null }
    $dest = Join-Path $CopiaDir (Split-Path $arch -Leaf)
    Copy-Item -LiteralPath $arch -Destination $dest -Force
    if ((Get-Item -LiteralPath $dest).Length -ne (Get-Item -LiteralPath $arch).Length) { throw 'la copia quedó incompleta' }
    Rotar $CopiaDir $KeepCopia
    Log "Copia -> $CopiaDir"
  } catch { Log "AVISO: no se pudo copiar a $CopiaDir ($($_.Exception.Message)); el respaldo local sí quedó." }
}
Log "Listo."
