# API de reserva web — Limablue Agenda

Permite agendar una cita desde una página externa (p. ej. `/reserva/` o el sitio de la clínica).
Sin login. Prefijo: `/api/v1/publico/reservas`. Todas las respuestas son JSON.

**Base URL:** `https://<servidor>` (en local: `http://localhost:5180`, que reenvía `/api` a la API en `:3002`).

## Requisitos para que funcione (servidor)

| Variable (`apps/api/.env`) | Valor | Para qué |
|---|---|---|
| `RESERVA_WEB_HABILITADA` | `1` | Enciende la API. Apagada responde 404. |
| `RESERVA_WEB_PASARELA` | `simulada` (solo pruebas) o la pasarela real | Pasarela de pago. **Sin pasarela no se agenda nada**: la reserva solo aparta el horario 10 min y vence. |
| `RESERVA_WEB_API_KEY` | llave con scope `appointments:write` | Cuando el pago se aprueba, el sistema crea la cita llamando a `POST /api/v1/citas` con esta llave. Si falta, la reserva queda fallida. |
| `RESERVA_WEB_API_INTERNA` | `http://127.0.0.1:3002` | URL interna de la API. |
| `RESERVA_WEB_ORIGENES` | `https://www.limablue.com` | Dominios permitidos por CORS (si la página está en otro dominio). |
| `TURNSTILE_SECRET` | (opcional) | Si se define, se exige captcha de Cloudflare en `POST /` y `POST /intentos` (campo `captcha`). |

Además, cada servicio debe tener **`reservaOnline = true`** y precio (Administración → Servicios), y la unidad no puede ser `preferencia_obligatoria`.

Límites: 120 consultas/min y 10 reservas/15 min por conexión. Máximo 30 días hacia adelante. Si reserva para hoy: al menos 2 h antes.

---

## Flujo

`catalogo` → `dias` → `horas` → `intentos` → `POST /` (agenda) → `GET /:codigo` (estado)

### 1. Catálogo
```
GET /api/v1/publico/reservas/catalogo
```
Respuesta (resumida):
```json
{
  "sedes": [
    { "id": "541f627b-558a-4156-88e3-222b52b12d13", "nombre": "Los Olivos",
      "direccion": "AV. CARLOS ALBERTO IZAGUIRRE 1097 - LOS OLIVOS",
      "horario": { "1": { "abierto": true, "apertura": "09:00", "cierre": "18:00" } } }
  ],
  "servicios": [
    { "id": "<servicioId>", "nombre": "Evaluación PO", "duracionMinutos": 30, "unidad": "Podología",
      "sedes": ["541f627b-558a-4156-88e3-222b52b12d13"],
      "variantes": [ { "id": null, "nombre": "Evaluación PO", "precio": 50 } ] }
  ],
  "reglas": { "diasMaximos": 30, "minutosApartado": 10, "anticipacionMinutosHoy": 120 }
}
```
Si `variantes[].id` no es `null`, ese id se envía como `subcategoriaId` al reservar.

### 2. Días con horas libres
```
GET /api/v1/publico/reservas/dias?sedeId=<uuid>&servicioId=<uuid>&desde=2026-10-22&hasta=2026-11-05
```
```json
{ "dias": [ { "fecha": "2026-10-22", "horas": 18 }, { "fecha": "2026-10-23", "horas": 18 } ] }
```

### 3. Horas libres de un día
```
GET /api/v1/publico/reservas/horas?sedeId=<uuid>&servicioId=<uuid>&fecha=2026-10-27
```
```json
{ "fecha": "2026-10-27", "horas": ["09:00", "09:30", "10:00", "10:30"] }
```

### 4. Intento (primer «Continuar», arranca los 10 minutos) — opcional pero recomendado
```
POST /api/v1/publico/reservas/intentos
Content-Type: application/json
```
```json
{
  "numeroDocumento": "99999991",
  "nombres": "PRUEBA RESERVA",
  "apellidoPaterno": "WEB",
  "apellidoMaterno": "LOCAL",
  "telefono": "900000001",
  "email": "prueba.reserva@example.com",
  "aceptaDatos": true
}
```
Respuesta `201`:
```json
{ "intentoId": "<uuid>", "token": "<token>", "expiraEn": "2026-10-21T21:28:31.537Z" }
```
Avance posterior (opcional): `PATCH /intentos/:id` con `{ "token": "...", "paso": "...", "sedeId": "...", "servicioId": "...", "fecha": "...", "horaInicio": "..." }`.

### 5. Reservar = APARTAR el horario (la cita se crea SOLO cuando el pago se aprueba)
```
POST /api/v1/publico/reservas
Content-Type: application/json
```
```json
{
  "numeroDocumento": "99999991",
  "nombres": "PRUEBA RESERVA",
  "apellidoPaterno": "WEB",
  "apellidoMaterno": "LOCAL",
  "telefono": "900000001",
  "email": "prueba.reserva@example.com",
  "sedeId": "541f627b-558a-4156-88e3-222b52b12d13",
  "servicioId": "<servicioId>",
  "subcategoriaId": null,
  "fecha": "2026-10-27",
  "horaInicio": "09:00",
  "aceptaDatos": true,
  "intentoId": "<intentoId del paso 4>",
  "intentoToken": "<token del paso 4>"
}
```
Respuesta `201` (el horario queda apartado 10 minutos; **todavía no existe la cita**):
```json
{
  "codigo": "LB-776019",
  "token": "818892a36104becfa1810b257acdf6012015282b9af8ff35",
  "estado": "esperando_pago",
  "monto": 50,
  "moneda": "PEN",
  "fecha": "2026-10-27",
  "horaInicio": "09:00",
  "expiraEn": "2026-10-21T21:28:31.537Z"
}
```
Validaciones: DNI 8 dígitos; celular 9 dígitos que empieza con 9; `aceptaDatos` debe ser `true`; `apellidoMaterno`, `subcategoriaId`, `intentoId`, `intentoToken` y `captcha` son opcionales.

El profesional lo asigna el sistema solo (reglas de la Agenda). **Nunca se asigna automáticamente a Daniel Doy ni a Yasica Doy** (`asignacionAutomatica = false`).

### 6. Pago (aquí se agenda)
```
POST /api/v1/publico/reservas/<codigo>/pago
{ "token": "<token de la reserva>" }
```
Si no hay pasarela configurada responde `503 PASARELA_NO_CONFIGURADA` y **no se crea ninguna cita**.
La pasarela avisa por `POST /api/v1/publico/reservas/pagos/webhook/<pasarela>` (servidor a servidor, con firma). Solo cuando el aviso es **aprobado** la reserva pasa a `confirmada` y se crea la cita (canal web, pago completo). Un pago rechazado no agenda nada y el paciente puede reintentar mientras el horario siga apartado. Si vence el tiempo sin pago, el horario se libera.

### 7. Estado de la reserva
```
GET /api/v1/publico/reservas/<codigo>?token=<token>
```
```json
{
  "codigo": "LB-776019", "estado": "confirmada", "nombres": "PRUEBA PASARELA",
  "fecha": "2026-10-27", "horaInicio": "11:00", "duracionMinutos": 30,
  "sede": { "nombre": "Los Olivos", "direccion": "AV. CARLOS ALBERTO IZAGUIRRE 1097 - LOS OLIVOS" },
  "servicio": "Evaluación PO", "variante": null,
  "monto": 50, "moneda": "PEN", "expiraEn": "2026-10-21T21:48:31.537Z", "pagadoEn": "2026-10-21T21:40:02.000Z",
  "pagoPendiente": false
}
```
Estados: `esperando_pago` (horario apartado, sin cita), `pagada` (pago recibido, creando la cita), `confirmada` (**cita creada**), `expirada`, `fallida`.

---

## Errores frecuentes

| HTTP | `code` | Significado |
|---|---|---|
| 404 | `NOT_FOUND` | La reserva web está apagada (`RESERVA_WEB_HABILITADA` ≠ 1). |
| 400 | `SERVICIO_NO_RESERVABLE` | Servicio sin `reservaOnline` o no disponible en esa sede. |
| 400 | `VARIANTE_REQUERIDA` | El servicio tiene variantes: enviar `subcategoriaId`. |
| 400 | `FECHA_PASADA` / `FECHA_MUY_LEJANA` | Fecha fuera de rango. |
| 409 | `HORA_NO_DISPONIBLE` | Esa hora se acaba de ocupar. Elegir otra. |
| 409 | `RESERVA_NO_PAGABLE` | La reserva ya no espera pago. |
| 410 | `RESERVA_VENCIDA` | Pasaron los 10 minutos. |
| 429 | `RESERVAS_EN_CURSO` / `DEMASIADOS_INTENTOS` | Demasiadas reservas abiertas o consultas. |

---

## Ejemplo rápido con curl

```bash
BASE=https://<servidor>/api/v1/publico/reservas
SEDE=541f627b-558a-4156-88e3-222b52b12d13
SERV=<servicioId>

curl "$BASE/catalogo"
curl "$BASE/dias?sedeId=$SEDE&servicioId=$SERV&desde=2026-10-22&hasta=2026-11-05"
curl "$BASE/horas?sedeId=$SEDE&servicioId=$SERV&fecha=2026-10-27"

curl -X POST "$BASE" -H "Content-Type: application/json" -d '{
  "numeroDocumento":"99999991","nombres":"PRUEBA RESERVA","apellidoPaterno":"WEB","apellidoMaterno":"LOCAL",
  "telefono":"900000001","email":"prueba.reserva@example.com",
  "sedeId":"'$SEDE'","servicioId":"'$SERV'","fecha":"2026-10-27","horaInicio":"09:00","aceptaDatos":true }'
```

## API con API key (integraciones externas)

Para crear citas directamente (sin pasar por la reserva web) existe la API interna, autenticada con API key:

```
Authorization: ApiKey <llave>
Idempotency-Key: <id-unico-por-cita>      (evita duplicados al reintentar)
```
- `GET  /api/v1/disponibilidad` — scope `availability:read`
- `POST /api/v1/citas` — scope `appointments:write`

Documentación interactiva: `/api/docs` (Swagger).
