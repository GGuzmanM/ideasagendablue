-- CreateTable
CREATE TABLE "recetas_favoritas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "tipoDocumento" "TipoDocumentoReceta" NOT NULL,
    "items" JSONB NOT NULL,
    "indicacionesGenerales" TEXT,
    "vigenciaDias" INTEGER,
    "creadoPorUsuarioId" UUID,
    "creadoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "recetas_favoritas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimientos_informados" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "numero" SERIAL NOT NULL,
    "atencionId" UUID NOT NULL,
    "pacienteId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "procedimiento" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "firmanteNombre" TEXT NOT NULL,
    "firmanteDocumento" TEXT,
    "firmanteRelacion" TEXT NOT NULL DEFAULT 'paciente',
    "firma" JSONB NOT NULL,
    "firmaAspecto" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "profesionalId" UUID,
    "profesionalEtiqueta" TEXT,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "firmadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'firmado',
    "revocadoEn" TIMESTAMP(3),
    "revocadoPorUsuarioId" UUID,
    "motivoRevocacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentimientos_informados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controles_sugeridos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "pacienteId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "servicioId" UUID,
    "fechaSugerida" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "origen" TEXT NOT NULL DEFAULT 'manual',
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "citaId" UUID,
    "motivoDescarte" TEXT,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "resueltoPorUsuarioId" UUID,
    "resueltoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "controles_sugeridos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recetas_favoritas_tipoDocumento_idx" ON "recetas_favoritas"("tipoDocumento");

-- CreateIndex
CREATE UNIQUE INDEX "consentimientos_informados_numero_key" ON "consentimientos_informados"("numero");

-- CreateIndex
CREATE INDEX "consentimientos_informados_atencionId_idx" ON "consentimientos_informados"("atencionId");

-- CreateIndex
CREATE INDEX "consentimientos_informados_pacienteId_idx" ON "consentimientos_informados"("pacienteId");

-- CreateIndex
CREATE INDEX "controles_sugeridos_pacienteId_estado_idx" ON "controles_sugeridos"("pacienteId", "estado");

-- CreateIndex
CREATE INDEX "controles_sugeridos_sedeId_estado_fechaSugerida_idx" ON "controles_sugeridos"("sedeId", "estado", "fechaSugerida");

-- AddForeignKey
ALTER TABLE "consentimientos_informados" ADD CONSTRAINT "consentimientos_informados_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controles_sugeridos" ADD CONSTRAINT "controles_sugeridos_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controles_sugeridos" ADD CONSTRAINT "controles_sugeridos_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

