-- Migración de DATOS (idempotente) — Médico de la cita y receta médica (18-sep-2026).
--  · receta_medica.ver: ver e imprimir la RECETA MÉDICA → admin, coordinación y médico. Recepción
--    conserva receta.ver (indicaciones podológicas) pero deja de ver la receta médica.
--  · receta.emitir: además del médico, admin y coordinación (la receta sale a nombre del médico
--    de la cita; el candado vive en recetaService).
--  · medico.asignar (admin, coordinación) y medico.autoasignar (médico).
-- Cada UPDATE agrega solo lo que falta (array sin duplicados) → se puede correr dos veces.

UPDATE roles
   SET permisos = ARRAY(SELECT DISTINCT unnest(permisos || ARRAY['receta_medica.ver','receta.emitir','medico.asignar'])),
       "actualizadoEn" = now()
 WHERE nombre IN ('admin','coordinadora_sedes')
   AND NOT (permisos @> ARRAY['receta_medica.ver','receta.emitir','medico.asignar']);

UPDATE roles
   SET permisos = ARRAY(SELECT DISTINCT unnest(permisos || ARRAY['receta_medica.ver','medico.autoasignar'])),
       "actualizadoEn" = now()
 WHERE nombre = 'medico'
   AND NOT (permisos @> ARRAY['receta_medica.ver','medico.autoasignar']);
