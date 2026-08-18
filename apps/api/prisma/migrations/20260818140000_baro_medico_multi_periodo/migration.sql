-- Permite VARIOS periodos de un doctor en la misma sede a lo largo del tiempo (histórico).
-- La regla "1 sede por día" se aplica en la lógica (no se solapan periodos), no con un unique.

-- DropIndex: ya no limitamos a un registro por (profesional, sede).
DROP INDEX IF EXISTS "baro_medico_sede_profesionalId_sedeId_key";

-- CreateIndex: índice de apoyo para buscar los periodos de un profesional.
CREATE INDEX IF NOT EXISTS "baro_medico_sede_profesionalId_activa_idx"
  ON "baro_medico_sede" ("profesionalId", "activa");
