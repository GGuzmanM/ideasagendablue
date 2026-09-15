-- DropForeignKey
ALTER TABLE "tiempos_tratamiento" DROP CONSTRAINT "tiempos_tratamiento_citaId_fkey";

-- AlterTable
ALTER TABLE "tiempos_tratamiento" DROP COLUMN "enlazadoEn",
DROP COLUMN "enlazadoPor",
ALTER COLUMN "citaId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "tiempos_tratamiento" ADD CONSTRAINT "tiempos_tratamiento_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

