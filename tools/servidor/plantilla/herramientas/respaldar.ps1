# Limablue Agenda - respaldo del servidor (base de datos + archivos subidos).
# Lo corre la tarea «Limablue Agenda - Respaldo» (13:00 y 20:00) o «Respaldar ahora.bat».
#  - Base: pg_dump -Fc verificado con pg_restore -l. Se guardan 14 diarios (7 dias) + 4 semanales + 6 mensuales.
#  - Archivos subidos (fotos clinicas, consentimientos, comprobantes, contratos): copia acumulativa (robocopy, nunca borra).
#  - Copia fuera del servidor (NAS) si agenda.env tiene RESPALDO_COPIA_DIR: los .dump (60 = 30 dias) y los archivos.
# Basado en apps/api/scripts/backup-db-windows.ps1 (el de la PC anterior).
param([int]$KeepDiarios = 14, [int]$KeepSemanales = 4, [int]$KeepMensuales = 6, [int]$KeepCopia = 60)
$ErrorActionPreference = 'Stop'
$DATOS = Join-Path $env:ProgramData 'Limablue Agenda'
$ENVF = Join-Path $DATOS 'config\agenda.env'
$RAIZ = Join-Path $DATOS 'respaldos'
$UPLOADS = Join-Path $DATOS 'uploads'
New-Item -ItemType Directory -Force -Path (Join-Path $RAIZ 'diarios'), (Join-Path $RAIZ 'semanales'), (Join-Path $RAIZ 'mensuales') | Out-Null
$log = Join-Path $RAIZ 'respaldos.log'
function Log([string]$m) { $l = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; Write-Output $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
trap { Log "ERROR: $($_.Exception.Message)"; exit 1 }

# Configuración
$cfg = @{}
foreach ($l in Get-Content $ENVF -Encoding UTF8) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim().Trim('"') } }
$m = [regex]::Match($cfg['DATABASE_URL'], '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)')
if (-not $m.Success) { throw 'DATABASE_URL de agenda.env con formato inesperado.' }
$pgUser = $m.Groups[1].Value; $pgPass = [Uri]::UnescapeDataString($m.Groups[2].Value); $pgHost = $m.Groups[3].Value; $pgPort = $m.Groups[4].Value; $pgDb = $m.Groups[5].Value
function Herramienta([string]$n) {
  $c = Get-Command $n -ErrorAction SilentlyContinue; if ($c) { return $c.Source }
  $c = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter $n -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($c) { return $c.FullName }; throw "No encuentro $n. Instala PostgreSQL (o sus herramientas) en este servidor."
}
$pgDump = Herramienta 'pg_dump.exe'; $pgRestore = Herramienta 'pg_restore.exe'

# 1. Base de datos
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$arch = Join-Path $RAIZ "diarios\$pgDb-$ts.dump"
Log "Respaldo $ts (base $pgDb en ${pgHost}:$pgPort)"
$env:PGPASSWORD = $pgPass
try {
  & $pgDump -Fc --no-owner --no-privileges -h $pgHost -p $pgPort -U $pgUser -d $pgDb -f $arch
  if ($LASTEXITCODE -ne 0) { throw "pg_dump fallo (codigo $LASTEXITCODE)." }
  & $pgRestore -l $arch | Out-Null
  if ($LASTEXITCODE -ne 0) { Remove-Item $arch -Force -ErrorAction SilentlyContinue; throw 'Respaldo corrupto (pg_restore -l fallo).' }
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
Log ("OK base verificada ({0} MB)" -f [math]::Round((Get-Item $arch).Length / 1MB, 1))
$sem = Join-Path $RAIZ ("semanales\$pgDb-{0}-W{1:00}.dump" -f (Get-Date -UFormat '%G'), [int](Get-Date -UFormat '%V'))
$men = Join-Path $RAIZ ("mensuales\$pgDb-{0}.dump" -f (Get-Date -Format 'yyyy-MM'))
if (-not (Test-Path $sem)) { Copy-Item $arch $sem }
if (-not (Test-Path $men)) { Copy-Item $arch $men }
function Rotar([string]$dir, [int]$keep) { Get-ChildItem -LiteralPath $dir -Filter "$pgDb-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $keep | Remove-Item -Force -ErrorAction SilentlyContinue }
Rotar (Join-Path $RAIZ 'diarios') $KeepDiarios; Rotar (Join-Path $RAIZ 'semanales') $KeepSemanales; Rotar (Join-Path $RAIZ 'mensuales') $KeepMensuales

# 2. Archivos subidos (acumulativo: lo que se agrega se copia, nada se borra del respaldo)
if (Test-Path $UPLOADS) {
  & robocopy $UPLOADS (Join-Path $RAIZ 'uploads') /E /XO /R:1 /W:2 /NP /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { Log "AVISO: robocopy de archivos con codigo $LASTEXITCODE" } else { Log 'OK archivos subidos' }
}

# 3. Copia fuera del servidor (NAS)
$copia = $cfg['RESPALDO_COPIA_DIR']
if ($copia) {
  try {
    New-Item -ItemType Directory -Force -Path $copia | Out-Null
    $dest = Join-Path $copia (Split-Path $arch -Leaf)
    Copy-Item -LiteralPath $arch -Destination $dest -Force
    if ((Get-Item -LiteralPath $dest).Length -ne (Get-Item -LiteralPath $arch).Length) { throw 'la copia quedo incompleta' }
    Rotar $copia $KeepCopia
    if (Test-Path $UPLOADS) {
      & robocopy $UPLOADS (Join-Path $copia 'uploads') /E /XO /R:1 /W:2 /NP /NFL /NDL /NJH /NJS | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "robocopy de archivos con codigo $LASTEXITCODE" }
    }
    Log "OK copia en $copia"
  } catch { Log "AVISO: no se pudo copiar a $copia ($($_.Exception.Message)). El respaldo local si quedo." }
}
Log 'Listo.'
