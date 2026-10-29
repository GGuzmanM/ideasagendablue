# Limablue Agenda - cargar los datos DEFINITIVOS del corte (reemplaza los de la instalación de prueba).
# Lo llama «Cargar datos del corte.bat» (como administrador). Pasos:
#   1. Respaldo de seguridad de lo que hay en el servidor.   2. Detiene la Agenda.
#   3. Reemplaza la base por el respaldo del corte y los archivos subidos por los del corte.
#   4. Devuelve la configuración real (correos, recordatorios, Outlook) si estaba en MODO PRUEBA.
#   5. Aplica migraciones y vuelve a arrancar (instalar.ps1).
$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot
$DATOS = Join-Path $env:ProgramData 'Limablue Agenda'
$ENVF = Join-Path $DATOS 'config\agenda.env'
$APP = Join-Path $RAIZ 'app'
$TAREA = 'Limablue Agenda'

function Titulo($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  !   $t" -ForegroundColor Yellow }
function Preguntar($texto, $porDefecto) { $r = Read-Host "  $texto [$porDefecto]"; if ([string]::IsNullOrWhiteSpace($r)) { return $porDefecto } else { return $r.Trim().Trim('"') } }
function LeerEnv($ruta) { $h = [ordered]@{}; foreach ($l in Get-Content $ruta -Encoding UTF8) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $h[$Matches[1]] = $Matches[2].Trim().Trim('"') } }; return $h }
function EscribirEnv($ruta, $h) {
  $lineas = @('# Limablue Agenda - configuracion del servidor. Generado por el instalador; se puede editar.', '# Despues de editar: Detener.bat e Iniciar.bat.', '')
  foreach ($k in $h.Keys) { $v = [string]$h[$k]; if ($v -match '[\s#"]') { $v = '"' + $v.Replace('"', '\"') + '"' }; $lineas += "$k=$v" }
  [IO.File]::WriteAllLines($ruta, $lineas, (New-Object Text.UTF8Encoding $false))
}
function Herramienta([string]$n) {
  $c = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending |
    ForEach-Object { Join-Path $_.FullName "bin\$n" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($c) { return $c }; throw "No encuentro $n (PostgreSQL)."
}

Write-Host ''
Write-Host '  Limablue Agenda - cargar datos del CORTE' -ForegroundColor White
if (-not (Test-Path $ENVF)) { throw 'La Agenda no esta instalada en este servidor. Primero "Instalar o actualizar.bat".' }
$cfg = LeerEnv $ENVF
$m = [regex]::Match($cfg['DATABASE_URL'], '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)')
if (-not $m.Success) { throw 'DATABASE_URL de agenda.env con formato inesperado.' }
$pgUser = $m.Groups[1].Value; $pgPass = [Uri]::UnescapeDataString($m.Groups[2].Value); $pgHost = $m.Groups[3].Value; $pgPort = $m.Groups[4].Value; $pgDb = $m.Groups[5].Value
$psql = Herramienta 'psql.exe'; $pgRestore = Herramienta 'pg_restore.exe'; $dropdb = Herramienta 'dropdb.exe'; $createdb = Herramienta 'createdb.exe'

# ─── Qué se va a cargar ────────────────────────────────────────────────────────
Titulo 'Datos del corte'
$mudanza = Join-Path (Split-Path $RAIZ -Parent) 'Mudanza'
$dumpDef = (Get-ChildItem $mudanza -Filter '*.dump' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$dump = Preguntar 'Respaldo del corte (.dump)' $(if ($dumpDef) { $dumpDef } else { '' })
if (-not $dump -or -not (Test-Path $dump)) { throw "No existe el respaldo $dump" }
# Desde el 14-oct-2026 las fotos y documentos van DENTRO de la base: la carpeta uploads es opcional (Enter = sin carpeta).
$upDef = Join-Path (Split-Path $dump -Parent) 'uploads'
$uploads = Preguntar 'Carpeta de archivos subidos (uploads), Enter si no hay' $(if (Test-Path $upDef) { $upDef } else { '' })
if ($uploads -and -not (Test-Path $uploads)) { throw "No existe la carpeta $uploads" }
$cfgPrueba = $cfg['MODO_PRUEBA'] -eq 'true'
$definitivo = $true
if ($cfgPrueba) {
  Write-Host '  ¿Es el corte DEFINITIVO?'
  Write-Host '    S = desde ahora se trabaja en este servidor: vuelven los correos, recordatorios y Outlook.'
  Write-Host '    N = solo actualizar los datos de prueba: sigue en MODO PRUEBA (sin correos).'
  $definitivo = (Preguntar 'Respuesta (S/N)' 'N') -match '^[sS]'
}
$verRestore = [int]([regex]::Match((& $pgRestore --version), '(\d+)').Groups[1].Value)
$verDump = [int]([regex]::Match(((& $pgRestore -l $dump | Select-String 'Dumped by pg_dump version') -join ''), 'version (\d+)').Groups[1].Value)
if ($verDump -and $verRestore -lt $verDump) { throw "El respaldo es de PostgreSQL $verDump y este servidor usa $verRestore." }
$env:PGPASSWORD = $pgPass
$citasAhora = ((& $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -tAc 'SELECT count(*) FROM citas') -join '').Trim()
Remove-Item Env:\PGPASSWORD
Write-Host ("  Respaldo:  {0}  ({1:N1} MB, del {2:dd/MM/yyyy HH:mm})" -f (Split-Path $dump -Leaf), ((Get-Item $dump).Length / 1MB), (Get-Item $dump).LastWriteTime)
Write-Host "  Archivos:  $(if ($uploads) { "$((Get-ChildItem $uploads -Recurse -File).Count) en $uploads" } else { 'sin carpeta (van dentro de la base)' })"
Write-Host "  Hoy en el servidor: $citasAhora citas en la base $pgDb (se REEMPLAZAN)."
Write-Host "  Despues:   $(if ($definitivo) { 'CORTE DEFINITIVO (se encienden correos y recordatorios)' } else { 'sigue en MODO PRUEBA (sin correos)' })"
Write-Host ''
$palabra = if ($definitivo) { 'CORTE' } else { 'CARGAR' }
$ok = Read-Host "  Esto reemplaza la base del servidor por la del respaldo. Escribe $palabra para continuar"
if ($ok -ne $palabra) { Write-Host '  Cancelado. No se toco nada.'; exit 0 }

# ─── 1. Respaldo de seguridad de lo que hay ───────────────────────────────────
Titulo 'Respaldo de seguridad'
$respaldar = Join-Path $DATOS 'herramientas\respaldar.ps1'
if (-not (Test-Path $respaldar)) { $respaldar = Join-Path $PSScriptRoot 'respaldar.ps1' }
& powershell -NoProfile -ExecutionPolicy Bypass -File $respaldar
if ($LASTEXITCODE -ne 0) { throw 'No se pudo sacar el respaldo de seguridad: no se continua.' }
Ok 'Respaldo de lo que habia en el servidor guardado.'

# ─── 2. Detener ───────────────────────────────────────────────────────────────
Titulo 'Deteniendo la Agenda'
Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$APP*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Ok 'Detenida.'

# ─── 3. Base de datos y archivos ──────────────────────────────────────────────
Titulo 'Cargando la base del corte'
$env:PGPASSWORD = $pgPass
try {
  & $dropdb --force --if-exists -h $pgHost -p $pgPort -U $pgUser $pgDb
  if ($LASTEXITCODE -ne 0) { throw "No se pudo quitar la base $pgDb (el respaldo de seguridad ya quedo guardado)." }
  & $createdb -h $pgHost -p $pgPort -U $pgUser $pgDb
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la base $pgDb." }
  Write-Host '  Cargando (unos minutos)...'
  & $pgRestore --no-owner --no-privileges -h $pgHost -p $pgPort -U $pgUser -d $pgDb $dump
  $citas = ((& $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -tAc 'SELECT count(*) FROM citas') -join '').Trim()
  if (-not $citas) { throw 'La base no quedo bien cargada (no se pudo leer la tabla de citas). Restaura el respaldo de seguridad.' }
  Ok "Base del corte cargada: $citas citas."
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
if ($uploads) {
  & robocopy $uploads (Join-Path $DATOS 'uploads') /MIR /R:1 /W:2 /NP /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "No se pudieron copiar los archivos subidos (robocopy $LASTEXITCODE)." }
  Ok "Archivos subidos iguales a los del corte: $((Get-ChildItem (Join-Path $DATOS 'uploads') -Recurse -File).Count)."
}

# Reserva web encendida: la base nueva trae los servicios sin marcar y no tiene la llave interna; se rehacen.
if (-not $definitivo -and $cfg['RESERVA_WEB_HABILITADA'] -eq '1') {
  $env:DATABASE_URL = $cfg['DATABASE_URL']
  $sinPago = $cfg['RESERVA_WEB_MODO'] -ne 'vitrina'  # encendida: necesita la llave interna con la que la Agenda crea la cita
  $salida = & (Join-Path $RAIZ 'node\node.exe') (Join-Path $PSScriptRoot 'reserva-servicios.js') $(if ($sinPago) { 'llave' } else { 'marcar' })
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -eq 0) {
    if ($sinPago) { $cfg['RESERVA_WEB_API_KEY'] = ($salida | Select-Object -Last 1 | ConvertFrom-Json).llave; EscribirEnv $ENVF $cfg }
    Ok 'Reserva web: llave interna lista en la base nueva. Revisa en Administracion > Reserva web que servicios se ofrecen (la base del corte trae los suyos).'
  } else { Aviso 'Reserva web: no se pudo preparar; vuelve a correr «Reserva web de prueba.bat».' }
}

# ─── 4. Configuración real (sale del MODO PRUEBA) — solo en el corte definitivo ──
if ($definitivo -and $cfgPrueba) {
  foreach ($k in @($cfg.Keys | Where-Object { $_ -like 'CORTE_ORIGINAL_*' })) {
    $real = $k.Substring('CORTE_ORIGINAL_'.Length)
    if ($cfg[$k] -eq '__no_estaba__') { if ($cfg.Contains($real)) { $cfg.Remove($real) } } else { $cfg[$real] = $cfg[$k] }
    $cfg.Remove($k)
  }
  $cfg.Remove('MODO_PRUEBA')
  EscribirEnv $ENVF $cfg
  Ok 'Fuera del MODO PRUEBA: vuelven los correos, recordatorios, encuestas y Outlook.'
}

# ─── 5. Migraciones y arranque ────────────────────────────────────────────────
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'instalar.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Fallo al aplicar migraciones o arrancar (ver arriba).' }
Write-Host ''
if ($definitivo) {
  Write-Host '  CORTE TERMINADO. Desde ahora se trabaja SOLO en este servidor: apaga la Agenda de la PC anterior' -ForegroundColor Green
  Write-Host '  y sus respaldos automaticos, y borra de este servidor la carpeta Mudanza.' -ForegroundColor Green
} else {
  Write-Host '  DATOS DE PRUEBA ACTUALIZADOS. Sigue en MODO PRUEBA: no salen correos ni recordatorios.' -ForegroundColor Green
}
