# Limablue Agenda - llave de la API de reservas para el chat de WhatsApp.
#   1 = CREAR una llave nueva (reemplaza la anterior: la vieja deja de funcionar al instante).
#   0 = DESACTIVAR la llave (el chat deja de poder reservar).
# La llave se muestra UNA sola vez en esta pantalla. En la base solo queda su huella: si se pierde, se crea otra.
# Quien la tenga puede registrar reservas (crear citas) en tu nombre: entregala solo al proveedor del chat, por un canal seguro,
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

Write-Host ''
Write-Host '== Llave de la API de reservas (chat de WhatsApp) ==' -ForegroundColor Cyan
Write-Host '  1 = CREAR una llave nueva (reemplaza la anterior)'
Write-Host '  0 = DESACTIVAR la llave'
$op = (Read-Host '  Elige (Enter = no cambiar)').Trim()
if (-not $op) { exit 0 }
if ($op -notin @('0', '1')) { Aviso 'Opcion no valida. No se cambio nada.'; exit 1 }

if ($op -eq '0') {
  Base 'sin-llave-chat' | Out-Null
  Ok 'Llave desactivada: el chat ya no puede reservar.'
  exit 0
}

# La Agenda crea la cita con una llave interna (solo vive en este servidor): se asegura que exista.
if (-not $cfg['RESERVA_WEB_API_KEY']) {
  $cfg['RESERVA_WEB_API_KEY'] = (Base 'llave').llave
  EscribirEnv $ENVF $cfg
  Ok 'Llave interna de la reserva creada.'
  $reiniciar = $true
}
$r = Base 'llave-chat'
if ($reiniciar) { Reiniciar }
Write-Host ''
Write-Host '  Llave del chat (se muestra UNA sola vez; copiala ahora):' -ForegroundColor White
Write-Host ''
Write-Host "    $($r.llave)" -ForegroundColor Yellow
Write-Host ''
Write-Host '  Como se usa (servidor a servidor):' -ForegroundColor White
Write-Host "    Direccion base:  https://$host1$puerto/api/v1/integraciones/reservas" -ForegroundColor White
Write-Host '    Cabecera:        Authorization: ApiKey <la llave>' -ForegroundColor White
Write-Host '  Los servicios que se pueden reservar son los marcados como «reserva en linea» en la base.' -ForegroundColor White
Write-Host '  Si la llave se pierde, vuelve a correr este archivo (la anterior deja de servir).' -ForegroundColor White
