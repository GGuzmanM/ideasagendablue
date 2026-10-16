# Limablue Agenda - reserva web para pacientes en https://<servidor>/reserva. Tres estados:
#   VITRINA   se recorre completa con los horarios reales, pero NO aparta, NO cobra y NO crea citas.
#   SIN PAGO  crea la cita de verdad (canal web, «Pendiente de pago»); el pago en línea se agrega después.
#             Solo en MODO PRUEBA: en este servidor todavía no son los datos definitivos.
#   APAGADA   la página /reserva no responde.
# El día del corte («Cargar datos del corte.bat», definitivo) se apaga sola.
$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot
$NODE = Join-Path $RAIZ 'node\node.exe'
$DATOS = if ($env:LIMABLUE_DATOS) { $env:LIMABLUE_DATOS } else { Join-Path $env:ProgramData 'Limablue Agenda' }
$ENVF = Join-Path $DATOS 'config\agenda.env'
$TAREA = 'Limablue Agenda'
$CLAVES = @('RESERVA_WEB_HABILITADA', 'RESERVA_WEB_MODO', 'RESERVA_WEB_API_KEY')

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
  $salida = & $NODE (Join-Path $PSScriptRoot 'reserva-servicios.js') $accion
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la base de datos (ver el mensaje de arriba).' }
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
$prueba = $cfg['MODO_PRUEBA'] -eq 'true'
$actual = if ($cfg['RESERVA_WEB_HABILITADA'] -ne '1') { 'APAGADA' } elseif ($cfg['RESERVA_WEB_MODO'] -eq 'sin_pago') { 'SIN PAGO (crea citas)' } else { 'VITRINA (solo se ve)' }
$puerto = if ($cfg['WEB_PUERTO'] -and $cfg['WEB_PUERTO'] -ne '443') { ":$($cfg['WEB_PUERTO'])" } else { '' }
$host1 = if ($cfg['DIRECCION_PUBLICA']) { $cfg['DIRECCION_PUBLICA'].Split(',')[0].Trim() } else { $env:COMPUTERNAME.ToLower() }

Write-Host ''
Write-Host '== Reserva web para pacientes ==' -ForegroundColor Cyan
Write-Host "  Estado actual: $actual"
Write-Host ''
Write-Host '  1 = VITRINA   se ve completa, no aparta ni crea citas'
Write-Host "  2 = SIN PAGO  crea la cita de verdad (Pendiente de pago)$(if (-not $prueba) { '  [no disponible: datos reales]' })"
Write-Host '  0 = APAGAR'
$op = (Read-Host '  Elige (Enter = no cambiar)').Trim()
if (-not $op) { exit 0 }
if ($op -notin @('0', '1', '2')) { Aviso 'Opcion no valida. No se cambio nada.'; exit 1 }
if ($op -eq '2' -and -not $prueba) {
  Aviso 'Este servidor ya trabaja con los datos reales: para crear citas desde internet hace falta la pasarela de pago. No se cambio nada.'
  exit 1
}

if ($prueba) {
  # En modo prueba, que el corte devuelva los valores originales (si el instalador no los guardo ya).
  foreach ($k in $CLAVES) {
    if (-not $cfg.Contains("CORTE_ORIGINAL_$k")) { $cfg["CORTE_ORIGINAL_$k"] = if ($cfg.Contains($k)) { [string]$cfg[$k] } else { '__no_estaba__' } }
  }
}

if ($op -eq '0') {
  Base 'sin-llave' | Out-Null
  $cfg['RESERVA_WEB_HABILITADA'] = '0'
  EscribirEnv $ENVF $cfg
  Ok 'Reserva web apagada (la pagina /reserva deja de responder).'
  Reiniciar
  exit 0
}

if ($op -eq '1') {
  Base 'sin-llave' | Out-Null; $r = Base 'marcar'
  $cfg['RESERVA_WEB_MODO'] = 'vitrina'
} else {
  $r = Base 'llave'
  $cfg['RESERVA_WEB_MODO'] = 'sin_pago'
  $cfg['RESERVA_WEB_API_KEY'] = $r.llave
}
$cfg['RESERVA_WEB_HABILITADA'] = '1'
EscribirEnv $ENVF $cfg
Ok "Servicios que se muestran: $($r.servicios)."
Reiniciar
Write-Host ''
Write-Host "  Pagina de reserva:  https://$host1$puerto/reserva" -ForegroundColor White
Write-Host "  API (para la web):  https://$host1$puerto/api/v1/publico/reservas" -ForegroundColor White
if ($op -eq '1') { Write-Host '  VITRINA: muestra horarios reales, pero no aparta ni crea citas.' -ForegroundColor White }
else { Write-Host '  SIN PAGO: cada reserva crea la cita en la Agenda (canal web, Pendiente de pago).' -ForegroundColor White }
