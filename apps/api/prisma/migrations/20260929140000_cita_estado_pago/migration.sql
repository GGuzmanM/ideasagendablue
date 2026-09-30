-- Estado de pago de la cita (29-sep-2026): Pendiente de pago / Pago incompleto / Pago completo. Reemplaza al sí/no
-- de `pagada`, que se mantiene sincronizado (= completo) para los reportes que ya lo usan. Agregar la columna con valor
-- por defecto es instantáneo en PostgreSQL; las citas ya marcadas como pagadas pasan a «completo».

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('pendiente', 'incompleto', 'completo');

-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "estadoPago" "EstadoPago" NOT NULL DEFAULT 'pendiente';

-- Datos: lo ya marcado como pagado → pago completo
UPDATE "citas" SET "estadoPago" = 'completo' WHERE "pagada" = true;
