-- 26-oct-2026: eliminar constancias (solo administración). Borrado LÓGICO: la fila se conserva con quién y por qué la eliminó;
-- deja de verse en la historia, en los PDF y en la verificación pública, y la acción queda en la auditoría.
-- Solo agrega columnas opcionales: no bloquea ni reescribe la tabla.
ALTER TABLE "constancias_clinicas"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eliminadaPorUsuarioId" UUID,
  ADD COLUMN IF NOT EXISTS "motivoEliminacion" TEXT;
