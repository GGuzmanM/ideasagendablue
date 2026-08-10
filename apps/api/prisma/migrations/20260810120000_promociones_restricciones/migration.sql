-- Fase 1 de Promociones: nuevo tipo de beneficio + restricciones + snapshot de precio en la cita.
-- Escrita a mano (política del proyecto: NO `migrate dev`) para no tocar los índices únicos
-- parciales. Solo agrega un valor de enum y columnas nullable → seguro e idempotente.

-- Nuevo tipo de beneficio: monto fijo de descuento (S/ X menos). PG12+ permite ADD VALUE en
-- transacción siempre que no se USE el valor en la misma migración (no lo usamos aquí).
ALTER TYPE "TipoPromocion" ADD VALUE IF NOT EXISTS 'MONTO_DESCUENTO';

-- Restricciones configurables de la promoción (todas nullable: null = sin restricción).
ALTER TABLE "promociones"
  ADD COLUMN IF NOT EXISTS "serviciosIds"        JSONB,
  ADD COLUMN IF NOT EXISTS "sedesIds"            JSONB,
  ADD COLUMN IF NOT EXISTS "canales"             JSONB,
  ADD COLUMN IF NOT EXISTS "vigenciaInicio"      DATE,
  ADD COLUMN IF NOT EXISTS "vigenciaFin"         DATE,
  ADD COLUMN IF NOT EXISTS "diasSemana"          JSONB,
  ADD COLUMN IF NOT EXISTS "codigo"              TEXT,
  ADD COLUMN IF NOT EXISTS "soloPacientesNuevos" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cupoTotal"           INTEGER,
  ADD COLUMN IF NOT EXISTS "limitePorPaciente"   INTEGER;

-- Snapshot de precio/descuento al agendar (caja/reportes).
ALTER TABLE "citas"
  ADD COLUMN IF NOT EXISTS "precioLista"    DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "montoDescuento" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "montoFinal"     DECIMAL(10,2);
