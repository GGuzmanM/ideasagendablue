-- Migración de DATOS (idempotente) — sincroniza los roles del sistema con src/permisos.ts.
--
-- PROBLEMA QUE RESUELVE
-- El seed siembra los roles con `createMany({ skipDuplicates: true })`, así que en una base que
-- YA existía los roles nunca se actualizaron. Quedaron con el esquema de nombres VIEJO
-- (`agenda.ver`, `agenda.editar`, `admin.ver`, `herramientas.operativas`,
-- `herramientas.estrategicas`) que ningún candado del código reconoce: `requirePermiso()` hace
-- un `includes()` exacto y NO tiene bypass para admin, y el front usa `tiene('citas.crear')`.
-- Resultado: el usuario admin se queda sin acceso a nada (agenda en "Solo lectura", sin botón
-- Nueva Cita, 403 en Administración). Volver a correr `npm run db:seed` NO lo arregla.
--
-- CRITERIO (quirúrgico, para no pisar configuraciones hechas a mano)
-- Cada UPDATE actúa SOLO si el rol todavía contiene algún permiso del esquema viejo (`&&` =
-- "se solapa con"). Un rol que ya fue corregido —o que un admin personalizó desde
-- Administración › Roles con permisos válidos— NO se toca. Por eso es seguro correrla dos veces.
--
-- Los arreglos de abajo se generaron desde ROLES_SISTEMA (src/permisos.ts) el 20-09-2026.
-- `medico` y `podologa` no aparecen: ya nacieron correctos de sus propias migraciones de datos.
-- Si en el futuro cambia la matriz de permisos, la verificación es: npm run auditar:permisos

-- admin — 43 permisos (todos menos medico.autoasignar, que es exclusivo del médico)
UPDATE roles
   SET permisos = ARRAY['hc.ver','hc.registrar','hc.anular','receta.ver','receta_medica.ver','receta.emitir','medico.asignar','citas.ver','citas.crear','citas.reprogramar','citas.cancelar','citas.estado','citas.revertir','pacientes.ver','pacientes.crear','pacientes.editar','membresias.ver','membresias.vender','membresias.consumir','membresias.gestionar','promociones.ver','promociones.gestionar','movimientos.ver','movimientos.editar','horarios.ver','horarios.editar','profesionales.ver','profesionales.editar','competencias.editar','servicios.ver','servicios.editar','analytics.ver','analytics.agentes','exportar.usar','comunicaciones.gestionar','canales.gestionar','usuarios.ver','usuarios.editar','roles.editar','auditoria.ver','notificaciones.ver','config.editar','dispositivos.gestionar'],
       "actualizadoEn" = now()
 WHERE nombre = 'admin'
   AND permisos && ARRAY['agenda.ver','agenda.editar','admin.ver','herramientas.operativas','herramientas.estrategicas'];

-- coordinadora_sedes — 39 permisos
UPDATE roles
   SET permisos = ARRAY['citas.ver','citas.crear','citas.reprogramar','citas.cancelar','citas.estado','citas.revertir','pacientes.ver','pacientes.crear','pacientes.editar','membresias.ver','membresias.vender','membresias.consumir','membresias.gestionar','promociones.ver','promociones.gestionar','movimientos.ver','movimientos.editar','horarios.ver','horarios.editar','profesionales.ver','profesionales.editar','competencias.editar','servicios.ver','servicios.editar','analytics.ver','analytics.agentes','exportar.usar','comunicaciones.gestionar','canales.gestionar','notificaciones.ver','auditoria.ver','hc.ver','hc.registrar','receta.ver','hc.anular','receta_medica.ver','receta.emitir','medico.asignar','dispositivos.gestionar'],
       "actualizadoEn" = now()
 WHERE nombre = 'coordinadora_sedes'
   AND permisos && ARRAY['agenda.ver','agenda.editar','admin.ver','herramientas.operativas','herramientas.estrategicas'];

-- recepcionista — 16 permisos
UPDATE roles
   SET permisos = ARRAY['citas.ver','citas.crear','citas.reprogramar','citas.cancelar','citas.estado','pacientes.ver','pacientes.crear','pacientes.editar','membresias.ver','membresias.vender','membresias.consumir','exportar.usar','comunicaciones.gestionar','hc.ver','hc.registrar','receta.ver'],
       "actualizadoEn" = now()
 WHERE nombre = 'recepcionista'
   AND permisos && ARRAY['agenda.ver','agenda.editar','admin.ver','herramientas.operativas','herramientas.estrategicas'];

-- contact_center — 10 permisos
UPDATE roles
   SET permisos = ARRAY['citas.ver','citas.crear','citas.reprogramar','citas.cancelar','citas.estado','pacientes.ver','pacientes.crear','pacientes.editar','membresias.ver','membresias.vender'],
       "actualizadoEn" = now()
 WHERE nombre = 'contact_center'
   AND permisos && ARRAY['agenda.ver','agenda.editar','admin.ver','herramientas.operativas','herramientas.estrategicas'];
