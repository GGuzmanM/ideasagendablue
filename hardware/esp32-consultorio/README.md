# Aparato del consultorio (ESP32 · botones INICIO / FIN)

Mide cuánto dura de verdad cada tratamiento. En cada consultorio hay un aparato con WiFi, una
pantalla de 16x2 y dos botones:

- **INICIO**: la podóloga lo presiona al empezar. La cita de ese consultorio pasa a
  **En atención** con la hora exacta del botón y la pantalla muestra el cronómetro.
- **FIN**: al terminar. La cita pasa a **Completada** y el tiempo queda guardado.

**Sin cita lista, el botón no inicia nada.** Recepción primero marca **Llegó** y le asigna el
consultorio en el detalle de la cita; en reposo, el aparato pregunta cada 15 segundos quién sigue y lo
muestra antes de presionar (`SIGUE: ROSA M. / PULSE INICIO`, o `FALTA "LLEGO"` si recepción aún no la
marcó). Si no hay cita lista, INICIO solo muestra por qué no arrancó (`SIN CITA ASIGN.` o
`MARCAR "LLEGO"`) y no se guarda ningún tiempo. Sin red, los botones no se pierden: se guardan en el
aparato y se envían al volver la red, con la hora real del botón.

## Materiales

| Pieza | Nota |
|---|---|
| ESP32 DevKit (WROOM-32) | cualquier placa ESP32 con WiFi |
| LCD 16x2 con módulo I2C (PCF8574) | dirección 0x27 (algunos 0x3F) |
| 2 pulsadores | INICIO (verde) y FIN (rojo) |
| Fuente 5 V USB | |

## Cableado

| ESP32 | Va a |
|---|---|
| GPIO 25 | botón INICIO → el otro borne a GND |
| GPIO 26 | botón FIN → el otro borne a GND |
| GPIO 21 (SDA) | SDA del LCD |
| GPIO 22 (SCL) | SCL del LCD |
| 5V (VIN) | VCC del LCD |
| GND | GND del LCD |

Los botones usan la resistencia pull-up interna del ESP32: no hace falta poner resistencias.
Los pines se cambian en `config.h` (`PIN_INICIO`, `PIN_FIN`).

## Programa

1. Instala **Arduino IDE 2** y, en *Preferencias › Gestor de URLs adicionales*, agrega
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`. Luego, en el
   *Gestor de placas*, instala **esp32** (Espressif).
2. En el *Gestor de librerías* instala **LiquidCrystal I2C** (Frank de Brabander) y
   **ArduinoJson** 7 (Benoit Blanchon).
3. En la Agenda: **Administración › Aparatos › Registrar aparato** (sede, unidad y consultorio).
   Se muestra la clave del aparato **una sola vez** y un bloque de configuración para copiar.
4. En esta carpeta, copia `config.example.h` como `config.h` y pega ese bloque. Completa la red WiFi
   de la sede y ajusta `API_BASE` (ver abajo). `config.h` no va a git.
5. Abre `esp32-consultorio.ino`, elige la placa *ESP32 Dev Module* y el puerto, y súbelo.
6. Abre el *Monitor serie* a 115200 baudios para ver el registro (WiFi, eventos, códigos HTTP).

## Cómo llega al servidor (`API_BASE`)

Se decide al instalar cada sede:

- **Red privada o VPN hasta el servidor**: `http://<ip-del-servidor>:3002/api/v1`. Simple; el tráfico
  va por la red interna.
- **Dominio con HTTPS**: `https://<dominio>/api/v1`. Pega en `CERT_RAIZ` el certificado raíz (PEM)
  de quien firmó el certificado del servidor. `PERMITIR_HTTPS_SIN_VERIFICAR` cifra pero no verifica
  al servidor: úsalo solo en una red de confianza y mientras se consigue el certificado.

La clave del aparato viaja en cada petición: con HTTP, que sea solo en una red privada.

## Qué muestra la pantalla

| Pantalla | Significa |
|---|---|
| `CONSULTORIO 03` / `DISPONIBLE` | en reposo, sin cita asignada a este consultorio |
| `SIGUE: ROSA M.` / `PULSE INICIO` | la cita ya está lista (Llegó + este consultorio): INICIO la tomará |
| `SIGUE: ROSA M.` / `FALTA "LLEGO"` | hay cita para este consultorio, pero recepción aún no marcó «Llegó» |
| `SIGUE: ROSA M.` / `TRAT.2 > INICIO` | bloque combinado: terminó el 1º, sigue el 2º tratamiento |
| `INICIO` / `BUSCANDO CITA...` | se presionó INICIO; el cronómetro arranca solo si el servidor confirma la cita |
| `INICIADO` / `ROSA M. 10:30` | encontró la cita (paciente y hora) y la puso En atención |
| `TRAT.1 INICIADO` | bloque combinado: 1º tratamiento (luego `INICIO=TRAT.2`) |
| nombre / `00:12:34` | tratamiento en curso con su cronómetro |
| `SIN CITA ASIGN.` / `NO SE INICIO` | no hay cita con ese consultorio hoy: no se inició nada |
| `CITA SIN LLEGADA` / `MARCAR "LLEGO"` | hay cita con ese consultorio, pero recepción aún no marcó «Llegó»: no se inició nada |
| `YA EN CURSO` / `DESDE 10:32` | se presionó INICIO dos veces |
| `FIN 00:42:10` / `GUARDADO` | terminado y guardado; la cita quedó Completada |
| `ANULADO` / `MUY CORTO <1MIN` | FIN antes de 1 minuto: no cuenta (la cita no cambia) |
| `SIN INICIO` / `PULSE INICIO` | FIN sin un INICIO previo |
| `INICIO` / `SIN RED: EN COLA` | INICIO sin WiFi: se decide (y arranca el cronómetro) al volver la red |
| `SIN RED (2)` | sin WiFi: 2 botones guardados, se enviarán solos |
| `CLAVE INVALIDA` / `AVISAR SISTEMAS` | la clave fue revocada o está mal copiada |
| `FALTA CERT HTTPS` | `API_BASE` es https y falta `CERT_RAIZ` |

## Reglas que aplica el servidor

- La cita se busca **por el consultorio** que recepción marca en el detalle de la cita (en un bloque
  combinado basta con marcarlo en una; se copia a la otra), y debe estar en «Llegó» o «En atención».
  Si no hay una así, **no se inicia nada**: ni tiempo ni cambio de estado (el botón queda solo en la
  bitácora del aparato).
- Hora del botón: se usa el tiempo transcurrido desde que se presionó (`edadMs`), que no depende del
  reloj del aparato; si falta, su hora NTP; si tampoco, la del servidor (marcada «aproximada»).
- FIN antes de **1 minuto** anula el tiempo. Sin FIN en **3 horas**, el tiempo se cierra como
  «sin fin» y la cita se completa por tiempo.
- Un mismo botón reenviado (reintento, cola sin red) no se duplica: cada uno lleva un `idEvento` único.

## Probar sin la placa

Desde `apps/api`, con la clave de un aparato registrado en un entorno de **pruebas**:

```bash
npx ts-node --transpile-only scripts/simular-dispositivo.ts inicio --api http://localhost:3002 --token lbd_xxx.yyy
npx ts-node --transpile-only scripts/simular-dispositivo.ts fin --api http://localhost:3002 --token lbd_xxx.yyy
npx ts-node --transpile-only scripts/simular-dispositivo.ts latido --api http://localhost:3002 --token lbd_xxx.yyy
```

`--edad-ms 600000` simula un botón presionado hace 10 minutos (cola sin red); `--repetir` reenvía el
mismo evento para comprobar que no se duplica.
