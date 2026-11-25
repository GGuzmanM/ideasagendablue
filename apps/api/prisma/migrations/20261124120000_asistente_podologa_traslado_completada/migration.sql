-- 24-nov-2026 (una sola migración para la entrega):
--  1) Nuevo tipo de profesional «asistente_podologa»: hace lo mismo que una podóloga (mismos servicios, horarios y reportes) y en
--     la agenda va después de las podólogas. Solo AGREGA un valor a la lista: no reescribe filas ni cambia columnas.
ALTER TYPE "TipoProfesional" ADD VALUE IF NOT EXISTS 'asistente_podologa';

--  2) Permiso nuevo «citas.trasladar_completada» (pasar una cita COMPLETADA a otra profesional en su mismo día y hora; la historia
--     clínica se queda con quien la registró). Lo reciben admin (su rol no se edita por API), recepcionista y coordinadora_sedes.
--     Idempotente: solo toca esos 3 roles y solo si aún no lo tienen.
UPDATE roles
   SET permisos = array_append(permisos, 'citas.trasladar_completada'), "actualizadoEn" = now()
 WHERE nombre IN ('admin', 'recepcionista', 'coordinadora_sedes') AND NOT ('citas.trasladar_completada' = ANY(permisos));
