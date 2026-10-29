# API de reserva web — Limablue Agenda

> **Actualizado el 29-oct-2026: se quitó la pasarela de pago.** Este documento anterior (apartar horario, pago, webhook) ya no
> aplica. Lo vigente:
>
> - **Página pública `/reserva`**: el paciente elige datos (DNI o CE), sede, servicio, fecha y hora, y al **confirmar se crea la
>   cita** (pago pendiente: se paga en la sede). Usa la API pública `/api/v1/publico/reservas` (catálogo, días, horas, intentos,
>   reservar, estado), sin login y solo desde navegadores de los dominios permitidos (`RESERVA_WEB_ORIGENES`).
> - **Chat de WhatsApp**: usa otra API, servidor a servidor y con llave → **[API-RESERVAS-WHATSAPP.md](API-RESERVAS-WHATSAPP.md)**.
>
> Ya no existen: `POST /:codigo/pago`, `POST /:codigo/confirmar-demo`, `POST /pagos/webhook/:pasarela`, los estados
> `esperando_pago` / `pagada`, ni las variables `RESERVA_WEB_PASARELA`, `RESERVA_WEB_SIMULADA_SECRETO` y
> `RESERVA_WEB_MINUTOS_APARTADO`.
