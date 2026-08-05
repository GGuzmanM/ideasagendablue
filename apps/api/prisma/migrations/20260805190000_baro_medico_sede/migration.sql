-- CreateTable
CREATE TABLE "baro_medico_sede" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesionalId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoPor" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baro_medico_sede_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "baro_medico_sede_profesionalId_sedeId_key" ON "baro_medico_sede"("profesionalId", "sedeId");

-- CreateIndex
CREATE INDEX "baro_medico_sede_sedeId_activa_idx" ON "baro_medico_sede"("sedeId", "activa");

-- AddForeignKey
ALTER TABLE "baro_medico_sede" ADD CONSTRAINT "baro_medico_sede_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baro_medico_sede" ADD CONSTRAINT "baro_medico_sede_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
