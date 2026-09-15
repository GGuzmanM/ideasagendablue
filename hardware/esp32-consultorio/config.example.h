// Configuración del aparato del consultorio.
// Copia este archivo como config.h (config.h NO va a git: lleva la clave del aparato).
// El bloque con la clave y el consultorio lo da la Agenda: Administración › Aparatos › Registrar.

#define WIFI_SSID          "<red WiFi de la sede>"
#define WIFI_CLAVE         "<clave de la red WiFi>"

// Dirección con la que el aparato llega al servidor DESDE LA RED DE LA SEDE (sin "/" al final).
//   Red privada o VPN:  "http://192.168.1.10:3002/api/v1"
//   Dominio con HTTPS:  "https://agenda.limablue.pe/api/v1"   (ver CERT_RAIZ más abajo)
#define API_BASE           "http://192.168.1.10:3002/api/v1"

// Clave del aparato (se muestra UNA vez al registrarlo o regenerarla).
#define CLAVE_APARATO      "lbd_xxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

// Número del consultorio (el mismo con el que se registró en la Agenda).
#define NUMERO_CONSULTORIO 1

// ─── Opcional ───────────────────────────────────────────────────────────────────
// Pines de los botones (a GND, con la resistencia pull-up interna) y dirección I2C del LCD.
// #define PIN_INICIO    25
// #define PIN_FIN       26
// #define LCD_DIRECCION 0x27   // algunos módulos usan 0x3F

// HTTPS: pega el certificado RAÍZ de la entidad que firmó el del servidor (formato PEM).
// #define CERT_RAIZ \
//   "-----BEGIN CERTIFICATE-----\n" \
//   "...\n" \
//   "-----END CERTIFICATE-----\n"
//
// Solo si no hay certificado y la red es de confianza: cifra pero NO verifica al servidor.
// #define PERMITIR_HTTPS_SIN_VERIFICAR
