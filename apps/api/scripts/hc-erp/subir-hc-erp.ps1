# Sube la historia clínica del ERP (notas clínicas congeladas) a la base. 28-sep-2026.
# Sin detener el sistema: la tabla es nueva y la pantalla ya sabe mostrarla (si aún no existe, la HC sigue igual).
#
#   powershell -ExecutionPolicy Bypass -File subir-hc-erp.ps1                       → base del .env del API (la REAL)
#   powershell -ExecutionPolicy Bypass -File subir-hc-erp.ps1 -EnvFile <otro .env>  → otra base (p. ej. pruebas)
#
# Pasos: 1) respaldo completo  2) migración (solo crea la tabla)  3) limpia el CSV  4) carga en UNA transacción
# (idempotente: si se corre dos veces no duplica)  5) resumen.
param(
  [string]$Csv = 'C:\Users\User\Downloads\migra para datos de anamnesis.csv',
  [string]$EnvFile = '',
  [string]$Respaldos = 'C:\Users\User\Documents\Respaldos Agenda'
)
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
$api = Split-Path (Split-Path $scripts)
if (-not $EnvFile) { $EnvFile = Join-Path $api '.env' }
$pg = 'C:\Program Files\PostgreSQL\18\bin'

$linea = Select-String -Path $EnvFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
if (-not $linea) { throw "No hay DATABASE_URL en $EnvFile" }
$url = $linea.Line.Split('=', 2)[1].Trim().Trim('"')
$uri = $url.Split('?')[0]                          # libpq no entiende ?schema=public
$base = ($uri -split '/')[-1]
Write-Host "Base de destino: $base" -ForegroundColor Cyan
if (-not (Test-Path $Csv)) { throw "No encuentro el CSV: $Csv" }

# 1) Respaldo
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
New-Item -ItemType Directory -Force $Respaldos | Out-Null
$dump = Join-Path $Respaldos "$base-antes-hc-erp-$stamp.dump"
Write-Host "1/4 Respaldo → $dump"
& "$pg\pg_dump.exe" -Fc -d $uri -f $dump
if ($LASTEXITCODE -ne 0) { throw 'Falló el respaldo: no se sigue.' }

# 2) Migración (solo agrega historia_clinica_erp)
Write-Host '2/4 Migración'
$env:DATABASE_URL = $url
Push-Location $api
try { npx prisma migrate deploy; if ($LASTEXITCODE -ne 0) { throw 'Falló la migración.' } } finally { Pop-Location }

# 3) CSV limpio
$tmp = Join-Path $env:TEMP 'hc-erp'
New-Item -ItemType Directory -Force $tmp | Out-Null
Write-Host '3/4 Limpieza del CSV'
python (Join-Path $scripts 'limpiar-hc-erp.py') $Csv (Join-Path $tmp 'hc-erp-limpio.csv')
if ($LASTEXITCODE -ne 0) { throw 'Falló la limpieza del CSV.' }

# 4) Carga (desde la carpeta del CSV limpio: \copy lo lee por nombre)
Write-Host '4/4 Carga'
$env:PGCLIENTENCODING = 'UTF8'
Push-Location $tmp
try { & "$pg\psql.exe" -d $uri -f (Join-Path $scripts 'cargar-hc-erp.sql'); if ($LASTEXITCODE -ne 0) { throw 'Falló la carga (no quedó nada a medias: va en una transacción).' } } finally { Pop-Location }
Write-Host "Listo. Respaldo previo: $dump" -ForegroundColor Green
