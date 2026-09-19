-- Migración de DATOS (idempotente) — Rol «Podóloga» (19-sep-2026).
-- Usuario para las podólogas: al crearlo desde Administración › Usuarios se crea también su ficha
-- (aparece en Movimientos y en la agenda). Arranca con lo mínimo: ver la agenda de su sede, solo
-- lectura. Sin historia clínica ni recetas; los permisos se amplían en Administración › Roles.
INSERT INTO roles (id, nombre, label, descripcion, permisos, "esSistema", "creadoEn", "actualizadoEn")
SELECT gen_random_uuid(), 'podologa', 'Podóloga', 'Ve la agenda de su sede (solo lectura)', ARRAY['citas.ver'], false, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'podologa');
