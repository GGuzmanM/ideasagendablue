# Limablue Agenda - llaves de las APIs de reservas (12-nov-2026: una para la WEB y otra para WhatsApp, cada una con su direccion).
#   1 = CREAR llave de WHATSAPP   (reemplaza solo la de WhatsApp)   -> /api/v1/integraciones/whatsapp
#   2 = CREAR llave WEB           (reemplaza solo la web)           -> /api/v1/integraciones/reservas
#   3 = DESACTIVAR la de WhatsApp     4 = DESACTIVAR la web
#   5 = CREAR llave de SOLO LECTURA (21-nov-2026: solo consulta profesionales y sedes, no crea ni cambia nada)
#   6 = DESACTIVAR la de solo lectura
# Crear una llave nueva hace que la anterior DE ESE TIPO deje de funcionar al instante; la otra no se toca.
# La llave se muestra UNA sola vez en esta pantalla. En la base solo queda su huella: si se pierde, se crea otra.
# Quien la tenga puede registrar reservas (crear citas) en tu nombre: entregala solo a su proveedor, por un canal seguro,
# y no la pegues en chats ni correos abiertos.
$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot
$NODE = Join-Path $RAIZ 'node\node.exe'
$DATOS = if ($env:LIMABLUE_DATOS) { $env:LIMABLUE_DATOS } else { Join-Path $env:ProgramData 'Limablue Agenda' }
$ENVF = Join-Path $DATOS 'config\agenda.env'
$TAREA = 'Limablue Agenda'

function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  !   $t" -ForegroundColor Yellow }
function LeerEnv($ruta) {
  $h = [ordered]@{}
  foreach ($l in Get-Content $ruta -Encoding UTF8) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $h[$Matches[1]] = $Matches[2].Trim().Trim('"') } }
  return $h
}
function EscribirEnv($ruta, $h) {
  $lineas = @('# Limablue Agenda - configuracion del servidor. Generado por el instalador; se puede editar.', '# Despues de editar: Detener.bat e Iniciar.bat.', '')
  foreach ($k in $h.Keys) { $v = [string]$h[$k]; if ($v -match '[\s#"]') { $v = '"' + $v.Replace('"', '\"') + '"' }; $lineas += "$k=$v" }
  [IO.File]::WriteAllLines($ruta, $lineas, (New-Object Text.UTF8Encoding $false))
}
function Base([string]$accion) {
  $env:DATABASE_URL = $cfg['DATABASE_URL']
  try {
    $salida = & $NODE (Join-Path $PSScriptRoot 'reserva-servicios.js') $accion
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la base de datos (ver el mensaje de arriba).' }
  } finally { Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue }
  return ($salida | Select-Object -Last 1 | ConvertFrom-Json)
}
function Reiniciar() {
  if (-not (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue)) { Aviso 'Reinicia la Agenda (Detener.bat e Iniciar.bat) para que tome el cambio.'; return }
  Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Start-ScheduledTask -TaskName $TAREA
  Ok 'Agenda reiniciada (tarda unos segundos en volver).'
}

if (-not (Test-Path $ENVF)) { throw 'La Agenda no esta instalada: corre «Instalar o actualizar.bat» primero.' }
$cfg = LeerEnv $ENVF
$puerto = if ($cfg['WEB_PUERTO'] -and $cfg['WEB_PUERTO'] -ne '443') { ":$($cfg['WEB_PUERTO'])" } else { '' }
$host1 = if ($cfg['DIRECCION_PUBLICA']) { $cfg['DIRECCION_PUBLICA'].Split(',')[0].Trim() } else { $env:COMPUTERNAME.ToLower() }

$TIPOS = @{
  '1' = @{ accion = 'llave-whatsapp'; nombre = 'WhatsApp'; ruta = 'whatsapp'; quien = 'el chat de WhatsApp' }
  '2' = @{ accion = 'llave-web'; nombre = 'web'; ruta = 'reservas'; quien = 'la web' }
  '5' = @{ accion = 'llave-lectura'; nombre = 'de solo lectura'; ruta = ''; quien = 'quien la tenga' }
}

Write-Host ''
Write-Host '== Llaves de las APIs de reservas ==' -ForegroundColor Cyan
Write-Host '  1 = CREAR llave de WHATSAPP (reemplaza solo la de WhatsApp)'
Write-Host '  2 = CREAR llave WEB (reemplaza solo la web)'
Write-Host '  3 = DESACTIVAR la llave de WhatsApp'
Write-Host '  4 = DESACTIVAR la llave web'
Write-Host '  5 = CREAR llave de SOLO LECTURA (consulta profesionales y sedes; reemplaza solo esa)'
Write-Host '  6 = DESACTIVAR la llave de solo lectura'
$op = (Read-Host '  Elige (Enter = no cambiar)').Trim()
if (-not $op) { exit 0 }
if ($op -notin @('1', '2', '3', '4', '5', '6')) { Aviso 'Opcion no valida. No se cambio nada.'; exit 1 }

if ($op -in @('3', '4', '6')) {
  $t = if ($op -eq '3') { $TIPOS['1'] } elseif ($op -eq '4') { $TIPOS['2'] } else { $TIPOS['5'] }
  Base "sin-$($t.accion)" | Out-Null
  if ($op -eq '6') { Ok 'Llave de solo lectura desactivada: ya no se puede consultar con ella.' } else { Ok "Llave $($t.nombre) desactivada: $($t.quien) ya no puede reservar." }
  exit 0
}

# Llave de SOLO LECTURA: no necesita la llave interna ni reiniciar; solo consulta (GET) profesionales y sedes.
if ($op -eq '5') {
  $r = Base 'llave-lectura'
  Write-Host ''
  Write-Host '  Llave de solo lectura (se muestra UNA sola vez; copiala ahora):' -ForegroundColor White
  Write-Host ''
  Write-Host "    $($r.llave)" -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Que puede hacer: SOLO consultar (GET), nada mas:' -ForegroundColor White
  Write-Host "    https://$host1$puerto/api/v1/profesionales?sedeId=...&fecha=AAAA-MM-DD&unidadNegocioId=..." -ForegroundColor White
  Write-Host "    https://$host1$puerto/api/v1/sedes" -ForegroundColor White
  Write-Host '    Cabecera:        Authorization: ApiKey <la llave>' -ForegroundColor White
  Write-Host '  No crea, cambia ni borra nada; cualquier otra direccion responde 403. La anterior de solo lectura deja de servir.' -ForegroundColor White
  exit 0
}

$t = $TIPOS[$op]
if ($op -eq '2') {
  Aviso 'La llave web que se usa hoy dejara de funcionar en cuanto se cree la nueva.'
  if ((Read-Host '  Escribe SI para continuar').Trim().ToUpper() -ne 'SI') { Aviso 'No se cambio nada.'; exit 0 }
}

# La Agenda crea la cita con una llave interna (solo vive en este servidor): se asegura que exista.
if (-not $cfg['RESERVA_WEB_API_KEY']) {
  $cfg['RESERVA_WEB_API_KEY'] = (Base 'llave').llave
  EscribirEnv $ENVF $cfg
  Ok 'Llave interna de la reserva creada.'
  $reiniciar = $true
}
$r = Base $t.accion
if ($reiniciar) { Reiniciar }
Write-Host ''
Write-Host "  Llave $($t.nombre) (se muestra UNA sola vez; copiala ahora):" -ForegroundColor White
Write-Host ''
Write-Host "    $($r.llave)" -ForegroundColor Yellow
Write-Host ''
Write-Host '  Como se usa (servidor a servidor):' -ForegroundColor White
Write-Host "    Direccion base:  https://$host1$puerto/api/v1/integraciones/$($t.ruta)" -ForegroundColor White
Write-Host '    Cabecera:        Authorization: ApiKey <la llave>' -ForegroundColor White
Write-Host '  Esta llave solo sirve en esa direccion (la otra API tiene su propia llave).' -ForegroundColor White
Write-Host '  Los servicios que se pueden reservar son los marcados como «reserva en linea» en la base.' -ForegroundColor White
Write-Host '  Si la llave se pierde, vuelve a correr este archivo (la anterior de ese tipo deja de servir).' -ForegroundColor White
