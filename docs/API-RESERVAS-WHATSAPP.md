# API de reservas para el chat de WhatsApp — Limablue Agenda

Permite que el chat de WhatsApp de Limablue **consulte horarios y registre la cita de un paciente** conversando con él,
sin pasarela de pago: **la cita se crea al confirmar y el paciente paga en la sede**.

- Servidor a servidor (no se llama desde un navegador).
- Misma disponibilidad real que la Agenda: no hay doble reserva, respeta horarios, almuerzos, permisos y días especiales.
- Solo se ofrecen los servicios que la clínica marcó como «reserva en línea» en Administración › Reserva web (los mismos de la página `/agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva`).
- Cada reserva entra a la Agenda con el **canal «WhatsApp»**, pago **pendiente** y un comentario con el código de reserva.

## 1. Conexión y llave

| | |
|---|---|
| Dirección base | `https://<servidor>/api/v1/integraciones/reservas` (hoy `https://161.132.166.44/...`; con dominio, `https://agenda.limablue.com/...`) |
| Autenticación | Cabecera `Authorization: ApiKey <llave>` |
| Formato | JSON (`Content-Type: application/json`), UTF-8 |
| Horario | Todas las fechas y horas son de **Lima** (`AAAA-MM-DD`, `HH:MM` en 24 h) |

La **llave** la genera Sistemas en el servidor con **«Llave API del chat.bat»**. Se muestra **una sola vez** (en la base solo queda
su huella). Si se pierde o se filtra, se crea otra y la anterior deja de funcionar al instante. Solo sirve para esta API
(permiso `reservas:write`): no abre la Agenda ni ve datos de pacientes. **Guárdenla como un secreto**: no en el código del bot,
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

## 3. Endpoints

### 3.1 `GET /catalogo`
Sedes y servicios reservables.

```bash
curl -H "Authorization: ApiKey $LLAVE" https://<servidor>/api/v1/integraciones/reservas/catalogo
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
{ "fecha": "2026-11-02", "horas": ["09:00", "09:30", "10:00"] }
```

### 3.4 `POST /` — registrar la reserva (crea la cita)

```bash
curl -X POST https://<servidor>/api/v1/integraciones/reservas \
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
| `canal` | no (por defecto `whatsapp`) | Canal de la Agenda con el que queda la cita. No se puede usar `web` |
| `referencia` | recomendado | Identificador **único de esta petición** (6 a 100 caracteres; p. ej. id de la conversación + número de intento). Evita citas duplicadas si el chat **reintenta** (ver §4). También se acepta en la cabecera `Idempotency-Key` |

Respuesta **201** (o **200** si es un reintento ya procesado, con `"repetida": true`):
```json
{
  "codigo": "LB-567405",
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
- La **profesional** se asigna automáticamente (la que esté libre a esa hora). No se informa su nombre.
- Si el paciente ya existe (mismo tipo y número de documento), se usa su ficha **sin modificar sus datos**; si no, se registra uno nuevo.
- Si hay correo, el paciente recibe el correo de confirmación de la Agenda.

### 3.5 `GET /:codigo` — estado de una reserva hecha por el chat
```json
{
  "codigo": "LB-567405", "estado": "confirmada", "citaVigente": true, "estadoCita": "agendada",
  "nombres": "Ana María", "fecha": "2026-11-02", "horaInicio": "09:00", "duracionMinutos": 30,
  "sede": { "nombre": "Los Olivos", "direccion": "Av. …" }, "servicio": "Evaluación PO", "variante": null,
  "monto": 50, "moneda": "PEN"
}
```
`estado` es `confirmada` o `cancelada` (si recepción canceló la cita). `estadoCita` es el estado real en la Agenda
(`agendada`, `confirmada`, `llego`, `en_atencion`, `completada`, `no_show`, `cancelada`, `reprogramada`). Si el paciente quiere
**cambiar o cancelar**, que se comunique con la clínica (esta API solo registra).

## 4. Reintentos sin duplicar (`referencia`)
Si la llamada `POST /` se corta (tiempo de espera, caída de red) y no saben si se creó, **repitan exactamente la misma petición con la
misma `referencia`**: devuelve la reserva ya creada (`200`, `"repetida": true`) en vez de crear otra cita. Usen una `referencia`
**nueva** para cada reserva distinta.

## 5. Errores
Formato general: `{ "error": "CODIGO", "message": "texto en español", "statusCode": 4xx }`. Los errores de datos (422) traen el detalle por campo:
```json
{ "error": "VALIDATION_ERROR", "message": "…", "details": [ { "campo": "numeroDocumento", "mensaje": "El DNI tiene 8 dígitos" } ] }
```
Los mensajes (`message`, `mensaje`) están en español y se pueden **mostrar tal cual al paciente**.

| HTTP | `error` | Cuándo |
|---|---|---|
| 401 | `UNAUTHORIZED` / `INVALID_API_KEY` | Falta la llave o no es válida |
| 403 | `FORBIDDEN` | La llave no tiene el permiso de reservas |
| 400 | `SERVICIO_NO_RESERVABLE` | Ese servicio no se ofrece en esa sede (o no es reservable) |
| 400 | `VARIANTE_REQUERIDA` | El servicio tiene tipos: falta `subcategoriaId` |
| 400 | `FECHA_PASADA` / `FECHA_MUY_LEJANA` | Fecha fuera del rango reservable |
| 400 | `CANAL_INVALIDO` | El `canal` no existe en la Agenda |
| 409 | `HORA_NO_DISPONIBLE` | Esa hora ya se ocupó: ofrecer otra |
| 422 | `VALIDATION_ERROR` | Datos mal escritos (documento, celular, correo, falta `aceptaDatos`…) |
| 404 | `RESERVA_NO_ENCONTRADA` | El código no existe (o no es de este canal) |
| 429 | `DEMASIADOS_INTENTOS` | Límite de la llave: 240 consultas/min y 30 reservas/min. Esperar un momento |
| 502 / 503 | `AGENDA_ERROR` / `AGENDA_NO_RESPONDE` / `RESERVA_NO_CONFIGURADA` | Falla temporal o sin configurar en el servidor: reintentar con la **misma** `referencia`; si persiste, avisar a Sistemas |

## 6. Pruebas
Pidan a Sistemas una cita de prueba con un paciente de prueba. Para probar sin ensuciar la Agenda, usen un número de documento
claramente ficticio y avisen para que recepción cancele esas citas. **No hay entorno separado**: todo lo que se registre con la llave
real crea citas reales.

## 7. Seguridad (resumen)
- La llave viaja solo por HTTPS y solo en la cabecera `Authorization`; no en la URL.
- La API no devuelve datos de pacientes (ni siquiera confirma si un documento ya existe) ni nombres de profesionales.
- Cada reserva queda auditada en la Agenda (quién/qué canal, código, cita creada).
- Si sospechan que la llave se filtró, avisen a Sistemas: se reemplaza en segundos.
