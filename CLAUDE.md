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
  (`routes/reservaChat.ts`, `/api/v1/integraciones/reservas`, llave con scope `reservas:write`; docs/API-RESERVAS-WHATSAPP.md). Documento DNI o CE
  (`services/reservaWeb/validaciones.ts`). La cita se crea con POST /citas usando la llave interna `RESERVA_WEB_API_KEY`.
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
- TypeScript estricto en todo el proyecto
- Errores API: `{ error: string, code?: string }` via `AppError` en `middleware/errorHandler.ts`
- Fechas: UTC en DB, convertir a America/Lima en frontend

## Autenticación
- JWT, expiración 30d (dev), guardado via Zustand `persist` en localStorage como `limablue-auth`
- El token se incluye automáticamente en todas las peticiones desde `apps/web/src/api/client.ts`
- **Usuario admin**: `admin@limablue.pe` / `Admin1234!` (rol: `admin`)
- Roles en DB: `admin`, `coordinadora_sedes`, `recepcionista` (enum `RolUsuario`)
- Middleware: `requireAuth`, `requireRol(...roles)`, `requireScope(scope)` en `middleware/auth.ts`

## Migraciones de base de datos (Prisma Migrate — NO `db push`)
- **Flujo correcto:** en local `prisma migrate dev` genera migraciones versionadas en
  `apps/api/prisma/migrations/`; en producción `npm run db:migrate:prod` (= `prisma migrate deploy`)
  las aplica. **NUNCA `db push` en producción.**
- **Estructura va en migraciones, NO en `seed.ts`.** El seed es SOLO datos (sedes, roles,
  profesionales). Los índices/constraints viven en las migraciones.
- **Índices únicos PARCIALES** (con `WHERE`): Prisma no los representa en el schema, así que
  viven como SQL crudo dentro de las migraciones. Son 15 (verificados contra `pg_indexes`):
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
