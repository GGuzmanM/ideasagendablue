# Certificado HTTPS para el SERVIDOR nuevo, firmado por la autoridad local de Limablue (12-oct-2026).
# Se corre en ESTA PC (donde está la clave de la autoridad), nunca en el servidor:
#   powershell -ExecutionPolicy Bypass -File tools\servidor\crear-certificado-servidor.ps1 -IP 192.168.0.20 -Nombre SRV-AGENDA
# Deja en  Documentacion Agenda\Certificado HTTPS\Servidor <IP>\  la carpeta que se lleva al servidor:
#   servidor.crt + servidor.key  → el instalador los pide («carpeta del certificado de Limablue»)
#   limablue-ca.crt              → se instala UNA vez en cada PC (si ya está instalada, no hace falta)
param(
  [Parameter(Mandatory)][string]$IP,
  [string]$Nombre,
  [int]$Dias = 730
)
$ErrorActionPreference = 'Stop'
$CA_DIR = 'C:\Users\User\Documents\Documentacion Agenda\Certificado HTTPS'
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) { $openssl = 'C:\Program Files\Git\mingw64\bin\openssl.exe' }
if (-not (Test-Path $openssl)) { throw 'No se encuentra openssl (viene con Git para Windows).' }
foreach ($f in 'limablue-ca.crt', 'limablue-ca.key') { if (-not (Test-Path (Join-Path $CA_DIR $f))) { throw "Falta $f en $CA_DIR" } }
if ($IP -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "IP no válida: $IP" }

$salida = Join-Path $CA_DIR "Servidor $IP"
New-Item -ItemType Directory -Force -Path $salida | Out-Null
$dns = @('localhost', 'agenda.limablue.local') + $(if ($Nombre) { @($Nombre, $Nombre.ToLower()) } else { @() }) | Select-Object -Unique
$alt = @("IP.1 = $IP", 'IP.2 = 127.0.0.1') + (0..($dns.Count - 1) | ForEach-Object { "DNS.$($_ + 1) = $($dns[$_])" })
$cnf = @"
[req]
distinguished_name = dn
req_extensions = v3_req
prompt = no
[dn]
CN = agenda.limablue.local
O = LimaBlue Centro de Podologia Medica
C = PE
[v3_req]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
$($alt -join "`n")
"@
$cnfPath = Join-Path $salida 'openssl-servidor.cnf'
[IO.File]::WriteAllText($cnfPath, $cnf.Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))

# openssl escribe avisos normales por stderr: en PowerShell 5.1 eso no debe cortar el script; manda el código de salida.
function Ssl {
  $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = & $openssl @args 2>&1; $codigo = $LASTEXITCODE
  $ErrorActionPreference = $previo
  if ($codigo -ne 0) { throw "openssl $($args[0]) fallo: $($out -join ' ')" }
  return $out
}
Push-Location $salida
try {
  Ssl genrsa -out servidor.key 2048 | Out-Null
  Ssl req -new -key servidor.key -out servidor.csr -config $cnfPath | Out-Null
  Ssl x509 -req -in servidor.csr -CA (Join-Path $CA_DIR 'limablue-ca.crt') -CAkey (Join-Path $CA_DIR 'limablue-ca.key') `
    -CAserial (Join-Path $CA_DIR 'limablue-ca.srl') -out servidor.crt -days $Dias -sha256 -extensions v3_req -extfile $cnfPath | Out-Null
  Remove-Item servidor.csr -Force
  Copy-Item (Join-Path $CA_DIR 'limablue-ca.crt') . -Force
  Write-Host (Ssl verify -CAfile limablue-ca.crt servidor.crt)
} finally { Pop-Location }
Write-Host ''
Write-Host "Listo: $salida" -ForegroundColor Green
Ssl x509 -in (Join-Path $salida 'servidor.crt') -noout -subject -enddate -ext subjectAltName
