# Limablue Agenda - reserva web para pacientes en https://<servidor>/reserva. Dos estados:
#   VITRINA   se recorre completa con los horarios reales, pero NO aparta, NO cobra y NO crea citas.
#   APAGADA   la página /reserva no responde.
# La cita se crea SOLO cuando el pago queda aprobado (21-oct-2026): sin pasarela de pago no se agenda nada.
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
$actual = if ($cfg['RESERVA_WEB_HABILITADA'] -ne '1') { 'APAGADA' } elseif ($cfg['RESERVA_WEB_MODO'] -eq 'vitrina') { 'VITRINA (solo se ve)' } else { 'ENCENDIDA (sin pasarela de pago no agenda: elige 1 para dejarla en vitrina)' }
$puerto = if ($cfg['WEB_PUERTO'] -and $cfg['WEB_PUERTO'] -ne '443') { ":$($cfg['WEB_PUERTO'])" } else { '' }
$host1 = if ($cfg['DIRECCION_PUBLICA']) { $cfg['DIRECCION_PUBLICA'].Split(',')[0].Trim() } else { $env:COMPUTERNAME.ToLower() }

Write-Host ''
Write-Host '== Reserva web para pacientes ==' -ForegroundColor Cyan
Write-Host "  Estado actual: $actual"
Write-Host ''
Write-Host '  1 = VITRINA   se ve completa, no aparta ni crea citas'
Write-Host '  0 = APAGAR'
Write-Host '  (La cita solo se crea cuando el pago queda aprobado: hace falta la pasarela de pago.)'
$op = (Read-Host '  Elige (Enter = no cambiar)').Trim()
if (-not $op) { exit 0 }
if ($op -notin @('0', '1')) { Aviso 'Opcion no valida. No se cambio nada.'; exit 1 }

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

Base 'sin-llave' | Out-Null; $r = Base 'marcar'
$cfg['RESERVA_WEB_MODO'] = 'vitrina'
$cfg['RESERVA_WEB_HABILITADA'] = '1'
EscribirEnv $ENVF $cfg
Ok "Servicios que se muestran: $($r.servicios)."
Reiniciar
Write-Host ''
Write-Host "  Pagina de reserva:  https://$host1$puerto/reserva" -ForegroundColor White
Write-Host "  API (para la web):  https://$host1$puerto/api/v1/publico/reservas" -ForegroundColor White
Write-Host '  VITRINA: muestra horarios reales, pero no aparta ni crea citas.' -ForegroundColor White
