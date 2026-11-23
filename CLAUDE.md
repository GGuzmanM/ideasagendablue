# Limablue Agenda — Contexto del proyecto

## Qué es esto
Sistema de agendamiento de citas para Limablue, clínica de salud del pie en Lima, Perú.
Reemplaza un ERP de escritorio de 14 años. 5 sedes, ~400 citas diarias, 40 podólogos.

## Stack
- **Frontend**: React 18 + Vite (puerto 5180) + TailwindCSS + @dnd-kit/core + TanStack Query + date-fns
- **Backend**: Node.js + Express + TypeScript estricto (puerto 3002)
- **DB**: PostgreSQL + Prisma ORM (`apps/api/prisma/schema.prisma`)
- **Cache/locks**: Redis
- **Realtime**: Socket.io
- **Monorepo**: apps/web, apps/api, packages/shared

## Convenciones
- Idioma UI: español (Perú). Zona horaria: America/Lima
- API prefix: `/api/v1/`
- Frontend proxía `/api` → `http://localhost:3002` (ver `apps/web/vite.config.ts`)
- **Toda la web cuelga de `/acceso_agenda_lb`** (login en `/acceso_agenda_lb/login`, ventanas en `/acceso_agenda_lb/<ventana>`).
  Se define una vez en `base` de `vite.config.ts`; el router usa `basename` (`utils/rutaBase.ts`) y lo que NO pasa por el
  router (`window.open`, `window.location`, imágenes de `/public`) usa `rutaWeb()`. `/api`, `/socket.io`, `/uploads` y
  la reserva web pública (`/agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva/`, `RUTA_RESERVA_WEB`; `/reserva` redirige ahí) siguen en la raíz. En producción `tools/servidor/lanzador.js` sirve solo ese prefijo (`PREFIJO_WEB`) y responde
  404 neutro a todo lo demás; `/verificar/<código>` sin prefijo (QR de recetas ya impresas) redirige. En dev: `http://localhost:5180/acceso_agenda_lb/`.
- **Reserva web SIN pasarela de pago (29-oct-2026)**: la cita se crea al confirmar (pago pendiente: se paga en la sede). Dos entradas que
  comparten `services/reservaWeb/`: la página pública `/agendamiento_directo_limablue_un_paso_cerca_de_ti/reserva/` (`routes/reservaWeb.ts`, sin login) y la API del chat de WhatsApp
  (`routes/reservaChat.ts`; docs/API-RESERVAS-WHATSAPP.md). **Desde el 12-nov-2026 son DOS APIs** (`crearApiReservas`), mismas rutas, llave y canal
  propios: WEB `/api/v1/integraciones/reservas` (scope `reservas:write`, la llave que ya existía → canal `web`) y WHATSAPP `/api/v1/integraciones/whatsapp`
  (scope `reservas:whatsapp` → canal `whatsapp`). El canal lo fija la llave (el campo `canal` del cliente se ignora); por código LB cada una solo ve lo suyo.
  Llaves: «Llaves API (web y WhatsApp).bat» (reemplaza por PERMISO, no por nombre). Documento DNI o CE
  (`services/reservaWeb/validaciones.ts`). La cita se crea con POST /citas usando la llave interna `RESERVA_WEB_API_KEY`.
  **Cancelar / reprogramar por el chat (11-nov-2026)**: `POST /integraciones/reservas/:codigo/cancelar {motivo?}` y `/:codigo/reprogramar {fecha, horaInicio}`
  (`services/reservaWeb/gestion.ts`), misma llave `reservas:write`. Reglas: ver «Reglas del equipo del chat (16-nov-2026)» más abajo. Llaman a
  PATCH /citas/:id/estado y /mover con la llave interna (`llamarAgenda`); frenan cita no agendada/confirmada, hora pasada y cancelar una pagada
  en línea. `GET /:codigo` devuelve fecha/hora ACTUALES de la cita y `sedeId`/`servicioId`. Tests: `__tests__/reserva-gestion-chat`.
  Por DOCUMENTO (todas las citas próximas, también las de recepción): `POST /pacientes/citas {tipoDocumento?, numeroDocumento}` y
  `POST /citas/:numeroCita/cancelar|reprogramar` con el documento del dueño (si no coincide, 404). POST para no dejar el DNI en URLs.
  Solo DNI, sin comprobar el celular (decisión del 11-nov-2026: la verificación de la persona la hace el chat). Auditoría: `chat_cita_cancelada` / `chat_cita_reprogramada`.
  **Contrato de la nota de Ana (14-nov-2026, compatibilidad con su paquete «CancelarReprogramar»)**: `GET /citas-paciente?numeroDocumento=` (= POST
  /pacientes/citas; tipo de documento opcional) y `POST /:codigo/cancelar|reprogramar` con `numeroDocumento` en el cuerpo → camino por PACIENTE
  (`cancelarCompat` / `reprogramarCompat` en `gestion.ts`): `codigo` = `LB-…` de cualquier canal, id de la cita o `C-…`; respuestas con `repetida`,
  `codigoAnterior` (reprogramar 201). La cita se MUEVE (su versión creaba otra). Cada cita listada trae `codigo`, `estadoCita`, `puedeCancelar`,
  `puedeReprogramar`, `puedeCambiar` y `motivo`.
  **Reglas del equipo del chat (16-nov-2026, reemplazan a «solo mecánica»)**, en `evaluarCambio` de `gestion.ts` y para TODAS las rutas de cancelar/
  reprogramar: 409 `FUERA_DE_PLAZO` (< `RESERVA_CHAT_CAMBIO_ANTICIPACION_MIN`, 120), `REQUIERE_ASESOR` (cualquier pago, paquete, visita doble,
  profesional pedido; al reprogramar: sáb/dom, servicio no reservable en línea en esa sede, paciente sin DNI/CE), `ESPERANDO_PAGO`, `NO_SE_PUEDE_CANCELAR`
  (en curso/atendida), `NO_VIGENTE` (reprogramar una cancelada). Reprogramar a la misma hora = reintento (`repetida`), no `MISMA_HORA`. Límites por llave:
  20 búsquedas por documento y 10 cambios por minuto. **Rutas agrupadas para GHL** (5 acciones por agente), solo en `/integraciones/whatsapp`:
  `GET /consultar?que=catalogo|dias|horas|reserva|citas` y `POST /cambiar {accion: cancelar|reprogramar, …}`. Lo mismo, sin N.º de cita ni rutas por
  N.º, está en el repo de GitHub (`Documents/ag/ideasagendablue`, `gestion.ts` con `cancelarCitaChat`/`reprogramarCitaChat`).
  **Servidor MCP para Ana (17-nov-2026)**: `POST /api/v1/mcp` (`routes/mcp.ts`, `@modelcontextprotocol/sdk`, Streamable HTTP SIN sesión). 12
  herramientas que llaman a las MISMAS funciones de las rutas REST (canal fijado por la llave, mismas reglas; límites por llave contados en
  `contarUso`) + `buscar_cupo` (todas las sedes un día; `diaCercano` en 14 días) y los extras de `services/reservaWeb/extrasChat.ts`
  (`infoSedes`, `agregarNotaCita` → hilo de comentarios como «Paciente (WhatsApp · Ana)», `extenderPago` → +10 min una vez, marca
  `pagoDetalle.extendido`). OJO: los tipos genéricos de `registerTool` dejan a tsc sin memoria → se registra con una firma simple
  (`RegistrarHerramienta`); el SDK valida los argumentos igual. Docs §3.11. Tests: `__tests__/mcp-servidor`, `extras-chat`.
  Qué servicios se ofrecen y a qué precio: Administración › Reserva web (`/admin/reserva-web`; `servicios.reservaOnline` + `precioOnline` y, por
  tipo, `subcategorias_servicio.reservaOnline` + `precioOnline`; vacío = precio referencial; las áreas «preferencia_obligatoria» no se pueden).
  **Precio por SEDE (30-oct-2026)**: tablas `servicio_precio_web_sede` y `subcategoria_precio_web_sede` (PK compuesta; sin fila = rige el general).
  Orden de precedencia en `services/reservaWeb/precios.ts` (`precioWebEnSede`: tipo-sede › tipo web › tipo referencial › servicio-sede › servicio web ›
  servicio referencial). `catalogo()` devuelve por variante `precio` (general) y `precios` (id de sede → precio; una sede ausente no ofrece ese tipo);
  `servicioReservable` cobra `precios[sedeId]`. Rutas `PUT /servicios/:id/reserva-web/sedes/:sedeId` y `/servicios/subcategorias/:subId/reserva-web/sedes/:sedeId`.
  **Sedes visibles y oferta por sede (30-oct-2026)**: `sedes.reservaWeb` (default true; apagarla la saca de la reserva web, no de la agenda) y la tabla
  `servicio_sede_web_oculto` (una fila = ese servicio NO se ofrece en esa sede; sin fila = se ofrece en todas las sedes de su área). La regla vive en
  `services/reservaWeb/visibilidad.ts` (`sedesQueOfrecen`) y la usan `catalogo()` y la pantalla; `horasLibres` devuelve [] para una sede apagada o un servicio
  oculto ahí. Rutas: `GET /servicios/reserva-web/sedes`, `PATCH /servicios/reserva-web/sedes/:sedeId {reservaWeb}`, `PUT /servicios/:id/reserva-web/sedes/:sedeId/oferta {ofrecer}`.
  Los tipos (subcategorías) siguen al servicio: solo tienen precio propio por sede, no oferta propia.
- **Pago en línea con Niubiz en la reserva web (10-nov-2026, APAGADO por defecto)**: `services/reservaWeb/niubiz.ts` (cliente de las 4 llamadas: token de
  acceso → token de sesión → `checkout.js` en el navegador → autorización/reversa) y `pago.ts` (`iniciarPago` aparta el horario unos minutos y pide el token
  de sesión; `procesarRetorno` autoriza —único momento en que se cobra—, compara el monto autorizado, crea la cita con el mismo `POST /citas` y, si la cita falla,
  ANULA el cobro). Rutas en `routes/reservaWeb.ts`: `POST /pago/iniciar` y `POST /pago/retorno/:codigo` (formulario de Niubiz → 303 a la página con `?pago=<destino>`).
  Estados de `reservas_web`: esperando_pago → autorizando → confirmada | fallida | reembolsar (cobro incierto o sin cita: revisar en Niubiz a mano); `pagoEstado`
  (pendiente, aprobado, denegado, anulado, cobrado_sin_cita, incierto, rechazado, sin_sesion, medio_no_soportado). `pagoReferencia` = pedido de Niubiz (secuencia
  `reservas_web_numero_compra_seq`). `horasLibres` descuenta lo apartado (`esperando_pago` vigente o `autorizando`); un intento nuevo del mismo documento reemplaza sus apartados.
  Config en `agenda.env`: `NIUBIZ_HABILITADO=1`, `NIUBIZ_ENTORNO` (sandbox|produccion), `NIUBIZ_MERCHANT_ID/USUARIO/CLAVE`, `NIUBIZ_LIQUIDACION` (automatica|manual),
  `RESERVA_WEB_PAGO` (opcional|obligatorio), `RESERVA_WEB_URL_PUBLICA` (https público para el retorno), `NIUBIZ_URL_API`/`NIUBIZ_CHECKOUT_JS` (solo pruebas). El chat de
  WhatsApp NO usa este flujo. Probar sin Niubiz: `node apps/api/scripts/niubiz-simulado.cjs 4010` + `NIUBIZ_URL_API=http://localhost:4010`. Tests: `__tests__/niubiz-cliente`, `pago-retorno`.
- **Integraciones del chat de WhatsApp (13-nov-2026, pedidas por el equipo de Ana)** — solo `/integraciones/whatsapp`; cada una APAGADA si falta su
  config, que vive SOLO en el `agenda.env` del servidor (la carga «Integraciones (WooCommerce y GHL).bat» → `herramientas/integraciones.ps1`, a ciegas;
  NUNCA en `.env.example`, el repo ni el paquete):
  - **Cupos**: `GET /horas` trae `cupos` (hora → pacientes que caben a la vez; `horasConCupos` en `reservaWebService.ts`).
  - **Pago previo de SÁBADO y DOMINGO por WooCommerce** (`WOO_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`, `WOO_WEBHOOK_SECRET`): `woocommerce.ts`
    (cliente REST + firma HMAC del webhook) y `pagoPrevio.ts`. `POST /` crea pedido → cita (pago pendiente) → reserva `esperando_pago`
    (`pasarela='woocommerce'`, 10 min, enlace en `pago`). Aviso `POST /api/v1/publico/pagos/woo` (`routes/pagoWoo.ts`, ANTES de `express.json`,
    firma `X-WC-Webhook-Signature`, sin secretos en la URL) → se RELEE el pedido → `confirmada` + `pagoEstado='aprobado'` (mismo valor que Niubiz,
    así valen `PAGADA_EN_LINEA` y `pagado`) + `PATCH /citas/:id/pago`. Vencida sin pagar → `mantenimientoPagoPrevio` cancela cita y pedido
    (`expirada`); pagó tarde o sin cita → `reembolsar`. Hacia el chat `pagoEstado` sale `pagado` (no `aprobado`), como en la nota del equipo de Ana. Estas reservas NO cuentan como «apartadas» en `horasLibres` (su cita ya ocupa la hora) ni
    las cierra `mantenimientoReservasWeb`. Reprogramar por WhatsApp: con pago pendiente no (`PAGO_PENDIENTE`); sin pagar a sáb/dom no
    (`PAGO_PREVIO_REQUERIDO`). La misma `referencia` devuelve la reserva en cualquier estado. **Feriados (18-nov-2026)**: cuentan como sáb/dom
    (`esFeriado` / `exigePagoPrevio` en `woocommerce.ts`: fijos de Perú + Jueves/Viernes Santo + `FERIADOS_EXTRA=AAAA-MM-DD,…` del agenda.env).
  - **Reportes del chat (18-nov-2026, solo API, permiso `analytics.ver`)**: `GET /reportes/embudo-ana?desde&hasta[&sedeId]` (`embudoAnaService.ts`;
    «por Ana» = cita enlazada a una reserva `whatsapp`; «pagaron» = `pagoEstado` aprobado/monto_distinto, NO `pagado`) y
    `GET /reportes/sin-retorno?dias=90[&sedeId]` (`sinRetornoService.ts`, rangos 1-7…32+). Tests: `embudo-ana`, `sin-retorno`, `pago-feriados`.
  - **Aviso 2 h antes** (`GHL_AVISO_WEBHOOK_URL`): `services/avisoWhatsappService.ts`, cada minuto, POST a un flujo de GHL con la hora ACTUAL
    de la cita; una vez por reserva (`reservas_web.avisoWhatsappEn`, migración `20261112120000_aviso_whatsapp_reserva`, copiada IDÉNTICA a la
    del paquete del equipo de Ana para que su huella coincida).
  - Probar: `node apps/api/scripts/woo-simulado.cjs 4020` (+ `WOO_URL=http://localhost:4020`, `ck_prueba`/`cs_prueba`, `WOO_SIM_SECRETO` =
    `WOO_WEBHOOK_SECRET`, `WOO_SIM_AVISO`; GHL simulado en `/_ghl`). Tests: `__tests__/pago-previo-woo`, `reserva-gestion-chat`.
- TypeScript estricto en todo el proyecto
- Errores API: `{ error: string, code?: string }` via `AppError` en `middleware/errorHandler.ts`
- Fechas: UTC en DB, convertir a America/Lima en frontend

## Autenticación
- JWT, expiración 30d (dev), guardado via Zustand `persist` en localStorage como `limablue-auth`
- El token se incluye automáticamente en todas las peticiones desde `apps/web/src/api/client.ts`
- **Usuario admin**: `admin@limablue.pe` / `Admin1234!` (rol: `admin`)
- Roles en DB: `admin`, `coordinadora_sedes`, `recepcionista` (enum `RolUsuario`)
- Middleware: `requireAuth`, `requireRol(...roles)`, `requireScope(scope)` en `middleware/auth.ts`
- **Permisos de ESTADO de la cita (11-nov-2026)**, catálogo en `permisos.ts` y switches en Administración › Roles: `citas.estado` (botones del flujo),
  `citas.revertir` (desplegable, pero con la máquina de estados), `citas.estado_libre` (desplegable con TODOS los estados = el poder que antes tenía solo el
  rol admin; `forzar` sigue siendo solo admin), `citas.noshow_llego` (recepción) y `citas.noshow_agendada` (contact center / especial contact): botón suelto
  en una cita en «No show» que la pasa a «Llegó» / «Agendada» y nada más (`puedeRescatarNoShow` en `estadoCitaService.ts`; queda `rescateNoShow` en la auditoría).
  Migración `20261111120000_permisos_estado_no_show` (data). El rol `admin` no se edita por API: todo permiso nuevo se le otorga por migración.
  La auditoría (`auditoria.ver`) es un permiso independiente: lo tienen admin y coordinadora; cualquier otro rol lo recibe encendiéndolo en Roles.
- **Llave de SOLO LECTURA (21-nov-2026)**: permiso `profesionales:read` (prefijo `lbro_`), se crea con «Llaves API (web y WhatsApp).bat» › 5
  (6 la desactiva; `reserva-servicios.js llave-lectura`). Candado en `requireAuth` (`lecturaPermitida` en `middleware/auth.ts`): solo GET
  `/api/v1/profesionales` y `/api/v1/sedes`; cualquier otra ruta o método → 403 `SOLO_LECTURA`. Las demás llaves no cambian. Tests: `llave-lectura`.
- **El rol se lee de la BD en cada request** (`requireAuth` y el socket), NO del token: el JWT dura hasta 30 días y un cambio de rol
  (ascenso a admin, o quitarle permisos) debe aplicar al instante. Antes `/auth/me` usaba el de la BD y el resto el del token → la pantalla
  ofrecía la Auditoría y el API respondía 403 (lista vacía). Corregido 11-nov-2026.
- **N.º de cita** (11-nov-2026): `citas.numero`, correlativo (`citas_numero_seq`, índice único `citas_numero_key`, ambos en el schema), se
  muestra como «C-000123» con `formatoNumeroCita` de `@limablue/shared` (reconstruir `packages/shared` si lo tocas). Lo recibe TODA cita al crearse;
  las existentes se numeraron por `creadoEn` en `20261111130000_numero_cita`. Sale en el detalle de la cita, en los correos de reserva y recordatorio,
  y como `numeroCita` en la API del chat / reserva web. No confundir con el `codigo` «LB-…», que es de la RESERVA web/chat, no de la cita.
  Puede tener huecos (una creación que falla consume el número): es normal en una secuencia.

## Migraciones de base de datos (Prisma Migrate — NO `db push`)
- **REGLA DEL DUEÑO (12-nov-2026): migraciones solo cuando sean ESTRICTAMENTE necesarias.**
  - Primero resolver sin tocar la base (código, columnas/tablas que ya existen, cálculo al vuelo). Si de verdad hace falta (o es
    claramente lo más conveniente), se crea sin pedir permiso previo, pero se informa al entregar: qué toca y cuántas filas reescribe.
  - **NO** `ALTER COLUMN`, renombrar, cambiar tipos ni reestructurar campos existentes, salvo que el dueño lo pida.
  - **NO** reescribir datos masivos (UPDATE de toda una tabla) si se puede evitar.
  - Una sola migración por entrega (agrupar), no una por cada cambio pequeño.
  - **Nunca editar ni fusionar una migración ya creada/commiteada**: el servidor guarda su huella y `migrate deploy` fallaría.
- **Flujo correcto:** en local `prisma migrate dev` genera migraciones versionadas en
  `apps/api/prisma/migrations/`; en producción `npm run db:migrate:prod` (= `prisma migrate deploy`)
  las aplica. **NUNCA `db push` en producción.**
- **Estructura va en migraciones, NO en `seed.ts`.** El seed es SOLO datos (sedes, roles,
  profesionales). Los índices/constraints viven en las migraciones.
- **Índices únicos PARCIALES** (con `WHERE`): Prisma no los representa en el schema, así que
  viven como SQL crudo dentro de las migraciones. Son 16 únicos parciales (verificados contra `pg_indexes`):
  - En la baseline (`00000000000000_baseline/migration.sql`): `recordatorios_cita_unico`,
    `asignaciones_sede_una_abierta`, `pacientes_documento_unico`, `citas_idempotency_unico`.
  - En `20260624120000_bloques_combinados`: `citas_slot_primario_unique` y
    `citas_slot_secundario_unique` (reemplazan al antiguo `citas_slot_activo_unique` de la
    baseline, que ya NO existe en la BD), más `combinaciones_servicio_unico`.
  - En `20260625230000_promociones`: `promociones_nombre_unico`.
  - En `20260705193100_modulo_sesiones`: `consumos_cita_unico` (máx 1 consumo vivo por cita).
  - En `20260908120000_historia_clinica_receta`: `diagnosticos_principal_unico` (máx 1 diagnóstico
    principal vigente por atención clínica).
  - En `20260909120000_podograma_vista`: `imagenes_podograma_vista_unica` (máx 1 imagen VIVA del
    podograma por atención y vista: frontal/posterior × izquierdo/derecho).
  - En `20260914120000_tiempos_tratamiento` (aparato del consultorio, botones INICIO/FIN):
    `dispositivos_consultorio_unico` (máx 1 aparato activo por sede + unidad + consultorio),
    `tiempos_en_curso_consultorio_unico` (máx 1 tiempo en curso por consultorio) y
    `tiempos_cita_vigente_unico` (máx 1 tiempo no descartado por cita).
  - En `20261029120000_reservas_web_directas` (reserva web sin pasarela): `reservas_web_referencia_unica` (canal + referenciaExterna:
    un reintento del chat de WhatsApp no crea otra cita).
  - En `20261110120000_niubiz_numero_compra` (pago en línea): `reservas_web_numero_compra_unico` (`pagoReferencia` único cuando `pasarela = 'niubiz'`:
    un pedido de Niubiz no se repite) y la secuencia `reservas_web_numero_compra_seq`.
  - Además, índices **GIN pg_trgm** (no únicos, tampoco en el schema) en
    `20260903120000_catalogos_hce_cie10_medicamento`: `cie10_descripcion_trgm`,
    `medicamentos_dci_trgm`, `medicamentos_comercial_trgm`; y en
    `20261023190000_busqueda_pacientes_trgm` (búsqueda de pacientes): `pacientes_nombre_completo_trgm`,
    `pacientes_documento_trgm`, `pacientes_telefono_trgm`.
  - Y un índice **parcial no único** `audit_logs_mover_cita_idx` (`"citaId" WHERE accion = 'mover'`) en
    `20261106120000_indice_audit_mover`: acelera las reprogramaciones del paciente (`services/alertaPaciente.ts`),
    que corren en cada carga de la agenda y en cada búsqueda. Tampoco está en el schema: no lo dejes caer en `migrate dev`.

  Como NO están en `schema.prisma`, al correr `migrate dev` Prisma intentará "dropearlos" en la
  migración generada → **revisa el SQL generado y borra cualquier `DROP INDEX` de esos** (o
  genera la migración con
  `prisma migrate diff --from-schema-datamodel <viejo> --to-schema-datamodel <nuevo> --script`,
  que no los toca). `prisma migrate status` debe quedar siempre "up to date".

## Modelos Prisma principales
- `Usuario` (id, nombre, email, passwordHash, rol, activo, deletedAt, sedes[])
- `Sede`, `UnidadNegocio`, `Profesional`, `Paciente`, `Cita`, `Servicio`, `Paquete`
- `UsuarioSede` (tabla de unión usuario ↔ sede)
- `ApiKey`, `AuditLog`, `WebhookSubscription`
- `ComentarioCita` — hilo **append-only** de comentarios de una cita (id, citaId, autorId?,
  autorEtiqueta, texto, creadoEn, deletedAt). Cada comentario es una ENTRADA inmutable; el
  endpoint `PATCH /citas/:id/comentario` AGREGA (no reemplaza). La cita ya NO tiene columnas
  `comentarioRecepcion`/`comentarioProfesional` (eliminadas). `getCitaCompleta` y `GET /citas`
  incluyen `comentarios` (orden cronológico, con `autor`).

## Estructura
```
apps/
  api/src/
    index.ts         ← servidor Express principal
    db.ts            ← instancia PrismaClient
    middleware/auth.ts, errorHandler.ts
    routes/          ← auth, citas, pacientes, profesionales, sedes, etc.
  web/src/
    App.tsx          ← router principal
    api/             ← client.ts + módulos por entidad
    stores/authStore.ts
    components/layout/  ← Layout, Sidebar
    pages/           ← LoginPage, AgendaPage, AdminPage, etc.
packages/shared/     ← tipos TypeScript compartidos
```

## Reglas críticas
- Anti-doble-booking: índices únicos parciales en DB `citas_slot_primario_unique` + `citas_slot_secundario_unique` (profesionalId, fecha, horaInicio) — máx 1 primario + 1 secundario por slot (bloques combinados)
- Soft delete en todos los modelos (`deletedAt`, `activo`)
- Un SUPER_ADMIN/admin no puede desactivarse a sí mismo
- Drag & drop para reprogramar citas entre especialistas
- **«Solo X» en Podología (21-nov-2026)**: hacer clic en la columna de una podóloga la ELIGE, pero la cita solo queda «Solo X»
  (`origenAsignacion = 'elegida_por_paciente'`) si recepción marca «El paciente pidió a …» en Nueva Cita (`pedidaPorPaciente` en POST /citas
  y /citas/combinada; sin el campo = como antes, elegida = pedida). Se corrige luego con `PATCH /citas/:id/pedida-por-paciente` (bloque entero,
  solo `preferencia_opcional`; audit `editar_preferencia_profesional`). Fisioterapia y Baropodometría no cambian.
- **Cambiar tratamiento en cita doble (13-nov-2026)**: `PATCH /citas/:id/tratamiento` cambia UNA mitad (`cambiarTratamientoBloque` en `routes/citas.ts`).
  Reglas en `services/tratamientoBloque.ts`: 2.º servicio = extra activo de `combinaciones_permitidas` para el ancla de la PRINCIPAL (fila con
  `servicioAnclaId` null = ancla global); 1.er servicio = un ancla que permita el 2.º actual y de la MISMA duración (con una sola ancla: solo cambia su tipo).
  Precio del bloque (1.º + 2.º) y promo en la PRINCIPAL; sesión de esa mitad no descontada y cubierta por su membresía. Opciones para la pantalla:
  `GET /citas/:id/tratamiento/opciones` (ya filtradas por el profesional de esa mitad). Tests: `__tests__/tratamiento-bloque`.
