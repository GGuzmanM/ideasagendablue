-- 11-nov-2026: permisos nuevos para cambiar el ESTADO de una cita sin ser administrador.
--   citas.estado_libre     = pasar la cita a CUALQUIER estado desde el desplegable (lo que solo hacía el rol admin).
--   citas.noshow_llego     = en una cita en «No show», botón para pasarla a «Llegó» (recepción).
--   citas.noshow_agendada  = en una cita en «No show», botón para pasarla a «Agendada» (contact center y especial contact).
-- `admin` recibe los tres (su rol no se edita por API: esta es la vía). `estado_libre` queda APAGADO para el resto; se enciende
-- desde Administración › Roles. Idempotente.
UPDATE roles
   SET permisos = permisos || ARRAY(SELECT p FROM unnest(ARRAY['citas.estado_libre','citas.noshow_llego','citas.noshow_agendada']) AS p WHERE NOT (p = ANY(permisos))),
       "actualizadoEn" = now()
 WHERE nombre = 'admin';

UPDATE roles
   SET permisos = array_append(permisos, 'citas.noshow_llego'), "actualizadoEn" = now()
 WHERE nombre = 'recepcionista' AND NOT ('citas.noshow_llego' = ANY(permisos));

UPDATE roles
   SET permisos = array_append(permisos, 'citas.noshow_agendada'), "actualizadoEn" = now()
 WHERE nombre IN ('contact_center', 'especial_contact') AND NOT ('citas.noshow_agendada' = ANY(permisos));
