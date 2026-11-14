# Limablue Agenda - integraciones del chat de WhatsApp (13-nov-2026). Guarda los datos SOLO en agenda.env de este servidor.
#   1 = Conectar la tienda WooCommerce (pago previo de sabado y domingo por el chat)
#   2 = Secreto del aviso de pago (webhook de WooCommerce)
#   3 = Aviso por WhatsApp 2 h antes de la cita (flujo de GHL)
#   4 = Apagar el pago previo        5 = Apagar el aviso de 2 h
# Las claves se escriben a ciegas (no se ven en pantalla) y NUNCA se muestran despues: aqui solo se ve si estan «configuradas».
# No van en el repositorio ni en el paquete de instalacion. Para cambiarlas, se vuelve a correr este archivo.
$ErrorActionPreference = 'Stop'
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
function Reiniciar() {
  if (-not (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue)) { Aviso 'Reinicia la Agenda (Detener.bat e Iniciar.bat) para que tome el cambio.'; return }
  Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Start-ScheduledTask -TaskName $TAREA
  Ok 'Agenda reiniciada (tarda unos segundos en volver).'
}
# Lectura a ciegas: lo escrito no aparece en pantalla ni queda en el historial.
function LeerOculto([string]$texto) {
  $s = Read-Host "  $texto" -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
function Estado($k) { if ($cfg[$k]) { 'configurado' } else { 'falta' } }

if (-not (Test-Path $ENVF)) { throw 'La Agenda no esta instalada: corre «Instalar o actualizar.bat» primero.' }
$cfg = LeerEnv $ENVF
$puerto = if ($cfg['WEB_PUERTO'] -and $cfg['WEB_PUERTO'] -ne '443') { ":$($cfg['WEB_PUERTO'])" } else { '' }
$host1 = if ($cfg['DIRECCION_PUBLICA']) { $cfg['DIRECCION_PUBLICA'].Split(',')[0].Trim() } else { $env:COMPUTERNAME.ToLower() }
$urlAviso = "https://$host1$puerto/api/v1/publico/pagos/woo"

Write-Host ''
Write-Host '== Integraciones del chat de WhatsApp ==' -ForegroundColor Cyan
$tienda = if ($cfg['WOO_URL']) { ([Uri]$cfg['WOO_URL']).Host } else { 'falta' }
Write-Host "  Tienda WooCommerce:    $tienda   (clave: $(Estado 'WOO_CONSUMER_KEY'), secreto: $(Estado 'WOO_CONSUMER_SECRET'))"
Write-Host "  Secreto del aviso:     $(Estado 'WOO_WEBHOOK_SECRET')"
Write-Host "  Aviso 2 h (GHL):       $(Estado 'GHL_AVISO_WEBHOOK_URL')"
Write-Host ''
Write-Host '  1 = Conectar la tienda WooCommerce (pago previo de sabado y domingo)'
Write-Host '  2 = Secreto del aviso de pago (webhook de WooCommerce)'
Write-Host '  3 = Aviso por WhatsApp 2 h antes de la cita (GHL)'
Write-Host '  4 = APAGAR el pago previo'
Write-Host '  5 = APAGAR el aviso de 2 h'
$op = (Read-Host '  Elige (Enter = no cambiar)').Trim()
if (-not $op) { exit 0 }
if ($op -notin @('1', '2', '3', '4', '5')) { Aviso 'Opcion no valida. No se cambio nada.'; exit 1 }

if ($op -eq '1') {
  Write-Host '  Datos de WooCommerce > Ajustes > Avanzado > API REST (permisos de lectura y escritura).' -ForegroundColor White
  $u = (Read-Host '  Direccion de la tienda (https://...)').Trim().TrimEnd('/')
  if ($u -notmatch '^https://[^\s/]+') { Aviso 'La direccion debe empezar con https://. No se cambio nada.'; exit 1 }
  $k = LeerOculto 'Consumer key (ck_..., no se ve al escribir)'
  $s = LeerOculto 'Consumer secret (cs_..., no se ve al escribir)'
  if ($k -notmatch '^ck_\w+$' -or $s -notmatch '^cs_\w+$') { Aviso 'La clave debe empezar con ck_ y el secreto con cs_. No se cambio nada.'; exit 1 }
  # Prueba de conexion (solo lee: pide 1 pedido). Nada de lo escrito se muestra.
  try {
    $aut = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${k}:${s}"))
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-RestMethod -Uri "$u/wp-json/wc/v3/orders?per_page=1" -Headers @{ Authorization = $aut } -TimeoutSec 20 | Out-Null
    Ok 'La tienda respondio: la clave funciona.'
  } catch {
    Aviso "La tienda no acepto la clave o no respondio ($($_.Exception.Message))."
    if ((Read-Host '  Guardar de todos modos? (escribe SI)').Trim().ToUpper() -ne 'SI') { Aviso 'No se cambio nada.'; exit 1 }
  }
  $cfg['WOO_URL'] = $u; $cfg['WOO_CONSUMER_KEY'] = $k; $cfg['WOO_CONSUMER_SECRET'] = $s
  EscribirEnv $ENVF $cfg
  Ok 'Tienda conectada: los sabados y domingos del chat se pagaran antes (10 minutos para pagar).'
  if (-not $cfg['WOO_WEBHOOK_SECRET']) { Aviso 'Falta el secreto del aviso de pago (opcion 2): sin el, la Agenda no se entera de los pagos.' }
  Reiniciar
  exit 0
}

if ($op -eq '2') {
  Write-Host '  Enter = generar uno nuevo (queda copiado para pegarlo en WooCommerce).  O escribe el que ya usas.' -ForegroundColor White
  $sec = LeerOculto 'Secreto (no se ve al escribir; Enter = generar)'
  if (-not $sec) {
    $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $sec = ([Convert]::ToBase64String($b)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Clipboard -Value $sec
    Ok 'Secreto nuevo generado y COPIADO al portapapeles (no se muestra).'
  } elseif ($sec.Length -lt 16) { Aviso 'El secreto debe tener al menos 16 caracteres. No se cambio nada.'; exit 1 }
  $cfg['WOO_WEBHOOK_SECRET'] = $sec
  EscribirEnv $ENVF $cfg
  Ok 'Secreto guardado.'
  Write-Host ''
  Write-Host '  En WooCommerce > Ajustes > Avanzado > Webhooks > Anadir webhook:' -ForegroundColor White
  Write-Host '    Nombre:          Agenda - pago previo' -ForegroundColor White
  Write-Host '    Estado:          Activo' -ForegroundColor White
  Write-Host '    Tema:            Pedido actualizado' -ForegroundColor White
  Write-Host "    URL de entrega:  $urlAviso" -ForegroundColor Yellow
  Write-Host '    Secreto:         pega el secreto (Ctrl+V)' -ForegroundColor White
  Write-Host '    Version de API:  WP REST API Integration v3' -ForegroundColor White
  Write-Host '  Despues de pegarlo, copia cualquier otra cosa para que el secreto no quede en el portapapeles.' -ForegroundColor White
  Reiniciar
  exit 0
}

if ($op -eq '3') {
  Write-Host '  URL del webhook entrante del flujo de GHL «Aviso de cita 2 h antes» (la da quien administra GHL).' -ForegroundColor White
  $g = LeerOculto 'URL de GHL (https://..., no se ve al escribir)'
  if ($g -notmatch '^https://\S+$') { Aviso 'La URL debe empezar con https://. No se cambio nada.'; exit 1 }
  $cfg['GHL_AVISO_WEBHOOK_URL'] = $g
  EscribirEnv $ENVF $cfg
  Ok 'Aviso de 2 h activado: solo para citas reservadas por el chat de WhatsApp.'
  Reiniciar
  exit 0
}

if ($op -eq '4') {
  foreach ($k in @('WOO_URL', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET', 'WOO_WEBHOOK_SECRET')) { $cfg.Remove($k) }
  EscribirEnv $ENVF $cfg
  Ok 'Pago previo apagado: los sabados y domingos del chat vuelven a pagarse en la sede.'
  Aviso 'Las reservas que estaban esperando su pago ya no se cierran solas: revisalas en la agenda (Reservas web).'
  Reiniciar
  exit 0
}

if ($op -eq '5') {
  $cfg.Remove('GHL_AVISO_WEBHOOK_URL')
  EscribirEnv $ENVF $cfg
  Ok 'Aviso de 2 h apagado.'
  Reiniciar
  exit 0
}
