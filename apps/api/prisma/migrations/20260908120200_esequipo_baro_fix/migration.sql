-- Corrige el backfill de equipos Baro: en la BD real están guardados como nombres='Baro', apellidos='1'/'2'
-- (el patrón 'Baro %' de la migración anterior no coincidía). Idempotente.
UPDATE profesionales SET "esEquipo" = true
 WHERE tipo = 'medico'
   AND (nombres ILIKE 'baro' OR nombres ILIKE 'baro %')
   AND "esEquipo" = false;
