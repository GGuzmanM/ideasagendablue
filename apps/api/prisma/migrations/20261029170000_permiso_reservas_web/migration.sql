-- 29-oct-2026: permiso nuevo `reservas_web.ver` = ver «Reservas web» en el menú (seguimiento de quién empezó a reservar por
-- internet y contactarlo). Hasta hoy lo veía cualquiera que agendara (citas.crear); ahora queda APAGADO para todos los roles
-- y se enciende desde Administración › Roles cuando la clínica quiera. Solo se otorga a `admin` (acceso total; su rol no se
-- edita por API, esta es la vía). Idempotente.
UPDATE roles
   SET permisos = array_append(permisos, 'reservas_web.ver'),
       "actualizadoEn" = now()
 WHERE nombre = 'admin' AND NOT ('reservas_web.ver' = ANY(permisos));
