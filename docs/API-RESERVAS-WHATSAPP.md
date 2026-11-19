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
| `GET /citas-paciente?numeroDocumento=` | Citas próximas del paciente (formato de la nota del chat) | 3.8.1 |
| `GET /consultar?que=…` | Todas las consultas en una sola ruta (para GHL; solo WhatsApp) | 3.8.2 |
| `POST /cambiar` | Cancelar o reprogramar en una sola ruta (para GHL; solo WhatsApp) | 3.8.2 |
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

**Reglas para cancelar y reprogramar (16-nov-2026, las definió el equipo del chat).** Valen para TODAS las rutas de cancelar y
reprogramar (3.6, 3.7, 3.8, 3.8.1 y 3.8.2). Lo que no se puede hacer por aquí responde `409` con uno de estos códigos y Ana deriva a un
asesor (salvo `HORA_NO_DISPONIBLE`, que se resuelve ofreciendo otra hora):

| Código | Cuándo |
|---|---|
| `FUERA_DE_PLAZO` | Faltan menos de **2 horas** para la cita, o ya pasó (el servidor puede cambiar el plazo: `RESERVA_CHAT_CAMBIO_ANTICIPACION_MIN`) |
| `REQUIERE_ASESOR` | La cita ya tiene un **pago** (en línea o en la sede), es de un **paquete** o de una visita de **dos servicios**, o pide un **profesional en particular**. Al reprogramar, además: a **sábado o domingo**, un servicio que no se reserva en línea en esa sede, o un paciente sin DNI ni CE |
| `ESPERANDO_PAGO` | La reserva de fin de semana aún espera su pago previo (se libera sola a los 10 minutos) |
| `NO_SE_PUEDE_CANCELAR` | La cita ya está en curso o fue atendida (llegó, en atención, completada, no vino) |
| `NO_VIGENTE` | Reprogramar una cita que ya está cancelada |
| `HORA_NO_DISPONIBLE` | La hora nueva ya no está libre: la cita queda como estaba |

- Cancelar una cita que ya está cancelada no es error: `200` con `repetida: true` (`sinCambios: true`).
- Reprogramar a la misma fecha y hora que ya tiene tampoco es error (es un reintento): responde como hecha, con `repetida: true`.
- Por código LB sin documento, solo reservas hechas con **la misma API** (la de WhatsApp no ve las de la web, ni al revés).

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
- `enBloque: true`: la cita es parte de una visita de **dos servicios a la misma hora**; aparece una vez por servicio. No se cambia
  por aquí (`REQUIERE_ASESOR`).
- Cada cita trae también `codigo`, `estadoCita`, `puedeCambiar` y, si no se puede, `motivo` (ver 3.8.1).

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
o ya estaba en ese horario). Valen las reglas de la tabla de §3.7, y reprogramar es en la misma sede y servicio.

### 3.8.1 Mismas funciones con el formato de la nota del chat (14-nov-2026)
Para que el flujo de Ana funcione sin cambios, las rutas de arriba también aceptan este formato (en las dos APIs):

- **`GET /citas-paciente?numeroDocumento=12345678`** = `POST /pacientes/citas` (el tipo de documento es opcional: sin él se busca
  por el número). Ojo: aquí el documento va en la URL; si pueden, usen el `POST`.
- Cada cita de la lista trae además `codigo` (el `LB-…` de su reserva o, si la registró la clínica, el **id** de la cita),
  `estadoCita`, `puedeCambiar` y, si no se puede, `motivo` (el código de la tabla de reglas de §3.7: `REQUIERE_ASESOR`,
  `FUERA_DE_PLAZO`, `ESPERANDO_PAGO`…). Con `puedeCambiar: false`, Ana deriva a un asesor. (`puedeCancelar` y `puedeReprogramar`
  valen lo mismo que `puedeCambiar`; reprogramar a sábado o domingo tampoco se puede, aunque diga `true`.)
- **`POST /{codigo}/cancelar`** con `{ "numeroDocumento": "…", "motivo": "…" }` → `200` con `codigo`, `estado: "cancelada"` y
  `repetida` (`true` si ya estaba cancelada).
- **`POST /{codigo}/reprogramar`** con `{ "numeroDocumento": "…", "fecha": "…", "horaInicio": "…" }` → `201` con los campos de
  `POST /` (`codigo`, `estado`, `citaId`, `fecha`, `horaInicio`, `sede`, `servicio`, `monto`…) más `codigoAnterior` y `repetida`.
  **La cita se mueve, no se crea otra:** conserva su código, su N.º de cita y su historial, así que `codigo` = `codigoAnterior`.
- Con `numeroDocumento`, `{codigo}` puede ser `LB-…` (de cualquier canal), el id de la cita o `C-…`, siempre que la cita sea
  del dueño de ese documento; si no lo es: `404 RESERVA_NO_ENCONTRADA`. Sin `numeroDocumento` todo funciona como en 3.6 y 3.7.
- Las reglas y los errores son los de la tabla de §3.7.

### 3.8.2 Rutas agrupadas para GHL (16-nov-2026) — solo la API de WhatsApp
GHL deja solo **5 acciones «Llamada a API» por agente**. Estas dos rutas reúnen todo, y Ana usa 3 acciones (Consultar, Reservar cita
con `POST /` y Cambiar cita). Hacen lo mismo que las rutas sueltas (mismas funciones, reglas y límites); las sueltas siguen funcionando.

**`GET /consultar?que=…`** — el parámetro `que` elige la consulta:

| `que` | Parámetros obligatorios | Equivale a |
|---|---|---|
| `catalogo` | — | `GET /catalogo` |
| `dias` | `sedeId`, `servicioId`, `desde`, `hasta` | `GET /dias` |
| `horas` | `sedeId`, `servicioId`, `fecha` | `GET /horas` (con `cupos`) |
| `reserva` | `codigo` (`LB-123456`) | `GET /:codigo` |
| `citas` | `numeroDocumento` | `GET /citas-paciente` |

**`POST /cambiar`** — cuerpo JSON con `accion`:
- `{ "accion": "cancelar", "codigo": "LB-123456", "numeroDocumento": "…", "motivo": "…" }` → como `POST /{codigo}/cancelar` con documento (`200`).
- `{ "accion": "reprogramar", "codigo": "LB-123456", "numeroDocumento": "…", "fecha": "AAAA-MM-DD", "horaInicio": "HH:MM" }` → como
  `POST /{codigo}/reprogramar` con documento (`201`).

`codigo` es el que da la lista de citas (`LB-…` o el id de la cita). Una combinación inválida (por ejemplo `que=horas` sin `fecha`, o una
`accion` desconocida) responde `422` con el campo que falta.

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
- Una cita ya pagada no se cancela ni reprograma por aquí (`REQUIERE_ASESOR`): lo ve un asesor.

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

### 3.11 Servidor MCP para Ana (17-nov-2026)
Lo mismo de esta API, como **servidor MCP** (sin el tope de 5 acciones de GHL y con la respuesta completa para Ana):
- **URL:** `POST https://limablueagenda.com/api/v1/mcp` — MCP «Streamable HTTP» **sin sesión** (JSON-RPC 2.0: `initialize`, `tools/list`,
  `tools/call`). Cabeceras: `Authorization: ApiKey <llave>`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`.
- **Llave:** la misma de WhatsApp. El canal lo fija la llave (como en las rutas REST). Sin llave: `401`; llave sin permiso de reservas: `403`.
- **Mismas reglas y límites por llave** que las rutas REST (240 consultas por minuto en total, 30 reservas, 20 búsquedas por documento y
  10 cambios —cancelar, reprogramar, nota y extender pago—). Las rutas REST siguen funcionando igual.
- **Errores:** la herramienta responde con `isError: true` y el texto `{ "error": "mensaje", "code": "CODIGO", "status": 409 }` (los códigos
  de la sección 5). Si los argumentos no cumplen el esquema, el texto empieza con `MCP error -32602` y dice qué campo falta.

| Herramienta | Argumentos | Equivale a |
|---|---|---|
| `consultar_catalogo` | — | `GET /catalogo` |
| `info_sede` | — | **Nueva:** dirección y horario de atención por día de cada sede |
| `dias_disponibles` | `sedeId`, `servicioId`, `desde`, `hasta` | `GET /dias` |
| `horas_del_dia` | `sedeId`, `servicioId`, `fecha` | `GET /horas` (con `cupos`) |
| `buscar_cupo` | `servicioId`, `fecha`, `sedeId?` (preferida), `subcategoriaId?` | **Nueva** (abajo) |
| `reservar_cita` | los de `POST /` (`aceptaDatos: true`, `referencia?`) | `POST /` |
| `estado_reserva` | `codigo` (`LB-…`) | `GET /:codigo` |
| `mis_citas` | `numeroDocumento`, `tipoDocumento?` | `GET /citas-paciente` |
| `cancelar_cita` | `codigo`, `numeroDocumento`, `motivo?` | `POST /{codigo}/cancelar` |
| `reprogramar_cita` | `codigo`, `numeroDocumento`, `fecha`, `horaInicio` | `POST /{codigo}/reprogramar` (la cita se mueve) |
| `agregar_nota_cita` | `codigo`, `numeroDocumento`, `texto` (3 a 500) | **Nueva:** nota para recepción en la cita («llegaré 10 min tarde») |
| `extender_pago` | `codigo` (`LB-…`), `numeroDocumento` | **Nueva:** 10 minutos más para pagar, una sola vez |

`codigo` en cancelar, reprogramar y nota = lo que da `mis_citas` (`LB-…`, el id de la cita) o el N.º de cita `C-…`.

**`buscar_cupo`**: todas las sedes que ofrecen ese servicio (y ese tipo, si se indica), la preferida primero; una sede sin cupo sale con
`horas: []`. Si ninguna tiene cupo ese día, `diaCercano` = el siguiente día con cupo dentro de 14 días, en cualquier sede:
```json
{ "fecha": "2026-11-21", "servicio": "Limpieza Clínica del Pie", "hayCupo": false,
  "sedes": [ { "sedeId": "…", "sede": "One", "preferida": true, "precio": 90, "horas": [], "cupos": {} },
             { "sedeId": "…", "sede": "Lince", "preferida": false, "precio": 87, "horas": [], "cupos": {} } ],
  "diaCercano": { "fecha": "2026-11-22", "sedeId": "…", "sede": "Lince", "horas": ["09:00", "10:30"] } }
```
**`agregar_nota_cita`**: queda en el hilo de comentarios de la cita como «Paciente (WhatsApp · Ana)» (recepción la ve al instante). Solo en
citas vigentes (`NO_VIGENTE` si ya se canceló o se atendió); un código que no es de ese documento: `RESERVA_NO_ENCONTRADA`.
**`extender_pago`**: solo reservas de esta API en `esperando_pago` y sin vencer. Errores: `NO_ESPERA_PAGO`, `PAGO_VENCIDO` (reservar de
nuevo), `YA_EXTENDIDO`.

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
| 409 | `FUERA_DE_PLAZO` / `REQUIERE_ASESOR` / `ESPERANDO_PAGO` / `NO_SE_PUEDE_CANCELAR` / `NO_VIGENTE` | Cancelar/reprogramar: ver la tabla de reglas de §3.7 (Ana deriva a un asesor) |
| 409 | `SIN_CITA` | Cancelar/reprogramar: la reserva no tiene una cita vigente en la Agenda |
| 502 | `PAGO_NO_DISPONIBLE` | Sábado o domingo: la tienda no respondió al preparar el pago. No se creó nada |
| 409 | `NO_ESPERA_PAGO` / `PAGO_VENCIDO` / `YA_EXTENDIDO` | MCP `extender_pago` (§3.11) |
| 400 | `NOTA_VACIA` | MCP `agregar_nota_cita`: nota de menos de 3 letras |
| 409 | otros (`SLOT_OCUPADO`…) | Reprogramar: la Agenda no pudo mover la cita a ese horario; `message` explica por qué |
| 429 | `DEMASIADOS_INTENTOS` | Límite de la llave por minuto: 240 consultas, 30 reservas, 20 búsquedas de citas por documento y 10 cancelaciones o reprogramaciones. Esperar un momento |
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
