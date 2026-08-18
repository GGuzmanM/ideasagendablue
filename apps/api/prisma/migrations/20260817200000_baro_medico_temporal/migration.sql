-- Asignación TEMPORAL del doctor a la baro de una sede (independiente de su sede general):
-- rango de fechas + motivo, para poder cambiarla por día/mes como los movimientos de personal.
-- (SQL verificado con `prisma migrate diff` — solo estas 3 columnas, no toca índices parciales.)
ALTER TABLE "baro_medico_sede" ADD COLUMN     "fechaFin" TIMESTAMP(3),
ADD COLUMN     "fechaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "motivo" "MotivoMovimiento";

-- Backfill: las asignaciones existentes rigen desde su creación (así siguen activas para
-- fechas actuales, no solo desde el instante de la migración).
UPDATE "baro_medico_sede" SET "fechaInicio" = "creadoEn";
