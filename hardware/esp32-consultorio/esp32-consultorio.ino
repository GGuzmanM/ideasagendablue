/*
 * Aparato del consultorio — Limablue Agenda
 * ------------------------------------------------------------------------------
 * ESP32 con WiFi + pantalla LCD 16x2 (I2C) + dos botones: INICIO y FIN.
 *
 * La podóloga presiona INICIO al empezar el tratamiento y FIN al terminar. El aparato avisa al
 * servidor (POST /api/v1/dispositivo/eventos) y el servidor:
 *   - busca la cita de HOY de este consultorio y la pone «En atención» (INICIO) o «Completada» (FIN)
 *     con la hora exacta del botón;
 *   - si no hay cita (recepción no marcó «Llegó» y el consultorio), NO inicia nada y la pantalla
 *     dice por qué: el cronómetro solo arranca cuando el servidor confirma la cita;
 *   - devuelve las dos líneas que se muestran en la pantalla.
 *
 * Sin red, los botones NO se pierden: se guardan en la memoria del aparato (sobreviven a un
 * apagón) y se envían al volver la red, con los milisegundos transcurridos (`edadMs`) para que el
 * servidor calcule la hora real del botón. Late (POST /dispositivo/latido) cada 15 s en reposo y
 * cada minuto con un tratamiento en curso: el sistema lo ve «en línea», la pantalla muestra quién
 * sigue («SIGUE: ROSA M. / PULSE INICIO», o «FALTA "LLEGO"») y, si el aparato se reinició a mitad
 * de un tratamiento, retoma el cronómetro desde el servidor.
 *
 * Configuración: copiar config.example.h como config.h y completar (ver README.md).
 * Librerías: LiquidCrystal_I2C (Frank de Brabander) y ArduinoJson 7 (Benoit Blanchon).
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include "config.h"

#ifndef PIN_INICIO
#define PIN_INICIO 25
#endif
#ifndef PIN_FIN
#define PIN_FIN 26
#endif
#ifndef LCD_DIRECCION
#define LCD_DIRECCION 0x27
#endif

#define FW_VERSION      "1.0.0"
#define MAX_COLA        20          // botones guardados sin red (cada tratamiento usa 2)
#define LATIDO_REPOSO_MS 15000UL    // en reposo: cada 15 s pregunta quién sigue (SIGUE: ROSA M.)
#define LATIDO_CURSO_MS  60000UL    // con un tratamiento en curso: cada minuto
#define VIGENCIA_SIGUE_MS 45000UL   // sin latido reciente, no se muestra un «SIGUE» viejo
#define MENSAJE_MS      4000UL      // cuánto se ve el resultado de un botón (como el boceto: 4 s)
#define ANTIRREBOTE_MS  50UL
#define EDAD_MAX_MS     86400000UL  // el servidor acepta hasta 24 h de cola
#define ACCION_INICIO   1
#define ACCION_FIN      2

LiquidCrystal_I2C lcd(LCD_DIRECCION, 16, 2);
Preferences prefs;

// ─── Cola de botones (persistida en NVS) ──────────────────────────────────────
struct Evento {
  char id[24];            // "<arranque>-<secuencia>": único por aparato; un reenvío no duplica
  uint8_t accion;         // ACCION_INICIO | ACCION_FIN
  uint32_t arranque;      // en qué encendido se presionó (edadMs solo vale en el mismo encendido)
  uint32_t millisBoton;   // millis() al presionar
  int64_t epochMs;        // hora NTP al presionar (0 si el reloj aún no estaba sincronizado)
};
Evento cola[MAX_COLA];
uint8_t nCola = 0;
uint32_t arranque = 0;
uint32_t secuencia = 0;

// ─── Estado de la pantalla ────────────────────────────────────────────────────
enum Estado { REPOSO, EN_CURSO };
Estado estado = REPOSO;
unsigned long inicioMillis = 0;     // cronómetro local del tratamiento en curso
String nombreCurso = "";            // línea superior mientras corre (paciente o "SIN CITA")
String msg1, msg2;
unsigned long mensajeHasta = 0;
String reposo1, reposo2;            // pantalla de reposo que manda el servidor (quién sigue)
unsigned long reposoHasta = 0;
bool claveInvalida = false;
String lcdCache[2];

unsigned long proximoLatido = 0;
unsigned long proximoEnvio = 0;
unsigned long esperaReintento = 0;
unsigned long ultimoIntentoWifi = 0;

// ─── Pantalla (funciones del boceto del cliente) ──────────────────────────────
String dos(int n) { return n < 10 ? "0" + String(n) : String(n); }
String hms(unsigned long s) { return dos(s / 3600) + ":" + dos((s % 3600) / 60) + ":" + dos(s % 60); }

void escribirLinea(uint8_t fila, const String& texto) {
  String t = texto.substring(0, 16);
  while (t.length() < 16) t += ' ';
  if (lcdCache[fila] == t) return;  // sin parpadeo: solo se reescribe si cambió
  lcdCache[fila] = t;
  lcd.setCursor(0, fila);
  lcd.print(t);
}

void mostrarDisponible() {
  escribirLinea(0, "CONSULTORIO " + dos(NUMERO_CONSULTORIO));
  escribirLinea(1, "DISPONIBLE");
}

void imprimirTiempoLCD(int horas, int minutos, int segundos) {
  escribirLinea(1, dos(horas) + ":" + dos(minutos) + ":" + dos(segundos));
}

void imprimirTiempoSerial(int horas, int minutos, int segundos) {
  Serial.println(dos(horas) + ":" + dos(minutos) + ":" + dos(segundos));
}

void mensaje(const String& l1, const String& l2, unsigned long ms) {
  msg1 = l1; msg2 = l2; mensajeHasta = millis() + ms;
}

// ─── Reloj ────────────────────────────────────────────────────────────────────
bool relojListo() { return time(nullptr) > 1700000000; }  // NTP ya sincronizó

int64_t ahoraEpochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

// ─── Cola ─────────────────────────────────────────────────────────────────────
void guardarCola() {
  prefs.putUChar("ncola", nCola);
  if (nCola) prefs.putBytes("cola", cola, sizeof(Evento) * nCola);
}

void cargarCola() {
  nCola = prefs.getUChar("ncola", 0);
  if (nCola > MAX_COLA) nCola = 0;
  if (nCola) prefs.getBytes("cola", cola, sizeof(Evento) * nCola);
}

void quitarPrimero() {
  if (!nCola) return;
  memmove(cola, cola + 1, sizeof(Evento) * (nCola - 1));
  nCola--;
  guardarCola();
}

void encolar(uint8_t accion) {
  if (nCola == MAX_COLA) {  // cola llena (días sin red): se pierde el más antiguo
    Serial.println("Cola llena: se descarta el boton mas antiguo");
    memmove(cola, cola + 1, sizeof(Evento) * (MAX_COLA - 1));
    nCola--;
  }
  Evento& e = cola[nCola++];
  snprintf(e.id, sizeof(e.id), "%lu-%lu", (unsigned long)arranque, (unsigned long)++secuencia);
  e.accion = accion;
  e.arranque = arranque;
  e.millisBoton = millis();
  e.epochMs = relojListo() ? ahoraEpochMs() : 0;
  guardarCola();
  proximoEnvio = 0;  // intentar enviar ya
}

String cuerpoEvento(const Evento& e) {
  JsonDocument doc;
  doc["idEvento"] = e.id;
  doc["accion"] = e.accion == ACCION_INICIO ? "inicio" : "fin";
  uint32_t edad = millis() - e.millisBoton;
  if (e.arranque == arranque && edad <= EDAD_MAX_MS) doc["edadMs"] = edad;  // la fuente más confiable
  if (e.epochMs > 0) {
    time_t s = (time_t)(e.epochMs / 1000);
    struct tm t;
    gmtime_r(&s, &t);
    char iso[32];
    strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%SZ", &t);
    doc["presionadoEn"] = iso;
    doc["ntp"] = true;
  }
  doc["fw"] = FW_VERSION;
  String cuerpo;
  serializeJson(doc, cuerpo);
  return cuerpo;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
// Devuelve el código HTTP, -1 si no hubo conexión o -100 si es HTTPS sin certificado configurado.
int postJson(const char* ruta, const String& cuerpo, String& respuesta) {
  String url = String(API_BASE) + ruta;
  bool https = url.startsWith("https://");
  WiFiClient plano;
  WiFiClientSecure seguro;
  if (https) {
#if defined(CERT_RAIZ)
    seguro.setCACert(CERT_RAIZ);
#elif defined(PERMITIR_HTTPS_SIN_VERIFICAR)
    seguro.setInsecure();  // solo en una red de confianza (ver README)
#else
    return -100;
#endif
  }
  HTTPClient http;
  if (!(https ? http.begin(seguro, url) : http.begin(plano, url))) return -1;
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Dispositivo ") + CLAVE_APARATO);
  int codigo = http.POST(cuerpo);
  respuesta = codigo > 0 ? http.getString() : "";
  http.end();
  return codigo;
}

void reintentarLuego() {
  esperaReintento = esperaReintento ? min(esperaReintento * 2, 60000UL) : 5000UL;
  proximoEnvio = millis() + esperaReintento;
}

void procesarRespuesta(const String& json, const Evento& enviado) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return;
  String resultado = doc["resultado"] | "";
  String l1 = doc["lcd"][0] | "";
  String l2 = doc["lcd"][1] | "";
  reposoHasta = 0;  // el «SIGUE» cambió: se refresca con el próximo latido
  if (resultado == "iniciado") {
    // Recién aquí arranca el cronómetro, contado desde el botón (no desde la respuesta).
    estado = EN_CURSO;
    inicioMillis = enviado.arranque == arranque ? enviado.millisBoton : millis();
    nombreCurso = l2;  // paciente y hora
  } else if (resultado == "ya_en_curso") {
    estado = EN_CURSO;
  } else if (nCola == 0) {  // sin_cita, sin_llegada, finalizado, anulado, sin_inicio: nada en curso
    estado = REPOSO;
  }
  mensaje(l1, l2, MENSAJE_MS);
}

void atenderCola() {
  if (!nCola || WiFi.status() != WL_CONNECTED || millis() < proximoEnvio) return;
  String respuesta;
  Evento enviado = cola[0];
  int codigo = postJson("/dispositivo/eventos", cuerpoEvento(enviado), respuesta);
  Serial.printf("evento %s -> HTTP %d\n", enviado.id, codigo);
  if (codigo == 200) {
    quitarPrimero();
    esperaReintento = 0;
    claveInvalida = false;
    procesarRespuesta(respuesta, enviado);
    proximoLatido = millis() + 1500;  // sincroniza el cronómetro con el servidor
  } else if (codigo == 400 || codigo == 422) {
    Serial.println("evento rechazado por datos invalidos, se descarta: " + respuesta);
    quitarPrimero();
  } else if (codigo == 401) {
    claveInvalida = true;  // clave revocada o mal copiada: se conserva la cola
    reintentarLuego();
  } else if (codigo == -100) {
    mensaje("FALTA CERT HTTPS", "VER CONFIG.H", 10000);
    reintentarLuego();
  } else {
    reintentarLuego();  // sin red, 429 o error del servidor
  }
}

void latido() {
  if (WiFi.status() != WL_CONNECTED || millis() < proximoLatido) return;
  proximoLatido = millis() + (estado == EN_CURSO ? LATIDO_CURSO_MS : LATIDO_REPOSO_MS);
  JsonDocument req;
  req["fw"] = FW_VERSION;
  req["rssi"] = WiFi.RSSI();
  String cuerpo, respuesta;
  serializeJson(req, cuerpo);
  int codigo = postJson("/dispositivo/latido", cuerpo, respuesta);
  if (codigo == 401) { claveInvalida = true; return; }
  if (codigo != 200) return;
  claveInvalida = false;
  if (nCola) return;  // hay botones sin enviar: manda el estado local
  JsonDocument doc;
  if (deserializeJson(doc, respuesta)) return;
  JsonVariant enCurso = doc["enCurso"];
  if (!enCurso.isNull()) {
    // Retomar el cronómetro (reinicio a mitad del tratamiento) o corregir su deriva.
    uint32_t s = enCurso["transcurridoSegundos"] | 0;
    estado = EN_CURSO;
    inicioMillis = millis() - s * 1000UL;
    nombreCurso = String(doc["lcd"][1] | "EN CURSO");
  } else {
    estado = REPOSO;  // nada en curso (o se cerró solo a las 3 h)
    // Quién sigue: «SIGUE: ROSA M. / PULSE INICIO», «… / FALTA "LLEGO"» o «CONSULTORIO 03 / DISPONIBLE».
    reposo1 = String(doc["lcd"][0] | "");
    reposo2 = String(doc["lcd"][1] | "");
    reposoHasta = millis() + VIGENCIA_SIGUE_MS;
  }
}

// ─── Botones ──────────────────────────────────────────────────────────────────
struct Boton { uint8_t pin; uint8_t accion; bool ultimo; unsigned long cambio; bool estable; };
Boton botones[2] = { {PIN_INICIO, ACCION_INICIO, HIGH, 0, HIGH}, {PIN_FIN, ACCION_FIN, HIGH, 0, HIGH} };

void alPresionar(uint8_t accion) {
  bool conRed = WiFi.status() == WL_CONNECTED;
  if (accion == ACCION_INICIO) {
    // El cronómetro NO arranca aquí: solo si el servidor encuentra la cita del consultorio (sin cita
    // asignada el botón no inicia nada). Sin red el botón queda en cola y se decide al volver la red.
    if (estado == REPOSO) mensaje("INICIO", conRed ? "BUSCANDO CITA..." : "SIN RED: EN COLA", conRed ? 8000 : MENSAJE_MS);
    else mensaje("YA EN CURSO", "PULSE FIN", 1500);
  } else {
    if (estado == EN_CURSO) {
      mensaje("FIN " + hms((millis() - inicioMillis) / 1000), conRed ? "ENVIANDO..." : "GUARDADO SIN RED", MENSAJE_MS);
      estado = REPOSO;
    } else {
      mensaje("FIN", conRed ? "ENVIANDO..." : "GUARDADO SIN RED", 1500);
    }
  }
  encolar(accion);
}

void leerBotones() {
  for (Boton& b : botones) {
    bool lectura = digitalRead(b.pin);
    if (lectura != b.ultimo) { b.cambio = millis(); b.ultimo = lectura; }
    if (millis() - b.cambio > ANTIRREBOTE_MS && lectura != b.estable) {
      b.estable = lectura;
      if (b.estable == LOW) alPresionar(b.accion);  // pull-up: presionado = LOW
    }
  }
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────
void refrescarPantalla() {
  static unsigned long ultima = 0;
  static unsigned long ultimoSerial = 0;
  if (millis() - ultima < 200) return;
  ultima = millis();
  if (millis() < mensajeHasta) { escribirLinea(0, msg1); escribirLinea(1, msg2); return; }
  if (claveInvalida) { escribirLinea(0, "CLAVE INVALIDA"); escribirLinea(1, "AVISAR SISTEMAS"); return; }
  bool sinRed = WiFi.status() != WL_CONNECTED;
  if (estado == EN_CURSO) {
    unsigned long s = (millis() - inicioMillis) / 1000;
    escribirLinea(0, sinRed && nCola ? "SIN RED (" + String(nCola) + ")" : nombreCurso);
    imprimirTiempoLCD(s / 3600, (s % 3600) / 60, s % 60);
    if (millis() - ultimoSerial >= 10000) { ultimoSerial = millis(); imprimirTiempoSerial(s / 3600, (s % 3600) / 60, s % 60); }
  } else if (sinRed && nCola) {
    escribirLinea(0, "CONSULTORIO " + dos(NUMERO_CONSULTORIO));
    escribirLinea(1, "SIN RED (" + String(nCola) + ")");
  } else if (millis() < reposoHasta && reposo1.length()) {
    escribirLinea(0, reposo1);  // quién sigue, según el servidor
    escribirLinea(1, reposo2);
  } else {
    mostrarDisponible();
  }
}

void cuidarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - ultimoIntentoWifi < 30000) return;
  ultimoIntentoWifi = millis();
  Serial.println("WiFi desconectado, reintentando...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
}

// ─── Arranque y bucle ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_INICIO, INPUT_PULLUP);
  pinMode(PIN_FIN, INPUT_PULLUP);
  Wire.begin();
  lcd.init();
  lcd.backlight();
  escribirLinea(0, "LIMABLUE");
  escribirLinea(1, "INICIANDO...");

  prefs.begin("aparato", false);
  arranque = prefs.getUInt("arranque", 0) + 1;  // cada encendido cuenta (ids de evento únicos)
  prefs.putUInt("arranque", arranque);
  cargarCola();
  Serial.printf("Aparato consultorio %d · fw %s · arranque %lu · %d boton(es) pendientes\n",
                NUMERO_CONSULTORIO, FW_VERSION, (unsigned long)arranque, nCola);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
  configTime(-5 * 3600, 0, "pool.ntp.org", "time.google.com");  // Lima, UTC-5 (sin horario de verano)

  delay(4000);  // pantalla de bienvenida (como el boceto)
  mostrarDisponible();
  proximoLatido = 0;  // late apenas haya red: retoma un tratamiento en curso tras un reinicio
}

void loop() {
  leerBotones();
  atenderCola();
  latido();
  refrescarPantalla();
  cuidarWifi();
  delay(5);
}
