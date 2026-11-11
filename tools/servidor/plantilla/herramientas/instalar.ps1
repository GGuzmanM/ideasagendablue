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
# La versión MÁS NUEVA instalada (si conviven PostgreSQL 15 y 18, se usan las herramientas de la 18).
function Herramienta([string]$n) {
  $c = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending |
    ForEach-Object { Join-Path $_.FullName "bin\$n" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($c) { return $c }
  $c = Get-Command $n -ErrorAction SilentlyContinue; if ($c) { return $c.Source }
  throw "No encuentro $n. Instala PostgreSQL (o sus herramientas de cliente) en este servidor."
}
function IPsDelServidor() {
  return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress)
}

Write-Host ''
Write-Host '  Limablue Agenda - instalacion en el servidor' -ForegroundColor White
$verArchivo = Join-Path $RAIZ 'version.txt'
if (Test-Path $verArchivo) { Write-Host "  Version:  $((Get-Content $verArchivo -TotalCount 1).Trim())" -ForegroundColor White }
Write-Host "  Programa: $RAIZ"
Write-Host "  Datos:    $DATOS"
if (-not (Test-Path $NODE)) { throw "No se encuentra $NODE. Copia la carpeta completa del programa." }
# Si la Agenda instalada corría desde OTRA carpeta, se avisa: desde ahora corre desde esta.
$tareaPrevia = Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
if ($tareaPrevia -and $tareaPrevia.Actions[0].WorkingDirectory -and ($tareaPrevia.Actions[0].WorkingDirectory.TrimEnd('\') -ne $APP.TrimEnd('\'))) {
  Aviso "La Agenda corria desde $(Split-Path -Parent $tareaPrevia.Actions[0].WorkingDirectory). Desde ahora corre desde $RAIZ (la carpeta anterior se puede borrar despues)."
}

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
  $webPort = Preguntar 'Puerto de la Agenda (443 si entrara por internet con dominio)' '5180'
  Write-Host ''
  Write-Host '  Si el servidor esta en INTERNET (IP publica o dominio):'
  $publico = (Read-Host '  Direccion publica por la que entraran (ej. 161.132.166.44 o agenda.limablue.com). Enter = solo red interna').Trim()
  if ($publico) { $cfg['DIRECCION_PUBLICA'] = $publico }
  $permitidas = (Read-Host '  IPs que pueden entrar (las IPs publicas de las sedes, separadas por coma). Enter = cualquiera').Trim()
  if ($permitidas) { $cfg['FIREWALL_IPS_PERMITIDAS'] = $permitidas }
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
  # Instalación de PRUEBA mientras la PC anterior sigue atendiendo: los dos sistemas tienen los mismos pacientes, así que
  # aquí se apaga todo lo que sale hacia afuera (correos, recordatorios, videos, encuestas, reserva web, Outlook). Los
  # valores reales quedan guardados como CORTE_ORIGINAL_* y «Cargar datos del corte.bat» los devuelve.
  $prueba = Preguntar 'Es una instalacion de PRUEBA mientras la PC anterior sigue atendiendo? (S = no envia correos ni sincroniza Outlook)' 'S'
  if ($prueba.ToUpper().StartsWith('S')) {
    $cfg['MODO_PRUEBA'] = 'true'
    $apagar = [ordered]@{ MAIL_DRY_RUN = 'true'; RECORDATORIOS_ACTIVOS = 'false'; VIDEOS_SERVICIO_ACTIVOS = 'false'; ENCUESTA_SATISFACCION_ACTIVA = 'false'; RESERVA_WEB_HABILITADA = 'false'; AZURE_TENANT_ID = ''; AZURE_CLIENT_ID = ''; AZURE_CLIENT_SECRET = '' }
    foreach ($k in $apagar.Keys) {
      $cfg["CORTE_ORIGINAL_$k"] = if ($cfg.Contains($k)) { [string]$cfg[$k] } else { '__no_estaba__' }
      $cfg[$k] = $apagar[$k]
    }
    Aviso 'MODO PRUEBA: no se envian correos ni recordatorios ni se toca Outlook. Lo que se registre aqui se reemplaza el dia del corte.'
  }
} else {
  Ok "Ya instalado: se usa $ENVF (no se pregunta nada)."
}
$webPort = if ($cfg['WEB_PUERTO']) { $cfg['WEB_PUERTO'] } else { '5180' }
# Direcciones permitidas (CORS): https://<cada IP del servidor>:<puerto>, nombre del equipo y localhost.
$origenes = @("https://localhost:$webPort", "https://$($env:COMPUTERNAME):$webPort".ToLower()) + (IPsDelServidor | ForEach-Object { "https://$($_):$webPort" })
$extra = @(); if ($cfg['CORS_EXTRA']) { $extra = @($cfg['CORS_EXTRA'].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
# Dirección pública (servidor en internet): en la nube la IP pública suele NO estar en la tarjeta de red (NAT).
$sufijo = if ($webPort -eq '443') { '' } else { ":$webPort" }
# @(…) siempre: con UNA sola dirección PowerShell devuelve un texto y $publicas[0] sería su primera letra ("https://1").
$publicas = @(); if ($cfg['DIRECCION_PUBLICA']) { $publicas = @($cfg['DIRECCION_PUBLICA'].Split(',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }) }
$origenesPublicos = $publicas | ForEach-Object { "https://$_$sufijo" }
if ($webPort -eq '443') { $origenes += ($origenes | ForEach-Object { $_ -replace ':443$', '' }) }
$cfg['CORS_ORIGIN'] = (($origenes + $origenesPublicos + $extra) | Select-Object -Unique) -join ','
$base = if ($publicas.Count) { "https://$($publicas[0])$sufijo" } else { "https://$(IPsDelServidor | Select-Object -First 1)$sufijo" }
# Enlaces de los correos (confirmar / cancelar / encuesta) y verificación de recetas. Se recalculan en cada
# instalación si apuntan a una IP de este servidor (p. ej. cambió el puerto de 5180 a 443); un dominio propio se respeta.
$propias = @($publicas) + @(IPsDelServidor) + @('localhost')
# RESERVA_WEB_URL_PUBLICA: direccion a la que vuelve el paciente despues de pagar con Niubiz (se toma la misma si esta vacia).
foreach ($k in @('APP_BASE_URL', 'API_BASE_URL', 'RESERVA_WEB_URL_PUBLICA')) {
  $v = [string]$cfg[$k]
  # También se corrige una dirección rota sin punto en el nombre (p. ej. "https://1" que dejó el error de arriba).
  $esPropia = -not $v -or $v -notmatch '^https?://[^/:]+\.[^/:]+' -or @($propias | Where-Object { $v -match ('^https?://' + [regex]::Escape($_) + '(:\d+)?/?$') }).Count -gt 0
  if ($esPropia) { $cfg[$k] = $base }
}

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
  $sanPublicos = $publicas | ForEach-Object { if ($_ -match '^\d{1,3}(\.\d{1,3}){3}$') { "IPAddress=$_" } else { "DNS=$_" } }
  $san = (@("DNS=$($env:COMPUTERNAME)", 'DNS=localhost') + (IPsDelServidor | ForEach-Object { "IPAddress=$_" }) + @('IPAddress=127.0.0.1') + $sanPublicos | Select-Object -Unique) -join '&'
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
if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue }
# Se cierra la Agenda que esté corriendo AUNQUE sea de otra carpeta (antes solo se cerraba la de esta carpeta: si la
# versión nueva se copiaba a otra ruta, el API viejo seguía vivo en el puerto y la «nueva» le pasaba todo a él).
$puertos = @([int]$cfg['PORT'], [int]$webPort) | Where-Object { $_ }
$enPuertos = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $puertos -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique)
$viejos = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -like '*\app\servidor.js*' -or $_.CommandLine -like '*\app\api.js*' -or $enPuertos -contains $_.ProcessId })
foreach ($p in $viejos) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($viejos.Count) {
  Start-Sleep -Seconds 2
  Ok ("Version anterior detenida ({0} proceso(s))." -f $viejos.Count)
}
$ocupado = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $puertos -contains $_.LocalPort })
if ($ocupado.Count) {
  $quien = ($ocupado | ForEach-Object { $pr = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; "puerto $($_.LocalPort): $($pr.ProcessName) (PID $($_.OwningProcess))" }) -join '; '
  throw "Los puertos de la Agenda siguen ocupados por otro programa ($quien). Cierralo y vuelve a correr el instalador."
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
# Todos los perfiles (un servidor en internet suele estar en perfil «Público»). Si hay IPs permitidas, SOLO ellas entran.
$remotas = if ($cfg['FIREWALL_IPS_PERMITIDAS']) { @($cfg['FIREWALL_IPS_PERMITIDAS'].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) } else { @('Any') }
Remove-NetFirewallRule -DisplayName 'Limablue Agenda' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Limablue Agenda' -Direction Inbound -Protocol TCP -LocalPort $webPort -Action Allow -Profile Any -RemoteAddress $remotas | Out-Null
if ($remotas[0] -eq 'Any') { Ok "Puerto $webPort abierto en el firewall." } else { Ok "Puerto $webPort abierto SOLO para: $($remotas -join ', ')" }
$apagados = @(Get-NetFirewallProfile | Where-Object { -not $_.Enabled } | Select-Object -ExpandProperty Name)
if ($apagados.Count) { Aviso "El firewall de Windows esta DESACTIVADO ($($apagados -join ', ')): esta regla no tiene efecto y PostgreSQL / Escritorio remoto podrian quedar expuestos. Activalo (ver LEEME)." }
if ($cfg['DIRECCION_PUBLICA'] -and $remotas[0] -eq 'Any') { Aviso 'El servidor esta en internet y cualquiera puede llegar a la pantalla de login. Recomendado: limitar a las IPs de las sedes (FIREWALL_IPS_PERMITIDAS en agenda.env y volver a correr el instalador).' }

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
  $nas = Preguntar 'Carpeta para la COPIA de los respaldos: otro disco (ej. E:\Respaldos Agenda) o el NAS. NO = sin copia' 'E:\Respaldos Agenda'
  $accionBk = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $dirHerr 'respaldar.ps1')`""
  $horas = @((New-ScheduledTaskTrigger -Daily -At '13:00'), (New-ScheduledTaskTrigger -Daily -At '20:00'))
  $ajustesBk = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
  if ($nas -and $nas.ToUpper() -ne 'NO') { $cfg['RESPALDO_COPIA_DIR'] = $nas; EscribirEnv $ENVF $cfg }
  # Solo una carpeta de RED (\\...) necesita un usuario de Windows con acceso; otro disco del servidor va con SYSTEM.
  if ($nas -and $nas.StartsWith('\\')) {
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
  # Que responda no basta: debe responder el API de ESTA carpeta (no uno viejo que haya quedado vivo).
  $dueno = Get-NetTCPConnection -State Listen -LocalPort ([int]$cfg['PORT']) -ErrorAction SilentlyContinue | Select-Object -First 1
  $cmdApi = if ($dueno) { (Get-CimInstance Win32_Process -Filter "ProcessId=$($dueno.OwningProcess)").CommandLine } else { '' }
  if ($listo -and $cmdApi -and $cmdApi -notlike "*$(Join-Path $APP 'api.js')*") {
    Aviso "Responde un API que NO es de esta carpeta: $cmdApi. Cierra ese proceso y vuelve a correr el instalador."
  } elseif ($listo) { Ok 'La Agenda esta funcionando (version nueva).' } else { Aviso "Todavia no responde. Revisa el log en $DATOS\logs" }
}

Titulo 'Listo'
if ($cfg['MODO_PRUEBA'] -eq 'true') { Aviso 'MODO PRUEBA activo (sin correos ni Outlook). El dia del corte: "Cargar datos del corte.bat".' }
foreach ($p in $publicas) { Write-Host "  Desde internet:           https://$p$sufijo/acceso_agenda_lb/login" -ForegroundColor White }
foreach ($ip in IPsDelServidor) { Write-Host "  Desde la red del servidor: https://$ip$sufijo/acceso_agenda_lb/login" -ForegroundColor White }
Write-Host "  Configuracion: $ENVF"
Write-Host "  Logs:          $DATOS\logs"
Write-Host ''
