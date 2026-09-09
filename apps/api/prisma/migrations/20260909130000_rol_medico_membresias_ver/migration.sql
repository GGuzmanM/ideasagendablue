-- Migración de DATOS (idempotente): el rol médico ve (solo lectura) las membresías/paquetes del
-- paciente, útil para las sesiones de láser en la historia clínica. Acceso final del médico:
-- citas.ver, pacientes.ver, membresias.ver, hc.ver, hc.registrar, receta.ver, receta.emitir.
-- Sentinela: 'membresias.ver' presente = ya aplicado.
UPDATE roles
   SET permisos = array_cat(permisos, ARRAY['membresias.ver']),
       "actualizadoEn" = now()
 WHERE nombre = 'medico' AND NOT ('membresias.ver' = ANY(permisos));
