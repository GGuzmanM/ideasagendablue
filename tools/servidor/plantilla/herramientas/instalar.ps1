# Limablue Agenda - instalar o actualizar en el servidor.
# Lo llama «Instalar o actualizar.bat» (como administrador). La primera vez pide los datos de PostgreSQL y deja la
# configuración en C:\ProgramData\Limablue Agenda\config\agenda.env; las siguientes veces (actualizar) no pregunta nada.
param([switch]$SinIniciar)
$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot                     # carpeta del programa
$NODE = Join-Path $RAIZ 'node\node.exe'
$APP = Join-Path $RAIZ 'app'
$DATOS = Join-Path $env:ProgramData 'Limablue Agenda'
$CONFIG = Join-Path $DATOS 'config'
$ENVF = Join-Path $CONFIG 'agenda.env'
$TAREA = 'Limablue Agenda'

function Titulo($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  !   $t" -ForegroundColor Yellow }
function Preguntar($texto, $porDefecto) {
  $r = Read-Host "  $texto [$porDefecto]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $porDefecto } else { return $r.Trim() }
}
function Secreto() { $b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); return ([Convert]::ToBase64String($b)).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function LeerEnv($ruta) {
  $h = [ordered]@{}
  if (Test-Path $ruta) {
    foreach ($l in Get-Content $ruta -Encoding UTF8) {
      if ($l -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $h[$Matches[1]] = $Matches[2].Trim().Trim('"') }
    }
  }
  return $h
}
function EscribirEnv($ruta, $h) {
  $lineas = @('# Limablue Agenda - configuracion del servidor. Generado por el instalador; se puede editar.', '# Despues de editar: Detener.bat e Iniciar.bat.', '')
  foreach ($k in $h.Keys) { $v = [string]$h[$k]; if ($v -match '[\s#"]') { $v = '"' + $v.Replace('"', '\"') + '"' }; $lineas += "$k=$v" }
  [IO.File]::WriteAllLines($ruta, $lineas, (New-Object Text.UTF8Encoding $false))
}
function Herramienta([string]$n) {
  $c = Get-Command $n -ErrorAction SilentlyContinue; if ($c) { return $c.Source }
  $c = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter $n -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($c) { return $c.FullName }; throw "No encuentro $n. Instala PostgreSQL (o sus herramientas de cliente) en este servidor."
}
function IPsDelServidor() {
  return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress)
}

Write-Host ''
Write-Host '  Limablue Agenda - instalacion en el servidor' -ForegroundColor White
Write-Host "  Programa: $RAIZ"
Write-Host "  Datos:    $DATOS"
if (-not (Test-Path $NODE)) { throw "No se encuentra $NODE. Copia la carpeta completa del programa." }

# ─── 1. Configuración ──────────────────────────────────────────────────────────
Titulo 'Configuracion'
New-Item -ItemType Directory -Force -Path $CONFIG, (Join-Path $DATOS 'uploads'), (Join-Path $DATOS 'logs') | Out-Null
$cfg = LeerEnv $ENVF
$nueva = $cfg.Count -eq 0
if ($nueva) {
  Write-Host '  Primera instalacion. Datos de la base de datos PostgreSQL (Enter = valor entre corchetes):'
  $previa = Read-Host '  Si tienes el .env de la instalacion anterior (correo, claves, etc.), escribe su ruta. Enter para omitir'
  if ($previa -and (Test-Path $previa.Trim('"'))) {
    $cfg = LeerEnv $previa.Trim('"')
    foreach ($k in @('DATABASE_URL', 'PORT', 'NODE_ENV', 'CORS_ORIGIN', 'VITE_HTTPS_CERT', 'VITE_HTTPS_KEY', 'API_BASE_URL', 'APP_BASE_URL', 'ENV_FILE', 'UPLOADS_DIR')) { if ($cfg.Contains($k)) { $cfg.Remove($k) } }
    Ok 'Se tomaron los valores de la instalacion anterior (correo, claves, integraciones).'
  }
  $dbHost = Preguntar 'Servidor de PostgreSQL' 'localhost'
  $dbPort = Preguntar 'Puerto de PostgreSQL' '5432'
  $dbName = Preguntar 'Nombre de la base' 'Agendav2'
  $dbUser = Preguntar 'Usuario' 'postgres'
  $sec = Read-Host '  Clave del usuario' -AsSecureString
  $dbPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $webPort = Preguntar 'Puerto de la Agenda para las PCs de la red' '5180'
  Write-Host ''
  Write-Host '  Datos de la instalacion anterior (para mudarse a este servidor). Enter para omitir:'
  $respaldo = (Read-Host '  Respaldo de la base a cargar (.dump)').Trim('"')
  if ($respaldo -and -not (Test-Path $respaldo)) { throw "No existe el respaldo $respaldo" }
  $uploadsPrevios = (Read-Host '  Carpeta de archivos subidos (uploads) de la instalacion anterior').Trim('"')
  if ($uploadsPrevios -and -not (Test-Path $uploadsPrevios)) { throw "No existe la carpeta $uploadsPrevios" }
  $passUrl = [Uri]::EscapeDataString($dbPass)
  $cfg['DATABASE_URL'] = "postgresql://$($dbUser):$passUrl@$($dbHost):$dbPort/$($dbName)?schema=public"
  $cfg['NODE_ENV'] = 'production'
  $cfg['PORT'] = '3002'
  $cfg['WEB_PUERTO'] = $webPort
  if (-not $cfg.Contains('COLA_MODO')) { $cfg['COLA_MODO'] = 'db' }
  if (-not $cfg.Contains('RECORDATORIOS_WORKER_INLINE')) { $cfg['RECORDATORIOS_WORKER_INLINE'] = 'true' }
  foreach ($k in @('JWT_SECRET', 'CONFIRM_TOKEN_SECRET', 'ARCHIVO_FIRMA_SECRET')) { if (-not $cfg[$k]) { $cfg[$k] = Secreto } }
  if (-not $cfg['JWT_EXPIRES_IN']) { $cfg['JWT_EXPIRES_IN'] = '12h' }
} else {
  Ok "Ya instalado: se usa $ENVF (no se pregunta nada)."
}
$webPort = if ($cfg['WEB_PUERTO']) { $cfg['WEB_PUERTO'] } else { '5180' }
# Direcciones permitidas (CORS): https://<cada IP del servidor>:<puerto>, nombre del equipo y localhost.
$origenes = @("https://localhost:$webPort", "https://$($env:COMPUTERNAME):$webPort".ToLower()) + (IPsDelServidor | ForEach-Object { "https://$($_):$webPort" })
$extra = @(); if ($cfg['CORS_EXTRA']) { $extra = $cfg['CORS_EXTRA'].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
$cfg['CORS_ORIGIN'] = (($origenes + $extra) | Select-Object -Unique) -join ','
$ip1 = (IPsDelServidor | Select-Object -First 1)
if (-not $cfg['APP_BASE_URL']) { $cfg['APP_BASE_URL'] = "https://$($ip1):$webPort" }
if (-not $cfg['API_BASE_URL']) { $cfg['API_BASE_URL'] = "https://$($ip1):$webPort" }

# ─── 2. Certificado HTTPS (el dictado por voz exige https) ─────────────────────
Titulo 'Certificado HTTPS'
$tieneCert = ($cfg['HTTPS_PFX'] -and (Test-Path (Join-Path $CONFIG $cfg['HTTPS_PFX']))) -or ($cfg['HTTPS_CERT'] -and $cfg['HTTPS_KEY'])
$dirCert = Join-Path $CONFIG 'certificado'; New-Item -ItemType Directory -Force -Path $dirCert | Out-Null
if (-not $tieneCert) {
  # Certificado firmado por la autoridad de Limablue (lo genera sistemas con crear-certificado-servidor.ps1): sin aviso en las PCs.
  $carpetaCert = (Read-Host '  Carpeta con el certificado de Limablue (servidor.crt y servidor.key). Enter = crear uno propio').Trim('"')
  if ($carpetaCert) {
    foreach ($f in 'servidor.crt', 'servidor.key') { if (-not (Test-Path (Join-Path $carpetaCert $f))) { throw "No esta $f en $carpetaCert" } }
    Copy-Item (Join-Path $carpetaCert 'servidor.crt'), (Join-Path $carpetaCert 'servidor.key') $dirCert -Force
    if (Test-Path (Join-Path $carpetaCert 'limablue-ca.crt')) { Copy-Item (Join-Path $carpetaCert 'limablue-ca.crt') (Join-Path $dirCert 'limablue-ca-para-las-PCs.crt') -Force }
    $cfg['HTTPS_CERT'] = 'certificado\servidor.crt'; $cfg['HTTPS_KEY'] = 'certificado\servidor.key'
    foreach ($k in 'HTTPS_PFX', 'HTTPS_PFX_CLAVE') { if ($cfg.Contains($k)) { $cfg.Remove($k) } }
    $tieneCert = $true
    Ok 'Se usa el certificado de Limablue. Las PCs que ya confian en la autoridad de Limablue no ven ningun aviso.'
  }
}
if ($tieneCert) { Ok 'Certificado HTTPS listo.' } else {
  $san = (@("DNS=$($env:COMPUTERNAME)", 'DNS=localhost') + (IPsDelServidor | ForEach-Object { "IPAddress=$_" }) + @('IPAddress=127.0.0.1')) -join '&'
  $cert = New-SelfSignedCertificate -Subject "CN=Limablue Agenda ($($env:COMPUTERNAME))" -TextExtension @("2.5.29.17={text}$san") `
    -CertStoreLocation 'Cert:\LocalMachine\My' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(5) -FriendlyName 'Limablue Agenda'
  $clave = Secreto
  Export-PfxCertificate -Cert $cert -FilePath (Join-Path $dirCert 'servidor.pfx') -Password (ConvertTo-SecureString $clave -AsPlainText -Force) | Out-Null
  Export-Certificate -Cert $cert -FilePath (Join-Path $dirCert 'servidor-para-las-PCs.cer') | Out-Null
  $cfg['HTTPS_PFX'] = 'certificado\servidor.pfx'; $cfg['HTTPS_PFX_CLAVE'] = $clave
  Ok "Certificado creado. Para quitar el aviso «No es seguro», instala $dirCert\servidor-para-las-PCs.cer en cada PC (ver LEEME)."
}
EscribirEnv $ENVF $cfg
# Solo administradores y el sistema leen la configuración (tiene claves).
& icacls $CONFIG /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
Ok "Configuracion guardada en $ENVF"

# ─── 3. Detener lo que esté corriendo ──────────────────────────────────────────
Titulo 'Servicio'
if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$APP*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Ok 'Version anterior detenida.'
}

# ─── 4. Base de datos: carga del respaldo (solo en una base vacía) y migraciones ─
Titulo 'Base de datos'
if ($nueva -and $respaldo) {
  $pgRestore = Herramienta 'pg_restore.exe'; $psql = Herramienta 'psql.exe'; $createdb = Herramienta 'createdb.exe'
  $verRestore = [int]([regex]::Match((& $pgRestore --version), '(\d+)').Groups[1].Value)
  $verDump = [int]([regex]::Match(((& $pgRestore -l $respaldo | Select-String 'Dumped by pg_dump version') -join ''), 'version (\d+)').Groups[1].Value)
  if ($verDump -and $verRestore -lt $verDump) { throw "El respaldo es de PostgreSQL $verDump y este servidor tiene PostgreSQL $verRestore. Instala PostgreSQL $verDump o superior." }
  $env:PGPASSWORD = $dbPass
  try {
    $existe = (& $psql -h $dbHost -p $dbPort -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'") -join ''
    if ($existe.Trim() -eq '1') {
      $tablas = [int]((& $psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") -join '').Trim()
      if ($tablas -gt 0) { throw "La base $dbName ya tiene datos: no se carga el respaldo encima. Usa otra base vacia o borrala antes (ver LEEME)." }
    } else {
      & $createdb -h $dbHost -p $dbPort -U $dbUser $dbName
      if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la base $dbName." }
    }
    Write-Host '  Cargando el respaldo (unos minutos)...'
    & $pgRestore --no-owner --no-privileges -h $dbHost -p $dbPort -U $dbUser -d $dbName $respaldo
    $citas = ((& $psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -tAc 'SELECT count(*) FROM citas') -join '').Trim()
    if (-not $citas) { throw 'El respaldo no se cargo bien (no se pudo leer la tabla de citas).' }
    Ok "Respaldo cargado: $citas citas."
  } finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
}
if ($nueva -and $uploadsPrevios) {
  & robocopy $uploadsPrevios (Join-Path $DATOS 'uploads') /E /R:1 /W:2 /NP /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "No se pudieron copiar los archivos subidos (robocopy $LASTEXITCODE)." }
  Ok ("Archivos subidos copiados: {0}" -f (Get-ChildItem (Join-Path $DATOS 'uploads') -Recurse -File).Count)
}
$env:DATABASE_URL = $cfg['DATABASE_URL']
& $NODE (Join-Path $RAIZ 'node_modules\prisma\build\index.js') migrate deploy --schema (Join-Path $APP 'prisma\schema.prisma')
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron aplicar las migraciones. Revisa los datos de PostgreSQL en agenda.env (ver LEEME).' }
Remove-Item Env:\DATABASE_URL
Ok 'Base de datos al dia.'

# ─── 5. Firewall ──────────────────────────────────────────────────────────────
if (-not (Get-NetFirewallRule -DisplayName 'Limablue Agenda' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Limablue Agenda' -Direction Inbound -Protocol TCP -LocalPort $webPort -Action Allow -Profile Domain,Private | Out-Null
  Ok "Puerto $webPort abierto en el firewall (red de la empresa)."
}

# ─── 6. Tarea de Windows: arranca con el servidor, sin sesión, y se reinicia si cae ─
$accion = New-ScheduledTaskAction -Execute $NODE -Argument "`"$(Join-Path $APP 'servidor.js')`"" -WorkingDirectory $APP
$disparador = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TAREA -Action $accion -Trigger $disparador -Principal $principal -Settings $ajustes -Description 'Limablue Agenda (pantallas + API). Programa y logs: ver LEEME.' -Force | Out-Null
Ok "Tarea «$TAREA» registrada (arranca sola al prender el servidor)."

# ─── 7. Respaldos automáticos (13:00 y 20:00): base + archivos subidos, copia al NAS ─
$dirHerr = Join-Path $DATOS 'herramientas'; New-Item -ItemType Directory -Force -Path $dirHerr | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'respaldar.ps1') (Join-Path $dirHerr 'respaldar.ps1') -Force   # la tarea usa esta copia (no depende de la carpeta del programa)
$TAREA_BK = 'Limablue Agenda - Respaldo'
if (Get-ScheduledTask -TaskName $TAREA_BK -ErrorAction SilentlyContinue) { Ok "Respaldos automaticos ya programados (13:00 y 20:00)." } else {
  Titulo 'Respaldos automaticos'
  $nas = Preguntar 'Carpeta del NAS para guardar copia de los respaldos (escribe NO para guardar solo en este servidor)' '\\192.168.0.77\it limablue\BK Agenda Servidor'
  $accionBk = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $dirHerr 'respaldar.ps1')`""
  $horas = @((New-ScheduledTaskTrigger -Daily -At '13:00'), (New-ScheduledTaskTrigger -Daily -At '20:00'))
  $ajustesBk = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
  if ($nas -and $nas.ToUpper() -ne 'NO') {
    $cfg['RESPALDO_COPIA_DIR'] = $nas
    EscribirEnv $ENVF $cfg
    Write-Host '  Para copiar al NAS, la tarea corre con un usuario de Windows que tenga acceso a esa carpeta.'
    $usuarioBk = Preguntar 'Usuario de Windows' "$env:USERDOMAIN\$env:USERNAME"
    $secBk = Read-Host '  Clave de ese usuario (la guarda Windows, no la Agenda)' -AsSecureString
    $claveBk = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secBk))
    Register-ScheduledTask -TaskName $TAREA_BK -Action $accionBk -Trigger $horas -Settings $ajustesBk -User $usuarioBk -Password $claveBk -RunLevel Highest -Description 'Respaldo de Limablue Agenda (base + archivos) con copia al NAS.' -Force | Out-Null
    $claveBk = $null
  } else {
    $principalBk = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TAREA_BK -Action $accionBk -Trigger $horas -Settings $ajustesBk -Principal $principalBk -Description 'Respaldo de Limablue Agenda (base + archivos), solo en este servidor.' -Force | Out-Null
  }
  Ok "Respaldos programados a las 13:00 y 20:00 en $DATOS\respaldos$(if ($cfg['RESPALDO_COPIA_DIR']) { ' + copia en ' + $cfg['RESPALDO_COPIA_DIR'] })."
}

if (-not $SinIniciar) {
  Start-ScheduledTask -TaskName $TAREA
  Write-Host '  Arrancando...'
  $listo = $false
  for ($i = 0; $i -lt 40 -and -not $listo; $i++) {
    Start-Sleep -Seconds 3
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$($cfg['PORT'])/health"; $listo = $r.StatusCode -eq 200 } catch { }
  }
  if ($listo) { Ok 'La Agenda esta funcionando.' } else { Aviso "Todavia no responde. Revisa el log en $DATOS\logs" }
}

Titulo 'Listo'
foreach ($ip in IPsDelServidor) { Write-Host "  Desde las PCs de la red:  https://$($ip):$webPort" -ForegroundColor White }
Write-Host "  Configuracion: $ENVF"
Write-Host "  Logs:          $DATOS\logs"
Write-Host ''
