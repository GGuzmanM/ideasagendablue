# Limablue Agenda - diagnostico de rendimiento del servidor. SOLO LEE: no cambia nada del sistema ni de la base de datos.
#  - Foto del equipo (procesador, memoria, discos) y, durante unos minutos, mide cada pocos segundos el procesador, la memoria,
#    el disco y lo que gastan la agenda (node), PostgreSQL, el antivirus y Redis.
#  - Lee los registros de la agenda: peticiones lentas por ruta y por hora, errores y reinicios; y los cruza con las mediciones.
#  - Consulta PostgreSQL en solo lectura: configuracion, tablas, consultas largas, bloqueos y consultas mas costosas.
# Uso:  powershell -ExecutionPolicy Bypass -File diagnostico.ps1 [-Minutos 2] [-CadaSegundos 5]
# Para cazar la lentitud que aparece "a veces": dejarlo corriendo en horario de atencion (-Minutos 60 o mas; Ctrl+C genera igual el informe).
# El informe queda en  <datos>\diagnostico\diagnostico-AAAAMMDD-HHMM.txt  (y las mediciones en un .csv). No incluye claves.
param([double]$Minutos = 2, [int]$CadaSegundos = 5, [string]$EnvFile, [string]$DirLogs, [int]$DiasLogs = 2)
$ErrorActionPreference = 'Continue'
$DATOS = if ($env:LIMABLUE_DATOS) { $env:LIMABLUE_DATOS } else { Join-Path $env:ProgramData 'Limablue Agenda' }
if (-not $EnvFile) { $EnvFile = Join-Path $DATOS 'config\agenda.env' }
if (-not $DirLogs) { $DirLogs = Join-Path $DATOS 'logs' }
$DirSalida = Join-Path $DATOS 'diagnostico'
New-Item -ItemType Directory -Force -Path $DirSalida | Out-Null
$sello = Get-Date -Format 'yyyyMMdd-HHmm'
$informe = Join-Path $DirSalida "diagnostico-$sello.txt"
$archivoCsv = Join-Path $DirSalida "mediciones-$sello.csv"
Set-Content -Path $informe -Value '' -Encoding UTF8
function Linea([string]$t = '') { Write-Host $t; Add-Content -Path $informe -Value $t -Encoding UTF8 }
function Titulo([string]$t) { Linea ''; Linea ('=' * 74); Linea $t; Linea ('=' * 74) }
$script:hallazgos = New-Object System.Collections.ArrayList
function Hallazgo([string]$t) { [void]$script:hallazgos.Add($t) }
function Percentil($valores, [double]$p) {
  $o = @($valores | Sort-Object)
  if ($o.Count -eq 0) { return 0 }
  $i = [math]::Min($o.Count - 1, [math]::Max(0, [math]::Ceiling($p / 100 * $o.Count) - 1))
  return [double]$o[$i]
}
function Promedio($valores) { $v = @($valores); if ($v.Count -eq 0) { return 0 }; return [double](($v | Measure-Object -Average).Average) }
# La hora de Lima (UTC-5), la misma con la que la agenda escribe sus registros
function HoraLima { return [DateTime]::UtcNow.AddHours(-5) }

$script:muestras = New-Object System.Collections.ArrayList
$script:inicioMedicion = $null
$script:finMedicion = $null
$script:ramGB = 0
$script:nucleos = 1

# ----------------------------------------------------------------------------------------------------------------------
function Equipo {
  Titulo '1. EL EQUIPO'
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $cpus = @(Get-CimInstance Win32_Processor)
  $script:nucleos = [int](($cpus | Measure-Object NumberOfLogicalProcessors -Sum).Sum)
  $script:ramGB = $cs.TotalPhysicalMemory / 1GB
  Linea ("Sistema:      {0} (encendido desde {1})" -f $os.Caption, $os.LastBootUpTime)
  Linea ("Procesador:   {0} | {1} procesadores logicos" -f $cpus[0].Name.Trim(), $script:nucleos)
  Linea ("Memoria:      {0:N1} GB en total, {1:N1} GB libres ahora" -f $script:ramGB, ($os.FreePhysicalMemory / 1MB))
  Linea ("Equipo:       {0} {1}" -f $cs.Manufacturer, $cs.Model)
  try {
    foreach ($d in @(Get-PhysicalDisk)) { Linea ("Disco fisico:  {0} | {1} | {2} GB | salud {3}" -f $d.FriendlyName, $d.MediaType, [math]::Round($d.Size / 1GB), $d.HealthStatus) }
  } catch { Linea 'Disco fisico:  no se pudo leer' }
  foreach ($u in @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    $libre = if ($u.Size) { 100 * $u.FreeSpace / $u.Size } else { 100 }
    Linea ("Unidad {0}      {1:N0} GB libres de {2:N0} GB ({3:N0}% libre)" -f $u.DeviceID, ($u.FreeSpace / 1GB), ($u.Size / 1GB), $libre)
    if ($libre -lt 10) { Hallazgo ("La unidad {0} tiene menos del 10% libre: un disco casi lleno vuelve lento a todo." -f $u.DeviceID) }
  }
  try {
    $t = Get-ScheduledTask -TaskName 'Limablue Agenda' -ErrorAction Stop
    Linea ("Tarea 'Limablue Agenda': {0}" -f $t.State)
  } catch { Linea "Tarea 'Limablue Agenda': no encontrada (si la agenda corre a mano, es normal)" }
  $nodes = @(Get-Process node -ErrorAction SilentlyContinue)
  foreach ($n in $nodes) { Linea ("Proceso node {0}: iniciado {1}, memoria {2} MB" -f $n.Id, $n.StartTime, [math]::Round($n.WorkingSet64 / 1MB)) }
  try {
    $mp = Get-MpComputerStatus -ErrorAction Stop
    Linea ("Antivirus (Defender): proteccion en tiempo real = {0}" -f $mp.RealTimeProtectionEnabled)
    $pref = Get-MpPreference -ErrorAction Stop
    $ex = @($pref.ExclusionPath)
    if ($ex.Count -gt 0 -and ([string]$ex[0]) -like '*administrator*') { Linea 'Exclusiones de Defender: no se pueden ver sin administrador' } elseif ($ex.Count -gt 0 -and $ex[0]) { Linea ("Exclusiones de Defender: {0}" -f ($ex -join '; ')) } else { Linea 'Exclusiones de Defender: ninguna' }
  } catch { Linea 'Antivirus (Defender): no se pudo consultar (puede ser otro antivirus)' }
}

# ----------------------------------------------------------------------------------------------------------------------
function RawDisco { Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" }
function Latencia($a, $b, [string]$campo) {
  $d = [double]($b."${campo}_Base" - $a."${campo}_Base")
  if ($d -le 0 -or -not $b.Frequency_PerfTime) { return 0 }
  return ((([double]($b.$campo - $a.$campo)) / [double]$b.Frequency_PerfTime) / $d) * 1000
}
function Muestrear {
  $total = [int][math]::Max(1, [math]::Round($Minutos * 60 / $CadaSegundos))
  Titulo ("2. MEDICIONES: {0} minutos, una muestra cada {1} segundos" -f $Minutos, $CadaSegundos)
  Linea 'Mientras se mide, use la agenda con normalidad (o espere a que aparezca la lentitud).'
  $script:inicioMedicion = HoraLima
  $raw1 = RawDisco
  for ($i = 1; $i -le $total; $i++) {
    $t0 = Get-Date
    $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
    $mem = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    $dsk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
    $raw2 = RawDisco
    $latL = Latencia $raw1 $raw2 'AvgDisksecPerRead'
    $latE = Latencia $raw1 $raw2 'AvgDisksecPerWrite'
    $raw1 = $raw2
    $procs = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name like 'node%' or Name like 'postgres%' or Name like 'MsMpEng%' or Name like 'redis%' or Name like 'memurai%'")
    $nodes = @($procs | Where-Object { $_.Name -like 'node*' })
    $pg = @($procs | Where-Object { $_.Name -like 'postgres*' })
    $av = @($procs | Where-Object { $_.Name -like 'MsMpEng*' })
    $rd = @($procs | Where-Object { $_.Name -like 'redis*' -or $_.Name -like 'memurai*' })
    $nodeMax = if ($nodes.Count) { ($nodes | Measure-Object PercentProcessorTime -Maximum).Maximum } else { 0 }
    $fila = [pscustomobject][ordered]@{
      Hora            = (HoraLima).ToString('yyyy-MM-dd HH:mm:ss')
      CpuTotalPct     = [double]$cpu
      MemLibreMB      = [double]$mem.AvailableMBytes
      PaginasPorSeg   = [double]$mem.PagesInputPersec
      DiscoOcupadoPct = [double]$dsk.PercentDiskTime
      ColaDisco       = [double]$dsk.AvgDiskQueueLength
      LatLecturaMs    = [math]::Round($latL, 2)
      LatEscrituraMs  = [math]::Round($latE, 2)
      NodeMaxNucleoPct = [double]$nodeMax
      NodeMB          = [math]::Round((($nodes | Measure-Object WorkingSet -Sum).Sum) / 1MB)
      PostgresCpuPct  = [math]::Round((($pg | Measure-Object PercentProcessorTime -Sum).Sum) / $script:nucleos, 1)
      PostgresMB      = [math]::Round((($pg | Measure-Object WorkingSet -Sum).Sum) / 1MB)
      AntivirusCpuPct = [math]::Round((($av | Measure-Object PercentProcessorTime -Sum).Sum) / $script:nucleos, 1)
      RedisMB         = [math]::Round((($rd | Measure-Object WorkingSet -Sum).Sum) / 1MB)
    }
    [void]$script:muestras.Add($fila)
    $script:finMedicion = HoraLima
    Write-Host ("  {0}  cpu {1,3}%  memoria libre {2,6} MB  disco {3,3}% (cola {4})  node {5,3}%  postgres {6,4}%" -f ($fila.Hora.Substring(11)), $fila.CpuTotalPct, $fila.MemLibreMB, $fila.DiscoOcupadoPct, $fila.ColaDisco, $fila.NodeMaxNucleoPct, $fila.PostgresCpuPct)
    $resta = $CadaSegundos - ((Get-Date) - $t0).TotalSeconds
    if ($resta -gt 0) { Start-Sleep -Milliseconds ([int]($resta * 1000)) }
  }
}
function ResumenMediciones {
  if ($script:muestras.Count -eq 0) { return }
  $script:muestras | Export-Csv -Path $archivoCsv -NoTypeInformation -Encoding UTF8
  Titulo '2b. RESUMEN DE LAS MEDICIONES'
  Linea ('{0,-34} {1,10} {2,10} {3,10}' -f 'Medida', 'Promedio', 'p95', 'Maximo')
  $defs = @(
    @('Procesador total (%)', 'CpuTotalPct'), @('Memoria libre (MB)', 'MemLibreMB'), @('Paginacion a disco (pag/s)', 'PaginasPorSeg'),
    @('Disco ocupado (%)', 'DiscoOcupadoPct'), @('Cola del disco', 'ColaDisco'), @('Latencia de lectura (ms)', 'LatLecturaMs'),
    @('Latencia de escritura (ms)', 'LatEscrituraMs'), @('Agenda (node), 1 nucleo = 100%', 'NodeMaxNucleoPct'), @('Agenda (node), memoria MB', 'NodeMB'),
    @('PostgreSQL, % del servidor', 'PostgresCpuPct'), @('PostgreSQL, memoria MB', 'PostgresMB'), @('Antivirus, % del servidor', 'AntivirusCpuPct')
  )
  foreach ($d in $defs) {
    $v = @($script:muestras | ForEach-Object { $_.($d[1]) })
    Linea ('{0,-34} {1,10:N1} {2,10:N1} {3,10:N1}' -f $d[0], (Promedio $v), (Percentil $v 95), (($v | Measure-Object -Maximum).Maximum))
  }
  $cpuV = @($script:muestras | ForEach-Object { $_.CpuTotalPct })
  $memV = @($script:muestras | ForEach-Object { $_.MemLibreMB })
  $colaV = @($script:muestras | ForEach-Object { $_.ColaDisco })
  $latLV = @($script:muestras | ForEach-Object { $_.LatLecturaMs })
  $latEV = @($script:muestras | ForEach-Object { $_.LatEscrituraMs })
  $nodeV = @($script:muestras | ForEach-Object { $_.NodeMaxNucleoPct })
  $avV = @($script:muestras | ForEach-Object { $_.AntivirusCpuPct })
  $pagV = @($script:muestras | ForEach-Object { $_.PaginasPorSeg })
  $muchas = [math]::Round(100 * (@($cpuV | Where-Object { $_ -ge 85 }).Count) / [math]::Max(1, $cpuV.Count))
  if ((Percentil $cpuV 95) -ge 85) { Hallazgo ("Procesador saturado: p95 {0}% y {1}% de las muestras por encima de 85%. Mirar que proceso lo consume (node, postgres, antivirus u otro sistema)." -f (Percentil $cpuV 95), $muchas) }
  if ($script:ramGB -gt 0 -and (($memV | Measure-Object -Minimum).Minimum / 1024) -lt (0.10 * $script:ramGB)) { Hallazgo ("Memoria libre muy baja en algun momento (minimo {0:N1} GB de {1:N0} GB)." -f ((($memV | Measure-Object -Minimum).Minimum) / 1024), $script:ramGB) }
  if ((Percentil $pagV 95) -gt 500) { Hallazgo 'El servidor esta paginando memoria a disco (pag/s alto): falta memoria o hay un proceso que la acapara.' }
  if ((Percentil $latLV 95) -gt 25 -or (Percentil $latEV 95) -gt 50) { Hallazgo ("Disco lento: latencia p95 de lectura {0:N1} ms y de escritura {1:N1} ms (un SSD sano esta por debajo de 5 ms)." -f (Percentil $latLV 95), (Percentil $latEV 95)) }
  if ((Percentil $colaV 95) -gt 2) { Hallazgo ("Cola de disco alta (p95 {0:N1}): el disco no da abasto en esos momentos." -f (Percentil $colaV 95)) }
  if ((Percentil $nodeV 95) -ge 85) { Hallazgo 'La agenda (node) llega a usar un nucleo completo: node trabaja en un solo hilo, asi que ahi esta el cuello de botella (consultas pesadas, PDF o exportaciones).' }
  if ((Percentil $avV 95) -ge 10) { Hallazgo ("El antivirus consume {0:N0}% del servidor (p95). Conviene excluir de su analisis las carpetas de la agenda, de PostgreSQL y de los registros." -f (Percentil $avV 95)) }
}

# ----------------------------------------------------------------------------------------------------------------------
function NormalizarRuta([string]$r) {
  $r = ($r -split '\?')[0]
  $r = [regex]::Replace($r, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ':id')
  $r = [regex]::Replace($r, '/\d+(?=/|$)', '/:n')
  return $r
}
$script:eventos = @()
function AnalizarLogs {
  Titulo '3. REGISTROS DE LA AGENDA'
  if (-not (Test-Path $DirLogs)) { Linea "No existe la carpeta de registros: $DirLogs"; return }
  $archivos = @(Get-ChildItem $DirLogs -Filter 'agenda-*.log' | Sort-Object Name -Descending | Select-Object -First $DiasLogs)
  if ($archivos.Count -eq 0) { Linea 'No hay registros todavia.'; return }
  $reHora = [regex]'^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) '
  $reLento = [regex]'\[LENTO\] (\d+) ms (\w+) (\S+)'
  $reMorgan = [regex]'"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) (\S+) HTTP/[\d.]+" (\d{3}) \S+ ".*?" ".*?" ([\d.]+) ms'
  $morgan = New-Object System.Collections.ArrayList
  $lentos = New-Object System.Collections.ArrayList
  $reinicios = 0; $noManejados = 0; $lineas = 0
  foreach ($f in $archivos) {
    Linea ("Leyendo {0} ({1:N1} MB)" -f $f.Name, ($f.Length / 1MB))
    $t = $null
    foreach ($l in [IO.File]::ReadLines($f.FullName)) {
      $lineas++
      $m = $reHora.Match($l)
      if ($m.Success) { $t = [datetime]::new([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value, [int]$m.Groups[4].Value, [int]$m.Groups[5].Value, [int]$m.Groups[6].Value) }
      if ($l.Contains(' ms')) {
        $x = $reLento.Match($l)
        if ($x.Success) { [void]$lentos.Add([pscustomobject]@{ T = $t; Ms = [double]$x.Groups[1].Value; Metodo = $x.Groups[2].Value; Ruta = (NormalizarRuta $x.Groups[3].Value); Estado = 0 }) }
        else {
          $y = $reMorgan.Match($l)
          if ($y.Success) { [void]$morgan.Add([pscustomobject]@{ T = $t; Ms = [double]::Parse($y.Groups[4].Value, [Globalization.CultureInfo]::InvariantCulture); Metodo = $y.Groups[1].Value; Ruta = (NormalizarRuta $y.Groups[2].Value); Estado = [int]$y.Groups[3].Value }) }
        }
      }
      if ($l.Contains('El API se detuvo')) { $reinicios++ }
      if ($l.Contains('Error no manejado')) { $noManejados++ }
    }
  }
  $fuente = if ($morgan.Count -gt 0) { $morgan } else { $lentos }
  $script:eventos = @($fuente)
  $origen = if ($morgan.Count -gt 0) { 'todas las peticiones del registro' } else { 'solo las peticiones lentas ([LENTO], de 1 s o mas)' }
  Linea ("{0:N0} lineas leidas. Peticiones analizadas: {1:N0} ({2}). Lentas de 1 s o mas: {3:N0}." -f $lineas, $script:eventos.Count, $origen, (@($script:eventos | Where-Object { $_.Ms -ge 1000 }).Count))
  Linea ("Reinicios del API detectados: {0}. Errores no manejados: {1}." -f $reinicios, $noManejados)
  if ($reinicios -gt 0) { Hallazgo ("El API se reinicio {0} veces en los registros revisados: busque 'El API se detuvo' en el registro para ver la causa." -f $reinicios) }
  if ($script:eventos.Count -eq 0) { Linea 'No hay peticiones para analizar.'; return }

  Linea ''
  Linea 'Rutas que mas tiempo consumen (tiempo total = cuenta x promedio):'
  Linea ('{0,-46} {1,7} {2,8} {3,8} {4,8}' -f 'Ruta', 'Cuenta', 'Prom ms', 'p95 ms', 'Max ms')
  $grupos = $script:eventos | Group-Object { $_.Metodo + ' ' + $_.Ruta } | ForEach-Object {
    $v = @($_.Group | ForEach-Object { $_.Ms })
    [pscustomobject]@{ Ruta = $_.Name; Cuenta = $_.Count; Prom = (Promedio $v); P95 = (Percentil $v 95); Max = ($v | Measure-Object -Maximum).Maximum; Total = ($v | Measure-Object -Sum).Sum }
  } | Sort-Object Total -Descending | Select-Object -First 12
  foreach ($g in $grupos) { Linea ('{0,-46} {1,7} {2,8:N0} {3,8:N0} {4,8:N0}' -f ($g.Ruta.Substring(0, [math]::Min(46, $g.Ruta.Length))), $g.Cuenta, $g.Prom, $g.P95, $g.Max) }
  foreach ($g in ($grupos | Where-Object { $_.Cuenta -ge 5 -and ($_.P95 -ge 1500 -or $_.Prom -ge 800) } | Select-Object -First 3)) {
    Hallazgo ("Ruta lenta: {0} (promedio {1:N0} ms, p95 {2:N0} ms, {3} veces)." -f $g.Ruta, $g.Prom, $g.P95, $g.Cuenta)
  }

  Linea ''
  Linea 'Por hora del dia (hora de Lima): cuantas peticiones, tiempo promedio y cuantas fueron lentas (1 s o mas):'
  Linea ('{0,-6} {1,8} {2,9} {3,8}' -f 'Hora', 'Cuenta', 'Prom ms', 'Lentas')
  $porHora = $script:eventos | Where-Object { $_.T } | Group-Object { $_.T.Hour } | Sort-Object { [int]$_.Name }
  $maxLentas = 0; $horaPico = $null
  foreach ($h in $porHora) {
    $v = @($h.Group | ForEach-Object { $_.Ms })
    $len = @($h.Group | Where-Object { $_.Ms -ge 1000 }).Count
    Linea ('{0,-6} {1,8} {2,9:N0} {3,8}' -f ('{0:00}:00' -f [int]$h.Name), $h.Count, (Promedio $v), $len)
    if ($len -gt $maxLentas) { $maxLentas = $len; $horaPico = [int]$h.Name }
  }
  $totalLentas = @($script:eventos | Where-Object { $_.Ms -ge 1000 }).Count
  if ($totalLentas -ge 10 -and $maxLentas -ge 0.4 * $totalLentas) {
    Hallazgo ("Las peticiones lentas se concentran a las {0:00}:00 ({1} de {2}). Las 13:00 y las 20:00 son los respaldos automaticos: si coincide, mover el respaldo a una hora sin atencion." -f $horaPico, $maxLentas, $totalLentas)
  }

  Linea ''
  Linea 'Las 12 peticiones mas lentas:'
  foreach ($e in ($script:eventos | Sort-Object Ms -Descending | Select-Object -First 12)) {
    Linea ('{0}  {1,7:N0} ms  {2} {3}' -f $(if ($e.T) { $e.T.ToString('yyyy-MM-dd HH:mm:ss') } else { '?' }), $e.Ms, $e.Metodo, $e.Ruta)
  }
  $err = @($script:eventos | Where-Object { $_.Estado -ge 500 })
  if ($err.Count -gt 0) { Linea ''; Linea ("Respuestas con error de servidor (5xx): {0}" -f $err.Count); Hallazgo ("Hubo {0} respuestas con error 5xx en los registros revisados." -f $err.Count) }
}

function Correlacion {
  if ($script:muestras.Count -eq 0 -or $script:eventos.Count -eq 0) { return }
  Titulo '4. PETICIONES LENTAS DURANTE LA MEDICION (y como estaba el servidor en ese momento)'
  $en = @($script:eventos | Where-Object { $_.T -and $_.T -ge $script:inicioMedicion.AddSeconds(-$CadaSegundos) -and $_.T -le $script:finMedicion.AddSeconds($CadaSegundos) -and $_.Ms -ge 1000 } | Sort-Object T)
  if ($en.Count -eq 0) { Linea 'No hubo peticiones lentas mientras se midio: la lentitud no aparecio en esta ventana. Repita la medicion durante un episodio (o por mas tiempo).'; return }
  Linea ('{0,-9} {1,7}  {2,-36} {3,5} {4,6} {5,6} {6,6} {7,6}' -f 'Hora', 'ms', 'Ruta', 'CPU%', 'Cola', 'Disco', 'Node%', 'Pg%')
  $cercanas = @()
  foreach ($e in ($en | Select-Object -First 40)) {
    $s = $script:muestras | Sort-Object { [math]::Abs(([datetime]$_.Hora - $e.T).TotalSeconds) } | Select-Object -First 1
    $cercanas += $s
    Linea ('{0,-9} {1,7:N0}  {2,-36} {3,5} {4,6} {5,6} {6,6} {7,6}' -f $e.T.ToString('HH:mm:ss'), $e.Ms, (($e.Metodo + ' ' + $e.Ruta).Substring(0, [math]::Min(36, ($e.Metodo + ' ' + $e.Ruta).Length))), $s.CpuTotalPct, $s.ColaDisco, $s.DiscoOcupadoPct, $s.NodeMaxNucleoPct, $s.PostgresCpuPct)
  }
  $altaCpu = @($cercanas | Where-Object { $_.CpuTotalPct -ge 80 }).Count
  $altaCola = @($cercanas | Where-Object { $_.ColaDisco -gt 2 }).Count
  $altaNode = @($cercanas | Where-Object { $_.NodeMaxNucleoPct -ge 90 }).Count
  $altaPg = @($cercanas | Where-Object { $_.PostgresCpuPct -ge 40 }).Count
  Linea ''
  Linea ("De {0} peticiones lentas: con CPU>=80%: {1} | con cola de disco>2: {2} | con node a un nucleo completo: {3} | con PostgreSQL>=40% del servidor: {4}" -f $cercanas.Count, $altaCpu, $altaCola, $altaNode, $altaPg)
  if ($cercanas.Count -gt 0) {
    if ($altaNode -ge 0.5 * $cercanas.Count) { Hallazgo 'Las peticiones lentas coinciden con la agenda (node) al 100% de un nucleo: el cuello de botella es el propio proceso de la agenda.' }
    elseif ($altaPg -ge 0.5 * $cercanas.Count) { Hallazgo 'Las peticiones lentas coinciden con mucha CPU de PostgreSQL: revisar las consultas costosas (seccion 5) y los indices.' }
    elseif ($altaCola -ge 0.5 * $cercanas.Count) { Hallazgo 'Las peticiones lentas coinciden con el disco saturado.' }
    elseif ($altaCpu -ge 0.5 * $cercanas.Count) { Hallazgo 'Las peticiones lentas coinciden con el procesador alto: mirar que mas esta corriendo en el servidor.' }
    else { Hallazgo 'Las peticiones lentas NO coinciden con picos de CPU, disco ni memoria: la causa probable es una consulta o un bloqueo en la base de datos (seccion 5) o una espera externa (correo, Outlook).' }
  }
}

# ----------------------------------------------------------------------------------------------------------------------
$script:psql = $null
function Herramienta([string]$n) {
  $c = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending |
    ForEach-Object { Join-Path $_.FullName "bin\$n" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($c) { return $c }
  $c = Get-Command $n -ErrorAction SilentlyContinue; if ($c) { return $c.Source }
  return $null
}
function Sql([string]$consulta) {
  # La consulta va en un archivo temporal (-f): pasarla por la linea de comandos de Windows PowerShell 5.1 estropea las comillas.
  $f = [IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $f -Value $consulta -Encoding ASCII
    $o = & $script:psql -h $script:pgHost -p $script:pgPort -U $script:pgUser -d $script:pgDb -X -A -t -F ' | ' -f $f 2>&1
    if ($LASTEXITCODE -ne 0) { return @('(error) ' + (($o | Out-String).Trim())) }
    return @($o | ForEach-Object { "$_" } | Where-Object { $_.Trim() -ne '' })
  } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}
function MostrarSql([string]$titulo, [string]$consulta) {
  Linea ''
  Linea $titulo
  $r = @(Sql $consulta)
  if ($r.Count -eq 0) { Linea '  (sin filas)' } else { foreach ($x in $r) { Linea ('  ' + $x) } }
}
function ToMB([string]$v) {
  if ($v -match '^\s*(\d+)\s*(kB|MB|GB|TB)?\s*$') {
    $n = [double]$Matches[1]
    switch ($Matches[2]) { 'kB' { return $n / 1024 } 'GB' { return $n * 1024 } 'TB' { return $n * 1048576 } default { return $n } }
  }
  return 0
}
function AnalizarPostgres {
  Titulo '5. POSTGRESQL (solo lectura)'
  if (-not (Test-Path $EnvFile)) { Linea "No se encuentra la configuracion: $EnvFile"; return }
  $cfg = @{}
  foreach ($l in Get-Content $EnvFile -Encoding UTF8) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim().Trim('"') } }
  $m = [regex]::Match([string]$cfg['DATABASE_URL'], '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)')
  if (-not $m.Success) { Linea 'DATABASE_URL de agenda.env con formato inesperado: se omite la base de datos.'; return }
  $script:pgUser = $m.Groups[1].Value; $pass = [Uri]::UnescapeDataString($m.Groups[2].Value)
  $script:pgHost = $m.Groups[3].Value; $script:pgPort = $m.Groups[4].Value; $script:pgDb = $m.Groups[5].Value
  $script:psql = Herramienta 'psql.exe'
  if (-not $script:psql) { Linea 'No se encontro psql.exe (herramientas de PostgreSQL): se omite la base de datos.'; return }
  Linea ("Base: {0} en {1}:{2} (usuario {3})" -f $script:pgDb, $script:pgHost, $script:pgPort, $script:pgUser)
  $env:PGPASSWORD = $pass
  $env:PGCONNECT_TIMEOUT = '5'
  $env:PGOPTIONS = '-c statement_timeout=20000 -c default_transaction_read_only=on'
  try {
    $v = @(Sql 'SELECT version();')
    Linea ('Version: ' + ($v -join ' '))
    if ($v[0] -like '(error)*') { return }
    $cfgPg = @(Sql @'
SELECT name || ' = ' || current_setting(name) FROM (VALUES ('shared_buffers'),('effective_cache_size'),('work_mem'),('maintenance_work_mem'),('max_connections'),('random_page_cost'),('checkpoint_timeout'),('max_wal_size'),('synchronous_commit'),('autovacuum'),('log_min_duration_statement')) v(name)
'@)
    Linea ''
    Linea 'Configuracion:'
    foreach ($x in $cfgPg) { Linea ('  ' + $x) }
    $sb = ToMB ((($cfgPg | Where-Object { $_ -like 'shared_buffers*' }) -replace '^.*=\s*', ''))
    $ec = ToMB ((($cfgPg | Where-Object { $_ -like 'effective_cache_size*' }) -replace '^.*=\s*', ''))
    $wm = ToMB ((($cfgPg | Where-Object { $_ -like 'work_mem*' }) -replace '^.*=\s*', ''))
    if ($script:ramGB -ge 16 -and $sb -gt 0 -and $sb -le 256) {
      Hallazgo ("PostgreSQL usa shared_buffers={0:N0} MB con {1:N0} GB de RAM: es la configuracion por defecto y no aprovecha la memoria. Sugerido (si el servidor es solo de la agenda): shared_buffers ~{2:N0} GB, effective_cache_size ~{3:N0} GB, work_mem 32-64 MB." -f $sb, $script:ramGB, [math]::Min(24, [math]::Round($script:ramGB * 0.2)), [math]::Round($script:ramGB * 0.65))
    } elseif ($script:ramGB -ge 16 -and $ec -gt 0 -and $ec -lt ($script:ramGB * 1024 * 0.25)) {
      Hallazgo ("effective_cache_size={0:N0} MB es bajo para {1:N0} GB de RAM: el optimizador subestima la memoria disponible." -f $ec, $script:ramGB)
    }
    if ($wm -gt 0 -and $wm -le 4 -and $script:ramGB -ge 16) { Hallazgo 'work_mem esta en 4 MB (por defecto): ordenamientos y agrupaciones grandes se hacen en disco. Sugerido 32-64 MB.' }

    MostrarSql 'Tamano de la base:' 'SELECT pg_size_pretty(pg_database_size(current_database()));'
    MostrarSql 'Tablas mas grandes (tamano | filas vivas | filas muertas | ultimo autovacuum):' @'
SELECT relname || ' | ' || pg_size_pretty(pg_total_relation_size(relid)) || ' | ' || n_live_tup || ' | ' || n_dead_tup || ' | ' || coalesce(to_char(last_autovacuum,'YYYY-MM-DD HH24:MI'),'nunca') FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12;
'@
    $muertas = @(Sql @'
SELECT relname || ' (' || n_dead_tup || ' muertas de ' || n_live_tup || ')' FROM pg_stat_user_tables WHERE n_live_tup > 10000 AND n_dead_tup > 0.2 * n_live_tup ORDER BY n_dead_tup DESC LIMIT 5;
'@)
    if ($muertas.Count -gt 0 -and $muertas[0] -notlike '(error)*') { Hallazgo ("Tablas con muchas filas muertas (falta limpieza/autovacuum): {0}." -f ($muertas -join '; ')) }
    MostrarSql 'Tablas leidas por barrido completo (las que mas filas leen sin usar indice):' @'
SELECT relname || ' | barridos ' || seq_scan || ' | filas leidas ' || seq_tup_read || ' | usos de indice ' || coalesce(idx_scan,0) FROM pg_stat_user_tables WHERE seq_scan > 0 ORDER BY seq_tup_read DESC LIMIT 8;
'@
    $hit = @(Sql @'
SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) FROM pg_stat_database WHERE datname = current_database();
'@)
    Linea ''
    Linea ('Aciertos de memoria cache de PostgreSQL: {0} %  (lo sano es 99 % o mas)' -f ($hit -join ''))
    if ($hit.Count -gt 0 -and $hit[0] -match '^[\d.]+$' -and [double]$hit[0] -lt 98) { Hallazgo ("La memoria cache de PostgreSQL acierta solo el {0}%: lee mucho del disco. Subir shared_buffers." -f $hit[0]) }
    MostrarSql 'Conexiones por estado:' @'
SELECT coalesce(state, '(sin estado)') || ': ' || count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY 1;
'@
    $itx = @(Sql @'
SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction' AND now() - state_change > interval '30 seconds';
'@)
    if ($itx.Count -gt 0 -and $itx[0] -match '^\d+$' -and [int]$itx[0] -gt 0) { Hallazgo ("Hay {0} conexiones 'idle in transaction' de mas de 30 s: transacciones abiertas que pueden bloquear a otras." -f $itx[0]) }
    MostrarSql 'Consultas que llevan mas de 2 segundos ejecutandose AHORA:' @'
SELECT pid || ' | ' || round(extract(epoch FROM now() - query_start)::numeric, 1) || ' s | ' || left(regexp_replace(query, '\s+', ' ', 'g'), 140) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND now() - query_start > interval '2 seconds' AND pid <> pg_backend_pid();
'@
    $bl = @(Sql 'SELECT count(*) FROM pg_locks WHERE NOT granted;')
    Linea ''
    Linea ('Bloqueos esperando ahora: {0}' -f ($bl -join ''))
    if ($bl.Count -gt 0 -and $bl[0] -match '^\d+$' -and [int]$bl[0] -gt 0) { Hallazgo ("Hay {0} bloqueos esperando en la base de datos en este momento." -f $bl[0]) }
    $ext = @(Sql "SELECT count(*) FROM pg_extension WHERE extname = 'pg_stat_statements';")
    if ($ext.Count -gt 0 -and $ext[0] -eq '1') {
      MostrarSql 'Consultas que mas tiempo consumen en total (pg_stat_statements):' @'
SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 110) || ' | llamadas ' || calls || ' | total ' || round(total_exec_time / 1000) || ' s | media ' || round(mean_exec_time::numeric, 1) || ' ms | max ' || round(max_exec_time::numeric) || ' ms' FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
'@
    } else {
      Linea ''
      Linea 'pg_stat_statements no esta activo: es la mejor herramienta para ver que consultas cuestan mas. Para activarlo (requiere reiniciar PostgreSQL):'
      Linea "  en postgresql.conf:  shared_preload_libraries = 'pg_stat_statements'   y luego, en la base:  CREATE EXTENSION pg_stat_statements;"
    }
    $idx = @(Sql "SELECT count(*) FROM pg_indexes WHERE indexname = 'audit_logs_mover_cita_idx';")
    Linea ''
    Linea ('Indice de reprogramaciones (audit_logs_mover_cita_idx) presente: {0}' -f $(if ($idx.Count -gt 0 -and $idx[0] -eq '1') { 'si' } else { 'NO (falta aplicar la migracion 20261106120000)' }))
    if (-not ($idx.Count -gt 0 -and $idx[0] -eq '1')) { Hallazgo 'Falta el indice audit_logs_mover_cita_idx: esta version de la agenda aun no tiene aplicada la correccion de rendimiento de la agenda y las busquedas.' }
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\PGOPTIONS -ErrorAction SilentlyContinue
  }
}

function OtrosDatos {
  Titulo '6. REDIS Y RESPALDOS'
  $cfg = @{}
  if (Test-Path $EnvFile) { foreach ($l in Get-Content $EnvFile -Encoding UTF8) { if ($l -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim().Trim('"') } } }
  $ru = [string]$cfg['REDIS_URL']
  if (-not $ru) { Linea 'Redis: no configurado (la agenda usa el modo sin Redis).' } else {
    $r = [regex]::Match($ru, '^redis(?:s)?://(?:[^@]*@)?([^:/]+):?(\d*)')
    if ($r.Success) {
      $h = $r.Groups[1].Value; $p = if ($r.Groups[2].Value) { [int]$r.Groups[2].Value } else { 6379 }
      try { $c = New-Object Net.Sockets.TcpClient; $ar = $c.BeginConnect($h, $p, $null, $null); $ok = $ar.AsyncWaitHandle.WaitOne(2000); if ($ok -and $c.Connected) { Linea ("Redis en {0}:{1}: responde." -f $h, $p) } else { Linea ("Redis en {0}:{1}: NO responde." -f $h, $p); Hallazgo 'Redis no responde: la agenda funciona pero los candados de horario y los recordatorios van por el camino lento.' }; $c.Close() } catch { Linea ("Redis en {0}:{1}: error de conexion." -f $h, $p) }
    }
  }
  $rl = Join-Path $DATOS 'respaldos\respaldos.log'
  if (Test-Path $rl) { Linea ''; Linea 'Ultimas lineas del registro de respaldos:'; foreach ($x in (Get-Content $rl -Tail 8 -Encoding UTF8)) { Linea ('  ' + $x) } } else { Linea 'No hay registro de respaldos.' }
}

function Cierre {
  Titulo 'RESUMEN: LO QUE SE ENCONTRO'
  if ($script:hallazgos.Count -eq 0) {
    Linea 'No se detecto un problema claro en esta medicion.'
    Linea 'Si la lentitud aparece "a veces", repita el diagnostico con mas tiempo y en horario de atencion:  Diagnostico de rendimiento.bat  y escriba 60 (minutos).'
  } else {
    $n = 1
    foreach ($h in $script:hallazgos) { Linea ("{0}. {1}" -f $n, $h); $n++ }
  }
  Linea ''
  Linea ("Informe:      {0}" -f $informe)
  if (Test-Path $archivoCsv) { Linea ("Mediciones:   {0}" -f $archivoCsv) }
}

try {
  Equipo
  Muestrear
} finally {
  ResumenMediciones
  AnalizarLogs
  Correlacion
  AnalizarPostgres
  OtrosDatos
  Cierre
}
