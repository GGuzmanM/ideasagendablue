-- AlterTable
ALTER TABLE "consentimientos_informados" ADD COLUMN     "citaId" UUID,
ADD COLUMN     "contenido" JSONB,
ADD COLUMN     "datos" JSONB,
ADD COLUMN     "firmaProfesional" JSONB,
ADD COLUMN     "firmaTestigo" JSONB,
ADD COLUMN     "formato" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "plantillaClave" TEXT,
ADD COLUMN     "plantillaId" UUID,
ADD COLUMN     "profesionalRegistro" TEXT,
ALTER COLUMN "atencionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "consentimientos_informados_pacienteId_plantillaClave_idx" ON "consentimientos_informados"("pacienteId", "plantillaClave");

-- CreateIndex
CREATE INDEX "consentimientos_informados_citaId_idx" ON "consentimientos_informados"("citaId");

