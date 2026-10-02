-- Comentarios editables (30-sep-2026): quién y cuándo editó. Solo aditivo.
-- AlterTable
ALTER TABLE "comentarios_cita" ADD COLUMN     "editadoEn" TIMESTAMP(3),
ADD COLUMN     "editadoPorId" UUID;

-- AddForeignKey
ALTER TABLE "comentarios_cita" ADD CONSTRAINT "comentarios_cita_editadoPorId_fkey" FOREIGN KEY ("editadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
