-- Migración de DATOS (idempotente) — Rol «Especial Contact» (23-sep-2026).
-- Contact center con más manejo: todo lo del contact center (agenda, pacientes, venta de membresías, todas las
-- sedes) MÁS Horarios y Restricciones completo (horarios base y excepciones, almuerzos, permisos, vacaciones,
-- enfermedad, reunión). Sin acceso clínico ni a administración. Editable desde Administración › Roles.
INSERT INTO roles (id, nombre, label, descripcion, permisos, "esSistema", "creadoEn", "actualizadoEn")
SELECT gen_random_uuid(), 'especial_contact', 'Especial Contact',
       'Contact center con gestión completa de Horarios y Restricciones (todas las sedes)',
       ARRAY['citas.ver','citas.crear','citas.reprogramar','citas.cancelar','citas.estado',
             'pacientes.ver','pacientes.crear','pacientes.editar',
             'membresias.ver','membresias.vender',
             'horarios.ver','horarios.editar','ausencias.gestionar'],
       false, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'especial_contact');
