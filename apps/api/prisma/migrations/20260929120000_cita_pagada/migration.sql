-- Cita PAGADA (29-sep-2026): recepción valida si la cita ya está pagada (para reportes). Solo agrega columnas
-- con valor por defecto (instantáneo en PostgreSQL, no reescribe la tabla); el sistema anterior las ignora.

-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "pagada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pagadaEn" TIMESTAMP(3),
ADD COLUMN     "pagadaPorId" UUID;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_pagadaPorId_fkey" FOREIGN KEY ("pagadaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
