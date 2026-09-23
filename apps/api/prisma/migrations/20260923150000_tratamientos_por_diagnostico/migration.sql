-- Diagnósticos frecuentes y tratamientos habituales por diagnóstico (23-sep-2026). Aditiva.
ALTER TABLE "cie10" ADD COLUMN "frecuente" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "tratamientos_diagnostico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cie10Codigo" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "tratamiento" TEXT NOT NULL,
    "presentacion" TEXT,
    "aplicacion" TEXT,
    "tipo" "TipoItemReceta" NOT NULL DEFAULT 'MEDICAMENTO_OTC',
    "medicamentoId" TEXT,
    "servicioId" UUID,
    "marca" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "codigoErp" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tratamientos_diagnostico_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tratamientos_diagnostico_codigoErp_key" ON "tratamientos_diagnostico"("codigoErp");
CREATE INDEX "tratamientos_diagnostico_cie10Codigo_activo_idx" ON "tratamientos_diagnostico"("cie10Codigo", "activo");
ALTER TABLE "tratamientos_diagnostico" ADD CONSTRAINT "tratamientos_diagnostico_cie10Codigo_fkey" FOREIGN KEY ("cie10Codigo") REFERENCES "cie10"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tratamientos_diagnostico" ADD CONSTRAINT "tratamientos_diagnostico_medicamentoId_fkey" FOREIGN KEY ("medicamentoId") REFERENCES "medicamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tratamientos_diagnostico" ADD CONSTRAINT "tratamientos_diagnostico_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
