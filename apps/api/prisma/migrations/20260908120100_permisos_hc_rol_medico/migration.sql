-- Migración de DATOS (idempotente): permisos de Historia Clínica / Receta sobre roles EXISTENTES
-- (el seed usa skipDuplicates y el rol admin no se edita por API → esta es la única vía en una BD
-- ya sembrada). Sentinela: 'hc.ver' presente = ya aplicado.
UPDATE roles
   SET permisos = array_cat(permisos, ARRAY['hc.ver','hc.registrar','hc.anular','receta.ver']),
       "actualizadoEn" = now()
 WHERE nombre IN ('admin','coordinadora_sedes') AND NOT ('hc.ver' = ANY(permisos));

UPDATE roles
   SET permisos = array_cat(permisos, ARRAY['hc.ver','hc.registrar','receta.ver']),
       "actualizadoEn" = now()
 WHERE nombre = 'recepcionista' AND NOT ('hc.ver' = ANY(permisos));

-- contact_center: sin acceso clínico (a propósito).

-- Rol MÉDICO: el ÚNICO con receta.emitir. Requiere además Usuario.profesionalId → Profesional
-- tipo=medico, !esEquipo y colegiatura cargada (candado en el servicio).
INSERT INTO roles (nombre, label, descripcion, permisos, "esSistema", "actualizadoEn")
VALUES ('medico', 'Médico', 'Médico colegiado: registra historia clínica y emite recetas',
        ARRAY['citas.ver','pacientes.ver','hc.ver','hc.registrar','receta.ver','receta.emitir'],
        false, now())
ON CONFLICT (nombre) DO NOTHING;

-- Equipos de baropodometría registrados como Profesional tipo=medico: no son personas.
UPDATE profesionales SET "esEquipo" = true
 WHERE tipo = 'medico' AND nombres ILIKE 'Baro %' AND "esEquipo" = false;
