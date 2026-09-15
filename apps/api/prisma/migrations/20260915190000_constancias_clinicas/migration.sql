-- CreateTable
CREATE TABLE "constancias_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "numero" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "atencionId" UUID NOT NULL,
    "pacienteId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "emisorProfesionalId" UUID NOT NULL,
    "emisorUsuarioId" UUID,
    "emisorNombre" TEXT NOT NULL,
    "emisorRegistro" TEXT,
    "diagnosticoCie10Codigo" TEXT,
    "diagnosticoTexto" TEXT,
    "desde" DATE,
    "hasta" DATE,
    "dias" INTEGER,
    "texto" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'emitida',
    "codigoVerificacion" TEXT NOT NULL,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPorUsuarioId" UUID,
    "motivoAnulacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constancias_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "constancias_clinicas_numero_key" ON "constancias_clinicas"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "constancias_clinicas_codigoVerificacion_key" ON "constancias_clinicas"("codigoVerificacion");

-- CreateIndex
CREATE INDEX "constancias_clinicas_atencionId_idx" ON "constancias_clinicas"("atencionId");

-- CreateIndex
CREATE INDEX "constancias_clinicas_pacienteId_fechaEmision_idx" ON "constancias_clinicas"("pacienteId", "fechaEmision");

-- AddForeignKey
ALTER TABLE "constancias_clinicas" ADD CONSTRAINT "constancias_clinicas_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

