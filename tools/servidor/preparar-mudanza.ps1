# Prepara la MUDANZA al servidor (12-oct-2026): junta en AgendaLB\Mudanza lo que el instalador pide la primera vez
# y arma AgendaLB.zip (programa + mudanza) para llevarlo en UN archivo.
#   powershell -ExecutionPolicy Bypass -File tools\servidor\preparar-mudanza.ps1 [-Certificado "...\Servidor 161.132.166.44"] [-SinZip]
# Correrlo de nuevo justo antes del cambio definitivo (el respaldo debe ser de ESE momento).
param(
  [string]$Certificado = 'C:\Users\User\Documents\Documentacion Agenda\Certificado HTTPS\Servidor 161.132.166.44',
  [switch]$SinZip
)
$ErrorActionPreference = 'Stop'
$REPO = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BASE = Join-Path $env:USERPROFILE 'Documents\Agenda Servidor\AgendaLB'
$MUD = Join-Path $BASE 'Mudanza'
$ENVF = Join-Path $REPO 'apps\api\.env'
if (-not (Test-Path (Join-Path $BASE 'Release\version.txt'))) { throw "Falta $BASE\Release. Corre antes: node tools/servidor/empaquetar.mjs" }

if (Test-Path $MUD) { Remove-Item -Recurse -Force $MUD }
New-Item -ItemType Directory -Force -Path $MUD | Out-Null

# 1. Respaldo fresco de la base (con las herramientas de PostgreSQL más nuevas)
$linea = (Select-String -Path $ENVF -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1).Line
$url = ($linea -replace '^\s*DATABASE_URL\s*=', '').Trim().Trim('"')
$m = [regex]::Match($url, '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)')
$bin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory | Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'bin' }
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$dump = Join-Path $MUD "$($m.Groups[5].Value)-$ts.dump"
Write-Host "Respaldando la base $($m.Groups[5].Value)..."
$env:PGPASSWORD = [Uri]::UnescapeDataString($m.Groups[2].Value)
try {
  & (Join-Path $bin 'pg_dump.exe') -Fc --no-owner --no-privileges -h $m.Groups[3].Value -p $m.Groups[4].Value -U $m.Groups[1].Value -d $m.Groups[5].Value -f $dump
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump fallo.' }
  & (Join-Path $bin 'pg_restore.exe') -l $dump | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'El respaldo no paso la verificacion.' }
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }

# 2. Configuración, archivos subidos y certificado
Copy-Item $ENVF (Join-Path $MUD 'api.env')
& robocopy (Join-Path $REPO 'apps\api\uploads') (Join-Path $MUD 'uploads') /E /R:1 /W:1 /NP /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'No se pudieron copiar los uploads.' }
if ($Certificado -and (Test-Path $Certificado)) { Copy-Item $Certificado (Join-Path $MUD 'Certificado') -Recurse }

$nDump = [math]::Round((Get-Item $dump).Length / 1MB, 1)
$nUp = (Get-ChildItem (Join-Path $MUD 'uploads') -Recurse -File).Count
$leeme = @"
MUDANZA DE LA AGENDA AL SERVIDOR - preparado el $(Get-Date -Format 'dd/MM/yyyy HH:mm')
CONFIDENCIAL: contiene las claves del sistema y datos de pacientes. Pasarlo por Escritorio remoto
(copiar y pegar) y borrarlo de donde se haya dejado de paso.

Respuestas para "Instalar o actualizar.bat" (carpeta Release):
  - .env de la instalacion anterior ......... <esta carpeta>\api.env
  - Respaldo de la base a cargar (.dump) ..... <esta carpeta>\$(Split-Path $dump -Leaf)   ($nDump MB)
  - Carpeta de archivos subidos (uploads) .... <esta carpeta>\uploads   ($nUp archivos)
  - Carpeta con el certificado de Limablue ... <esta carpeta>\Certificado
  - "Instalacion de PRUEBA?" ................... S mientras la PC anterior siga atendiendo (no envia correos).
  - En cada PC de las sedes, una vez: instalar Certificado\limablue-ca.crt como raiz de confianza.

DIA DEL CORTE: con una carpeta Mudanza NUEVA (respaldo de ese momento) al lado de Release,
correr "Cargar datos del corte.bat" en el servidor.

Al terminar la instalacion, borrar esta carpeta del servidor (los datos ya quedaron cargados).
"@
[IO.File]::WriteAllText((Join-Path $MUD 'LEEME - MUDANZA.txt'), $leeme.Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding $true))
Write-Host "Mudanza lista en $MUD  (respaldo $nDump MB, $nUp archivos)" -ForegroundColor Green

# 3. Un solo archivo: AgendaLB.zip (Release + Mudanza)
if (-not $SinZip) {
  $zip = Join-Path (Split-Path $BASE -Parent) 'AgendaLB.zip'
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Write-Host 'Comprimiendo AgendaLB.zip (unos minutos)...'
  Push-Location $BASE
  try { & tar.exe -a -c -f $zip 'Release' 'Mudanza'; if ($LASTEXITCODE -ne 0) { throw 'tar fallo al comprimir.' } } finally { Pop-Location }
  Write-Host ("Listo: {0}  ({1:N0} MB)" -f $zip, ((Get-Item $zip).Length / 1MB)) -ForegroundColor Green
}
