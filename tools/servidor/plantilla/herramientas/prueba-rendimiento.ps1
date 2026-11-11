# Limablue Agenda - prueba de rendimiento (SOLO LEE: hace consultas de lectura, no crea ni cambia nada).
# Entra con un usuario de la agenda y mide cuanto tardan las pantallas que mas se usan: cargar la agenda del dia, buscar un paciente,
# consultar horarios libres y una consulta liviana de control. Primero de a una (para ver el tiempo normal) y luego varias a la vez
# (para ver como responde cuando muchas recepcionistas trabajan juntas).
# Uso:  powershell -ExecutionPolicy Bypass -File prueba-rendimiento.ps1 [-Base https://localhost:5180] [-Vueltas 15] [-Paralelo 10]
#   -Base       direccion de la agenda. En el servidor:  https://localhost:5180   (en desarrollo:  http://localhost:3002)
#   -Busqueda   texto a buscar en pacientes (por defecto "maria")
# La clave se pide en pantalla (no se guarda ni se muestra). Conviene correrla antes y despues de una actualizacion, y en horas de uso.
param(
  [string]$Base = 'https://localhost:5180',
  [string]$Correo,
  [int]$Vueltas = 15,
  [int]$Paralelo = 10,
  [string]$Busqueda = 'maria'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
# El servidor de la clinica usa un certificado propio: solo en esta prueba se acepta (se habla con la propia agenda).
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$Base = $Base.TrimEnd('/')
# Si se apunta al servidor de produccion, las rutas del API cuelgan de la raiz (/api/v1)
$api = "$Base/api/v1"

function Percentil($v, [double]$p) {
  $o = @($v | Sort-Object); if ($o.Count -eq 0) { return 0 }
  return [double]$o[[math]::Min($o.Count - 1, [math]::Max(0, [math]::Ceiling($p / 100 * $o.Count) - 1))]
}
function Resumen([string]$nombre, $ms, [int]$fallos) {
  $v = @($ms); if ($v.Count -eq 0) { Write-Host ('{0,-34} sin respuestas ({1} fallos)' -f $nombre, $fallos); return }
  $prom = ($v | Measure-Object -Average).Average; $max = ($v | Measure-Object -Maximum).Maximum; $min = ($v | Measure-Object -Minimum).Minimum
  $marca = if ((Percentil $v 95) -ge 1000) { '  <-- LENTO' } elseif ((Percentil $v 95) -ge 400) { '  <-- regular' } else { '' }
  Write-Host ('{0,-34} min {1,5:N0}  prom {2,5:N0}  p95 {3,5:N0}  max {4,5:N0} ms{5}{6}' -f $nombre, $min, $prom, (Percentil $v 95), $max, $(if ($fallos) { "  ($fallos con error)" } else { '' }), $marca)
}

# --- entrar ----------------------------------------------------------------------------------------------------------------
if (-not $Correo) { $Correo = Read-Host 'Correo de un usuario de la agenda' }
if ($env:LIMABLUE_PRUEBA_CLAVE) {
  $clave = $env:LIMABLUE_PRUEBA_CLAVE   # solo para correrla sin teclado (automatizada)
} else {
  $seg = Read-Host 'Clave (no se muestra)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)
  try { $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType 'application/json' -Body (@{ email = $Correo; password = $clave } | ConvertTo-Json)
$clave = $null
$cab = @{ Authorization = "Bearer $($login.token)" }
Write-Host ("Entro como {0} ({1})." -f $login.usuario.nombre, $login.usuario.rol)

# --- datos de prueba (solo lectura) -----------------------------------------------------------------------------------------
# Windows PowerShell 5.1 devuelve un arreglo JSON como UN solo objeto: se aplana (y se acepta { sedes: [...] } o un arreglo directo)
function Lista($r, [string]$prop) {
  $x = $r
  if ($prop -and $x -and $x.PSObject.Properties[$prop]) { $x = $x.$prop }
  $o = @($x)
  if ($o.Count -eq 1 -and ($o[0] -is [System.Array])) { $o = @($o[0]) }
  return $o
}
$sedes = Lista (Invoke-RestMethod -Uri "$api/sedes" -Headers $cab) 'sedes'
$sede = $sedes | Where-Object { $_.activa -ne $false } | Select-Object -First 1
$hoy = (Get-Date).ToString('yyyy-MM-dd')
$servicios = Lista (Invoke-RestMethod -Uri "$api/servicios" -Headers $cab) 'servicios'
$serv = $null
# Se busca un servicio que la sede de prueba realmente ofrezca (si la unidad no opera en esa sede, la consulta responde 400)
foreach ($c in @($servicios | Where-Object { $_.activo -ne $false -and $_.unidadNegocioId } | Select-Object -First 20)) {
  try { Invoke-RestMethod -Uri "$api/disponibilidad?sede=$($sede.id)&unidadNegocio=$($c.unidadNegocioId)&servicio=$($c.id)&fecha=$hoy" -Headers $cab | Out-Null; $serv = $c; break } catch { }
}
Write-Host ("Sede de prueba: {0}. Fecha: {1}. Busqueda: '{2}'." -f $sede.nombre, $hoy, $Busqueda)
Write-Host ''

$pruebas = @(
  @{ Nombre = 'Control: lista de sedes'; Url = "$api/sedes" },
  @{ Nombre = 'Cargar la agenda del dia'; Url = "$api/citas?sedeId=$($sede.id)&fecha=$hoy" },
  @{ Nombre = "Buscar paciente '$Busqueda'"; Url = "$api/pacientes/buscar?q=$([uri]::EscapeDataString($Busqueda))" }
)
if ($serv) { $pruebas += @{ Nombre = 'Horarios libres de un servicio'; Url = "$api/disponibilidad?sede=$($sede.id)&unidadNegocio=$($serv.unidadNegocioId)&servicio=$($serv.id)&fecha=$hoy" } }

# --- 1. de a una -------------------------------------------------------------------------------------------------------------
Write-Host "1) DE A UNA ($Vueltas veces cada una): el tiempo normal que siente una persona"
foreach ($p in $pruebas) {
  $ms = New-Object System.Collections.ArrayList; $fallos = 0
  for ($i = 0; $i -lt $Vueltas; $i++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try { Invoke-RestMethod -Uri $p.Url -Headers $cab | Out-Null; [void]$ms.Add($sw.Elapsed.TotalMilliseconds) } catch { $fallos++; $ultimoError = $_.Exception.Message }
  }
  Resumen $p.Nombre $ms $fallos
  if ($fallos -and $ultimoError) { Write-Host ('   ultimo error: ' + $ultimoError) -ForegroundColor Yellow; $ultimoError = $null }
}

# --- 2. varias a la vez --------------------------------------------------------------------------------------------------------
Write-Host ''
Write-Host "2) $Paralelo A LA VEZ (como varias recepcionistas abriendo la agenda juntas)"
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.ServerCertificateCustomValidationCallback = { $true }
$cli = New-Object System.Net.Http.HttpClient($handler)
$cli.Timeout = [TimeSpan]::FromSeconds(60)
$cli.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $login.token)
foreach ($p in ($pruebas | Where-Object { $_.Nombre -notlike 'Control*' })) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $tareas = @(1..$Paralelo | ForEach-Object { $cli.GetAsync($p.Url) })
  $fin = @{}; $fallos = 0
  while ($fin.Count -lt $tareas.Count -and $sw.Elapsed.TotalSeconds -lt 60) {
    for ($i = 0; $i -lt $tareas.Count; $i++) { if (-not $fin.ContainsKey($i) -and $tareas[$i].IsCompleted) { $fin[$i] = $sw.Elapsed.TotalMilliseconds; if ($tareas[$i].IsFaulted -or -not $tareas[$i].Result.IsSuccessStatusCode) { $fallos++ } } }
    Start-Sleep -Milliseconds 5
  }
  Resumen $p.Nombre @($fin.Values) $fallos
}
Write-Host ''
Write-Host 'Referencia: bien = p95 menor a 400 ms; regular = de 400 a 1000 ms; lento = 1 s o mas. Con varias a la vez es normal que suba algo.'
