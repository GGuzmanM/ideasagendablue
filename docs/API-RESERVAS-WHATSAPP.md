# APIs de reservas (WhatsApp y web) — Limablue Agenda

Permite que el chat de WhatsApp de Limablue **consulte horarios y registre la cita de un paciente** conversando con él,
sin pasarela de pago: **la cita se crea al confirmar y el paciente paga en la sede**. También permite **cancelar o reprogramar**
citas, con la misma llave: una reserva hecha por el chat por su código (§3.6 y §3.7), o **cualquier cita próxima del paciente**
buscándola por su documento (§3.8), también las que registró la clínica.

> **Desde el 12-nov-2026 son DOS APIs**, iguales en rutas, campos y respuestas, cada una con **su dirección y su propia llave**:
>
> | API | Dirección base | Permiso de la llave | Canal con que quedan las citas |
> |---|---|---|---|
> | **WhatsApp** (chat) | `https://limablueagenda.com/api/v1/integraciones/whatsapp` | `reservas:whatsapp` | WhatsApp |
> | **Web** | `https://limablueagenda.com/api/v1/integraciones/reservas` | `reservas:write` (la llave que ya existía) | Web |
>
> Una llave solo sirve en su dirección (en la otra responde `403`). Por **código LB** cada API solo ve, cancela y reprograma las
> reservas hechas por ella; las rutas por **documento** (§3.8) muestran todas las citas próximas del paciente en las dos.
> El canal lo pone la llave: ya no se manda el campo `canal` (si llega, se ignora).
> Los ejemplos usan la de WhatsApp; para la web, cambien `/integraciones/whatsapp` por `/integraciones/reservas`.

- Servidor a servidor (no se llama desde un navegador).
- Misma disponibilidad real que la Agenda: no hay doble reserva, respeta horarios, almuerzos, permisos y días especiales.
- Solo se ofrecen los servicios que la clínica marcó como «reserva en línea» en Administración › Reserva web (los mismos de la página `/agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva`).
- Cada reserva entra a la Agenda con el **canal de su API** («WhatsApp» o «Web»), pago **pendiente** y un comentario con el código de reserva.

## 1. Conexión y llave

| | |
|---|---|
| Dirección base | WhatsApp: `https://limablueagenda.com/api/v1/integraciones/whatsapp` · Web: `https://limablueagenda.com/api/v1/integraciones/reservas` (en los ejemplos: `https://<servidor>/...`) |
| Autenticación | Cabecera `Authorization: ApiKey <llave>` |
| Formato | JSON (`Content-Type: application/json`), UTF-8 |
| Horario | Todas las fechas y horas son de **Lima** (`AAAA-MM-DD`, `HH:MM` en 24 h) |

La **llave** la genera Sistemas en el servidor con **«Llaves API (web y WhatsApp).bat»** (opción 1 WhatsApp, 2 web). Se muestra **una sola vez** (en la base solo queda
su huella). Si se pierde o se filtra, se crea otra y la anterior **de ese tipo** deja de funcionar al instante (la de la otra API no se toca).
Cada llave solo sirve para su API (permiso `reservas:whatsapp` o `reservas:write`): no abre la Agenda ni ve datos de pacientes. **Guárdenla como un secreto**: no en el código del bot,
no en chats ni correos abiertos; usen una variable de entorno o un gestor de secretos.

> Los paths de la API (`/api/...`) **no** llevan el prefijo `/acceso_agenda_lb` de las pantallas.

## 2. Flujo recomendado para la conversación

1. `GET /catalogo` → sedes y servicios (con variantes y precios). Se puede guardar en caché unos minutos.
2. Preguntar al paciente **sede y servicio** (y la variante, si el servicio tiene varias).
3. `GET /dias` → días con horarios libres; `GET /horas` → horas de un día. Ofrecer solo lo que devuelven.
4. Pedir los datos: **tipo de documento (DNI o CE) y número, nombres, apellido paterno, (apellido materno), celular** y, si lo tiene,
   **correo**. El celular puede ser el del propio WhatsApp.
5. **Pedir el consentimiento** de tratamiento de datos personales y mandar `aceptaDatos: true`.
6. `POST /` con todo → responde el **código de reserva** y la cita queda creada. Confirmar al paciente: sede, dirección, día, hora,
   precio a pagar en esa sede (`precios[sedeId]`), código, y «llega 10 minutos antes con tu documento».

Si entre el paso 3 y el 6 alguien toma esa hora, el `POST /` responde **409** (`HORA_NO_DISPONIBLE`): vuelvan a consultar `/horas` y ofrezcan otra.

**Cuando el paciente quiere cancelar o cambiar una cita:**
1. Verificar a la persona (ver §7) y pedir su documento.
2. `POST /pacientes/citas` → sus citas próximas. Si tiene varias, preguntarle cuál (fecha, hora, sede, servicio).
3. Cancelar: `POST /citas/<numeroCita>/cancelar`. Reprogramar: `GET /dias` y `GET /horas` con el `sedeId` y `servicioId` de esa cita,
   ofrecer las horas y `POST /citas/<numeroCita>/reprogramar` con la elegida.
4. Confirmar al paciente con lo que responde la llamada (nuevo día y hora, o «cancelada»).

## 3. Endpoints

| Método y ruta | Para qué | § |
|---|---|---|
| `GET /catalogo` | Sedes y servicios reservables, con precios por sede | 3.1 |
| `GET /dias?sedeId&servicioId&desde&hasta` | Días con horarios libres | 3.2 |
| `GET /horas?sedeId&servicioId&fecha` | Horas libres de un día y cupos por hora | 3.3 |
| `POST /` | Registrar la reserva (crea la cita) | 3.4 |
| `GET /:codigo` | Estado de una reserva del chat (`LB-…`) | 3.5 |
| `POST /:codigo/cancelar` | Cancelar la cita de una reserva del chat | 3.6 |
| `POST /:codigo/reprogramar` | Reprogramar la cita de una reserva del chat | 3.7 |
| `POST /pacientes/citas` | Citas próximas de un paciente por su documento (todas) | 3.8 |
| `POST /citas/:numeroCita/cancelar` | Cancelar una cita por su N.º (`C-…`) | 3.8 |
| `POST /citas/:numeroCita/reprogramar` | Reprogramar una cita por su N.º (`C-…`) | 3.8 |

### 3.1 `GET /catalogo`
Sedes y servicios reservables.

```bash
curl -H "Authorization: ApiKey $LLAVE" https://<servidor>/api/v1/integraciones/whatsapp/catalogo
```
```json
{
  "sedes": [
    { "id": "a1b2…", "nombre": "Los Olivos", "direccion": "Av. …", "horario": "Lun–Sáb 8:00–20:00" }
  ],
  "servicios": [
    {
      "id": "c3d4…", "nombre": "Evaluación PO", "duracionMinutos": 30, "unidad": "Podología",
      "sedes": ["a1b2…"],
      "variantes": [ { "id": null, "nombre": "Evaluación PO", "precio": 50, "precios": { "a1b2…": 50, "e5f6…": 60 } } ]
    }
  ],
  "reglas": { "diasMaximos": 30, "anticipacionMinutosHoy": 120 }
}
```
- `servicios[].sedes`: ids de las sedes donde se ofrece ese servicio.
- `variantes`: si el servicio tiene tipos (p. ej. «Limpieza clínica · Regular»), cada uno trae su `id` y `precio`; si no, hay una sola con `id: null`.
- `precios` (en soles) es el precio que se **paga en cada sede** (clave: id de la sede). **Cada sede puede cobrar distinto**: al confirmar al paciente, mostrar `precios[<id de la sede elegida>]`. Un tipo que no aparece en `precios` para una sede no se ofrece allí.
- `precio` es el precio web **general** (el de las sedes que no tienen precio propio); úsenlo solo como referencia. Se configura en Administración › Reserva web (si no hay uno, rige el precio de la clínica). Un servicio sin precio no aparece.
- `reglas.diasMaximos`: hasta cuántos días adelante se puede reservar. `anticipacionMinutosHoy`: para el mismo día, mínimo de minutos de anticipación.

### 3.2 `GET /dias?sedeId=&servicioId=&desde=&hasta=`
Días con horarios libres (máximo 31 días por consulta).
```json
{ "dias": [ { "fecha": "2026-11-02", "horas": 18 }, { "fecha": "2026-11-03", "horas": 12 } ] }
```
Los días que no aparecen no tienen horarios libres.

### 3.3 `GET /horas?sedeId=&servicioId=&fecha=`
```json
{ "fecha": "2026-11-02", "horas": ["09:00", "09:30", "10:00"], "cupos": { "09:00": 2, "09:30": 1, "10:00": 3 } }
```
`cupos` (13-nov-2026) = cuántos pacientes caben **a la vez** en cada hora (especialistas libres). No ofrezcan la misma hora a más
pacientes que sus cupos: el que llegue después recibirá `409 HORA_NO_DISPONIBLE`.

### 3.4 `POST /` — registrar la reserva (crea la cita)

```bash
curl -X POST https://<servidor>/api/v1/integraciones/whatsapp \
  -H "Authorization: ApiKey $LLAVE" -H "Content-Type: application/json" \
  -d '{
    "tipoDocumento": "CE",
    "numeroDocumento": "001234567",
    "nombres": "Ana María",
    "apellidoPaterno": "Quispe",
    "apellidoMaterno": "Rojas",
    "telefono": "987654321",
    "email": "ana@correo.pe",
    "sedeId": "a1b2…",
    "servicioId": "c3d4…",
    "subcategoriaId": null,
    "fecha": "2026-11-02",
    "horaInicio": "09:00",
    "aceptaDatos": true,
    "referencia": "wa-51987654321-20261029-0001"
  }'
```

| Campo | Obligatorio | Detalle |
|---|---|---|
| `tipoDocumento` | no (por defecto `DNI`) | `DNI` o `CE` (carné de extranjería) |
| `numeroDocumento` | sí | DNI: 8 dígitos. CE: 8 a 12 letras o números. Se aceptan espacios y guiones (se limpian) |
| `nombres`, `apellidoPaterno` | sí | 2 caracteres o más |
| `apellidoMaterno` | no | |
| `telefono` | sí | Celular peruano. Acepta `987654321`, `+51 987 654 321`, `51987654321`. Se guarda a 9 dígitos y debe empezar con 9 |
| `email` | no | Si no lo tiene, omitirlo (o `""`) |
| `sedeId`, `servicioId` | sí | Ids del catálogo. El servicio debe ofrecerse en esa sede |
| `subcategoriaId` | solo si el servicio tiene variantes | `id` de la variante del catálogo; si el servicio tiene una sola, omitirlo o `null` |
| `fecha`, `horaInicio` | sí | Una hora que devolvió `/horas` |
| `aceptaDatos` | sí, `true` | El paciente aceptó el tratamiento de sus datos personales |
| `referencia` | recomendado | Identificador **único de esta petición** (6 a 100 caracteres; p. ej. id de la conversación + número de intento). Evita citas duplicadas si el chat **reintenta** (ver §4). También se acepta en la cabecera `Idempotency-Key` |

Respuesta **201** (o **200** si es un reintento ya procesado, con `"repetida": true`):
```json
{
  "codigo": "LB-567405",
  "numeroCita": "C-008323",
  "estado": "confirmada",
  "citaId": "9f8e…",
  "repetida": false,
  "fecha": "2026-11-02",
  "horaInicio": "09:00",
  "duracionMinutos": 30,
  "monto": 50,
  "moneda": "PEN",
  "sede": { "nombre": "Los Olivos", "direccion": "Av. …" },
  "servicio": "Evaluación PO",
  "variante": null
}
```
- **Dos códigos distintos:** `codigo` (`LB-…`) es el de la **reserva**: con él el chat consulta el estado (§3.5) y se evita
  duplicar en un reintento. `numeroCita` (`C-…`) es el N.º de la **cita en la Agenda**, el mismo que tienen las citas que
  registra recepción y el que sale en el correo; es el que conviene darle al paciente si llama a la sede.
- La **profesional** se asigna automáticamente (la que esté libre a esa hora). No se informa su nombre.
- Si el paciente ya existe (mismo tipo y número de documento), se usa su ficha **sin modificar sus datos**; si no, se registra uno nuevo.
- Si hay correo, el paciente recibe el correo de confirmación de la Agenda.
- **Sábado y domingo por WhatsApp:** la respuesta puede venir con `"estado": "esperando_pago"` y un enlace de pago: ver §3.9.

### 3.5 `GET /:codigo` — estado de una reserva hecha por el chat
```json
{
  "codigo": "LB-567405", "numeroCita": "C-008323", "estado": "confirmada", "citaVigente": true, "estadoCita": "agendada",
  "nombres": "Ana María", "fecha": "2026-11-02", "horaInicio": "09:00", "duracionMinutos": 30,
  "sedeId": "a1b2…", "servicioId": "c3d4…", "subcategoriaId": null,
  "sede": { "nombre": "Los Olivos", "direccion": "Av. …" }, "servicio": "Evaluación PO", "variante": null,
  "monto": 50, "moneda": "PEN", "pagado": false
}
```
`estado` es `confirmada` o `cancelada` (si se canceló la cita, por el chat o en la sede); con pago previo (§3.9) también
`esperando_pago`, `expirada` (no pagó a tiempo: la cita se canceló) o `reembolsar` (pagó cuando la cita ya no estaba vigente). `estadoCita` es el estado real en la Agenda
(`agendada`, `confirmada`, `llego`, `en_atencion`, `completada`, `no_show`, `cancelada`, `reprogramada`).
`fecha` y `horaInicio` son las **actuales de la cita**: si se reprogramó (por el chat o en la sede), aquí sale el horario nuevo.
`sedeId` y `servicioId` sirven para pedir horas al reprogramar (`GET /horas?sedeId=&servicioId=&fecha=`).

### 3.6 `POST /:codigo/cancelar` — cancelar la cita de la reserva
```bash
curl -X POST https://<servidor>/api/v1/integraciones/whatsapp/LB-567405/cancelar \
  -H "Authorization: ApiKey $LLAVE" -H "Content-Type: application/json" \
  -d '{ "motivo": "Viaje de trabajo" }'
```
| Campo | Obligatorio | Detalle |
|---|---|---|
| `motivo` | no | Hasta 300 caracteres. Queda en la cita como «Cancelada por el paciente vía whatsapp (reserva LB-…): <motivo>» |

Respuesta **200**: el mismo objeto de §3.5 (ya con `"estado": "cancelada"`) más `"sinCambios": false`. Si la reserva **ya estaba
cancelada**, responde 200 con `"sinCambios": true` (un reintento no es error). El horario queda libre al instante para otros pacientes.

### 3.7 `POST /:codigo/reprogramar` — mover la cita a otro día u hora
```bash
curl -X POST https://<servidor>/api/v1/integraciones/whatsapp/LB-567405/reprogramar \
  -H "Authorization: ApiKey $LLAVE" -H "Content-Type: application/json" \
  -d '{ "fecha": "2026-11-05", "horaInicio": "16:30" }'
```
| Campo | Obligatorio | Detalle |
|---|---|---|
| `fecha`, `horaInicio` | sí | Una hora que devolvió `GET /horas` con el `sedeId` y `servicioId` de la reserva (§3.5) |

Respuesta **200**: el objeto de §3.5 con la nueva `fecha` y `horaInicio`, más `"sinCambios": false` (`true` si ya estaba en ese horario).
- Es en la **misma sede y el mismo servicio** (y mismo precio). Para cambiar de sede o de servicio: cancelar y reservar de nuevo.
- La **profesional** la asigna la Agenda: se queda la misma si está libre a esa hora; si no, otra que lo esté.
- Si el paciente tiene correo, su recordatorio se reprograma a la nueva hora. En la Agenda la cita se mueve al instante y cuenta como reprogramación.
- Si entre `GET /horas` y esta llamada alguien toma esa hora, responde **409**: vuelvan a consultar `/horas` y ofrezcan otra.

**Qué decide el chat y qué decide la Agenda.** Las reglas de negocio (con cuánta anticipación se permite, cuántas veces, a quién)
las programa el chat. La API solo frena lo que no se puede hacer:
- la cita tiene que estar `agendada` o `confirmada` y su hora no puede haber pasado (si el paciente ya llegó o está en atención, no se toca);
- una reserva **pagada en línea** (`"pagado": true`) se puede reprogramar, pero **no cancelar** por aquí: la devolución del dinero la ve la sede;
- pago previo (§3.9, solo WhatsApp): con el pago **pendiente** no se reprograma (`PAGO_PENDIENTE`: primero paga) y una cita **sin pagar**
  no se pasa a sábado o domingo (`PAGO_PREVIO_REQUERIDO`: cancelar y reservar de nuevo ese día, con su pago);
- por código LB, solo reservas hechas con **la misma API** (la de WhatsApp no ve las de la web, ni al revés).

### 3.8 Citas del paciente por su documento (todas, también las de la clínica)
Para cuando el paciente pide «quiero cambiar / cancelar mi cita» sin tener el código `LB-…`, o la cita la registró recepción o el call center.
Las tres llamadas son `POST` (no `GET`) para que el documento **no viaje en la URL** ni quede en los registros de acceso.

**`POST /pacientes/citas`** — lista sus citas próximas
```bash
curl -X POST https://<servidor>/api/v1/integraciones/whatsapp/pacientes/citas \
  -H "Authorization: ApiKey $LLAVE" -H "Content-Type: application/json" \
  -d '{ "tipoDocumento": "DNI", "numeroDocumento": "12345678" }'
```
```json
{
  "citas": [
    {
      "numeroCita": "C-008323", "estado": "agendada", "fecha": "2026-11-12", "horaInicio": "09:00", "duracionMinutos": 30,
      "sedeId": "a1b2…", "sede": { "nombre": "Los Olivos", "direccion": "Av. …" },
      "servicioId": "c3d4…", "servicio": "Evaluación PO", "subcategoriaId": null, "variante": null,
      "codigoReserva": "LB-567405", "canalReserva": "whatsapp", "pagadoEnLinea": false, "enBloque": false
    }
  ]
}
```
- Salen las citas **futuras** en estado `agendada` o `confirmada` (de hoy, solo las que aún no llegan a su hora), de la más próxima a la más lejana (hasta 50).
- `codigoReserva` es el `LB-…` si la cita nació de una reserva web o del chat; `null` si la registró la clínica.
- Si el documento no existe o no tiene citas próximas, responde `{ "citas": [] }` (no se distingue un caso del otro).
- `tipoDocumento`: `DNI` (por defecto) o `CE`. El número se valida igual que al reservar (422 si está mal escrito).
- `enBloque: true`: la cita es parte de una visita de **dos servicios a la misma hora**; aparece una vez por servicio. Al cancelar
  se cancela la visita entera; reprogramarla por aquí responde `409 CITA_EN_BLOQUE` (eso lo hace la sede).

**`POST /citas/:numeroCita/cancelar`** y **`POST /citas/:numeroCita/reprogramar`**
```bash
curl -X POST https://<servidor>/api/v1/integraciones/whatsapp/citas/C-008323/reprogramar \
  -H "Authorization: ApiKey $LLAVE" -H "Content-Type: application/json" \
  -d '{ "numeroDocumento": "12345678", "fecha": "2026-11-05", "horaInicio": "16:30" }'
```
| Campo | Obligatorio | Detalle |
|---|---|---|
| `:numeroCita` (en la ruta) | sí | El `numeroCita` de la lista. Se acepta `C-008323`, `C8323` u `8323` |
| `tipoDocumento`, `numeroDocumento` | sí (`tipoDocumento` por defecto `DNI`) | El documento del paciente: **tiene que ser el dueño de la cita**; si no, `404 CITA_NO_ENCONTRADA` |
| `motivo` | no (solo cancelar) | Hasta 300 caracteres. Queda en la cita como «Cancelada por el paciente vía whatsapp: <motivo>» |
| `fecha`, `horaInicio` | sí (solo reprogramar) | Una hora de `GET /horas` con el `sedeId` y `servicioId` de la cita |

Respuesta **200**: la cita como sale en la lista (ya con su nuevo estado u horario) más `"sinCambios"` (`true` si ya estaba cancelada
o ya estaba en ese horario). Valen las mismas reglas y errores que en §3.6 y §3.7: solo `agendada`/`confirmada`, hora no pasada,
una cita pagada en línea no se cancela por aquí, y reprogramar es en la misma sede y servicio.

### 3.9 Pago previo de sábado y domingo (13-nov-2026) — solo la API de WhatsApp
Las citas de **sábado y domingo** que se reservan por `/integraciones/whatsapp` se pagan **antes**, por la tienda en línea de Limablue
(Niubiz). Lunes a viernes y la API web: sin cambios (se paga en la sede). Feriados: por ahora no piden pago. Si en el servidor no está
conectada la tienda, todo sigue como siempre (`confirmada`, se paga en la sede).

`POST /` de un sábado o domingo responde **201** con la cita **apartada** y el enlace de pago:
```json
{
  "codigo": "LB-123456", "numeroCita": "C-008340", "estado": "esperando_pago", "citaId": "…", "repetida": false,
  "fecha": "2026-11-14", "horaInicio": "10:00", "duracionMinutos": 30, "monto": 90, "moneda": "PEN",
  "sede": { "nombre": "Los Olivos", "direccion": "Av. …" }, "servicio": "Evaluación PO", "variante": null,
  "pago": { "url": "https://…/order-pay/…", "expiraEn": "2026-11-13T15:10:00.000Z", "minutos": 10, "monto": 90 }
}
```
- Envíen `pago.url` al paciente: tiene **10 minutos** (`pago.expiraEn`). Hasta que pague **no digan que la cita está confirmada**.
- Para saber si ya pagó: `GET /:codigo` (§3.5) trae `estado`, `pagoEstado` (`pendiente` | `pagado` | `rechazado` | `monto_distinto`)
  y, mientras se pueda pagar, el mismo `pago`. Al pagar pasa a `"estado": "confirmada"` y `"pagado": true` (segundos después del pago).
- Un pago **rechazado** (tarjeta sin fondos…) se puede reintentar con el mismo enlace dentro de los 10 minutos.
- Si **no paga** a tiempo, la cita se cancela sola, la hora queda libre y el enlace deja de servir: `"estado": "expirada"`. Para volver a
  intentarlo se hace una reserva **nueva** (con otra `referencia`).
- Si cancela antes de pagar (§3.6 o §3.8), el enlace también deja de servir.
- `"estado": "reembolsar"`: pagó cuando la cita ya no estaba vigente. **No** se reagenda sola: deriven a un asesor (devolución o nueva cita).
- Si la tienda no responde al reservar: `502 PAGO_NO_DISPONIBLE` y **no se crea nada** (reintentar en un momento o derivar a un asesor).
- Una cita ya pagada no se cancela por aquí (`PAGADA_EN_LINEA`), como cualquier pago en línea.

### 3.10 Aviso por WhatsApp 2 h antes de la cita (para el flujo de GHL)
Para las citas reservadas por **esta API de WhatsApp**, la Agenda llama una sola vez, unas **2 horas antes** de la cita, al webhook del
flujo de GHL que Sistemas tenga configurado, y GHL envía la plantilla de WhatsApp. Lo que manda la Agenda (`POST`, JSON):
```json
{ "codigo": "LB-123456", "numeroCita": "C-008340", "telefono": "+51987654321", "nombres": "Ana María",
  "fecha": "2026-11-14", "hora": "10:00", "servicio": "Evaluación PO", "sede": "Los Olivos", "direccion": "Av. …" }
```
- Fecha y hora son las **actuales** de la cita (si se reprogramó, la nueva). No se avisa si la cita se canceló, si el paciente ya
  llegó o si faltan menos de 20 minutos. Las de pago previo se avisan solo si se pagaron.
- El webhook debe responder `2xx`; si no, la Agenda reintenta cada minuto mientras falten más de 20 minutos.

## 4. Reintentos sin duplicar (`referencia`)
Si la llamada `POST /` se corta (tiempo de espera, caída de red) y no saben si se creó, **repitan exactamente la misma petición con la
misma `referencia`**: devuelve la reserva ya creada (`200`, `"repetida": true`) en vez de crear otra cita. Usen una `referencia`
**nueva** para cada reserva distinta. La misma `referencia` siempre devuelve **lo que pasó con esa reserva**: si era de pago previo
y ya venció, vuelve `"estado": "expirada"` (para intentarlo otra vez, otra `referencia`).

## 5. Errores
Formato general: `{ "error": "CODIGO", "message": "texto en español", "statusCode": 4xx }`. Los errores de datos (422) traen el detalle por campo:
```json
{ "error": "VALIDATION_ERROR", "message": "…", "details": [ { "campo": "numeroDocumento", "mensaje": "El DNI tiene 8 dígitos" } ] }
```
Los mensajes (`message`, `mensaje`) están en español y se pueden **mostrar tal cual al paciente**.

| HTTP | `error` | Cuándo |
|---|---|---|
| 401 | `UNAUTHORIZED` / `INVALID_API_KEY` | Falta la llave o no es válida |
| 403 | `FORBIDDEN` | La llave no es de esta API (p. ej. la llave web en `/integraciones/whatsapp`) |
| 400 | `SERVICIO_NO_RESERVABLE` | Ese servicio no se ofrece en esa sede (o no es reservable) |
| 400 | `VARIANTE_REQUERIDA` | El servicio tiene tipos: falta `subcategoriaId` |
| 400 | `FECHA_PASADA` / `FECHA_MUY_LEJANA` | Fecha fuera del rango reservable |
| 409 | `HORA_NO_DISPONIBLE` | Esa hora ya se ocupó: ofrecer otra |
| 422 | `VALIDATION_ERROR` | Datos mal escritos (documento, celular, correo, falta `aceptaDatos`…) |
| 404 | `RESERVA_NO_ENCONTRADA` | El código no existe (o se hizo con la otra API) |
| 404 | `CITA_NO_ENCONTRADA` | §3.8: ese N.º de cita no existe o no es de ese documento |
| 409 | `CITA_NO_MODIFICABLE` | Cancelar/reprogramar: la cita ya no está agendada ni confirmada (llegó, se atendió, se canceló…) |
| 409 | `CITA_PASADA` | Cancelar/reprogramar: la hora de la cita ya pasó |
| 409 | `PAGADA_EN_LINEA` | Cancelar: la reserva se pagó en línea; el paciente debe comunicarse con la sede |
| 409 | `SIN_CITA` | Cancelar/reprogramar: la reserva no tiene una cita vigente en la Agenda |
| 409 | `PAGO_PENDIENTE` | Reprogramar: la cita espera su pago previo (§3.9); primero se paga |
| 409 | `PAGO_PREVIO_REQUERIDO` | Reprogramar a sábado o domingo una cita sin pagar (§3.9): cancelar y reservar de nuevo ese día |
| 502 | `PAGO_NO_DISPONIBLE` | Sábado o domingo: la tienda no respondió al preparar el pago. No se creó nada |
| 409 | otros (`SLOT_OCUPADO`, `CITA_EN_BLOQUE`…) | Reprogramar: la Agenda no pudo mover la cita a ese horario; `message` explica por qué |
| 429 | `DEMASIADOS_INTENTOS` | Límite de la llave: 240 consultas/min y 30 reservas, cancelaciones o reprogramaciones/min. Esperar un momento |
| 502 / 503 | `AGENDA_ERROR` / `AGENDA_NO_RESPONDE` / `RESERVA_NO_CONFIGURADA` | Falla temporal o sin configurar en el servidor: reintentar con la **misma** `referencia`; si persiste, avisar a Sistemas |

## 6. Pruebas
Pidan a Sistemas una cita de prueba con un paciente de prueba. Para probar sin ensuciar la Agenda, usen un número de documento
claramente ficticio y avisen para que recepción cancele esas citas. **No hay entorno separado**: todo lo que se registre con la llave
real crea citas reales.

## 7. Seguridad (resumen)
- La llave viaja solo por HTTPS y solo en la cabecera `Authorization`; no en la URL.
- La API no devuelve datos personales del paciente (nombre, teléfono, correo, historia) ni nombres de profesionales. La única
  consulta por documento (§3.8) devuelve solo sus **citas próximas** (fecha, hora, sede, servicio).
- **Verificar a la persona es responsabilidad del chat**: con solo el documento, la API muestra y deja cancelar o reprogramar las
  citas de ese documento. Si alguien escribe un DNI ajeno, podría ver y cambiar las citas de otra persona. Recomendado: comparar el
  número de WhatsApp con el que el paciente dio al reservar, o pedirle un dato que solo él sepa (p. ej. el N.º de cita del correo).
- Cada reserva, cancelación y reprogramación queda auditada en la Agenda (qué canal, código, cita, horario anterior y nuevo).
- Si sospechan que la llave se filtró, avisen a Sistemas: se reemplaza en segundos.
