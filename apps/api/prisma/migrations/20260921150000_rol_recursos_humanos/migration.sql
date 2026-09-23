-- Migración de DATOS (idempotente) — Rol «Recursos Humanos» y permiso `ausencias.gestionar` (21-sep-2026).
-- RR. HH. registra las ausencias del personal (permisos, vacaciones, descansos médicos) en cualquier sede y ve la
-- agenda en solo lectura para comprobar el bloqueo. No agenda, no ve pacientes ni historia clínica, no toca horarios.
INSERT INTO roles (id, nombre, label, descripcion, permisos, "esSistema", "creadoEn", "actualizadoEn")
SELECT gen_random_uuid(), 'recursos_humanos', 'Recursos Humanos', 'Registra permisos, vacaciones y descansos médicos; ve la agenda en solo lectura',
       ARRAY['citas.ver','horarios.ver','ausencias.gestionar'], false, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'recursos_humanos');

-- Quien ya gestiona horarios (admin, coordinación y cualquier rol a medida con `horarios.editar`) recibe también el
-- permiso nuevo, para que la matriz de Administración › Roles quede completa.
UPDATE roles SET permisos = array_append(permisos, 'ausencias.gestionar'), "actualizadoEn" = now()
 WHERE 'horarios.editar' = ANY(permisos) AND NOT ('ausencias.gestionar' = ANY(permisos));
