-- Historia clínica del ERP anterior (28-sep-2026): tabla CONGELADA de solo lectura, se llena con scripts/hc-erp.
-- Solo agrega una tabla nueva: no toca ninguna existente.

-- CreateTable
CREATE TABLE "historia_clinica_erp" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pacienteId" UUID,
    "historialGenexisId" UUID,
    "tipoDocumento" TEXT NOT NULL,
    "numeroDocumento" TEXT NOT NULL,
    "pacienteNombre" TEXT,
    "sedeCodigo" TEXT NOT NULL,
    "sede" TEXT,
    "idAtencion" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "hora" TEXT,
    "profesionalCodigo" TEXT,
    "profesionalDni" TEXT,
    "profesional" TEXT,
    "servicioCodigo" TEXT,
    "servicio" TEXT,
    "anamnesis" TEXT,
    "diagnostico" TEXT,
    "planTratamiento" TEXT,
    "notaMedico" TEXT,
    "examenFisico" TEXT,
    "estadoErp" TEXT,
    "importadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historia_clinica_erp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historia_clinica_erp_pacienteId_fecha_idx" ON "historia_clinica_erp"("pacienteId", "fecha" DESC);

-- CreateIndex
CREATE INDEX "historia_clinica_erp_numeroDocumento_idx" ON "historia_clinica_erp"("numeroDocumento");

-- CreateIndex
CREATE INDEX "historia_clinica_erp_historialGenexisId_idx" ON "historia_clinica_erp"("historialGenexisId");

-- CreateIndex
CREATE UNIQUE INDEX "historia_clinica_erp_sedeCodigo_idAtencion_key" ON "historia_clinica_erp"("sedeCodigo", "idAtencion");
