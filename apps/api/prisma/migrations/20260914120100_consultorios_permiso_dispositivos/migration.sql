-- Migración de DATOS (idempotente) para el aparato del consultorio.
--
-- 1) Nº de consultorios por sede: antes vivía duplicado en el front (idea1DetalleCitaService.ts y
--    PopoverCita.tsx). Solo se carga donde sigue en 0 (no pisa un valor ya editado).
UPDATE sedes SET consultorios = v.n, "actualizadoEn" = now()
  FROM (VALUES ('Los Olivos', 6), ('San Miguel', 4), ('Lince', 9), ('Paz Soldán', 11), ('One', 5)) AS v(nombre, n)
 WHERE sedes.nombre = v.nombre AND sedes.consultorios = 0;

-- 2) Permiso nuevo `dispositivos.gestionar` (registrar aparatos, ver su token, regenerarlo o
--    revocarlo) para admin y coordinadora. El rol admin no se edita por API → esta es la vía.
UPDATE roles
   SET permisos = array_append(permisos, 'dispositivos.gestionar'),
       "actualizadoEn" = now()
 WHERE nombre IN ('admin', 'coordinadora_sedes') AND NOT ('dispositivos.gestionar' = ANY(permisos));
