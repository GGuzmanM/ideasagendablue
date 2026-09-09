-- CreateTable
CREATE TABLE "procedimientos_atencion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "pie" TEXT,
    "ubicacion" TEXT,
    "detalle" TEXT,
    "parametros" JSONB,
    "anestesia" TEXT,
    "paquetePacienteId" UUID,
    "sesionNumero" INTEGER,
    "sesionesTotales" INTEGER,
    "profesionalId" UUID,
    "profesionalEtiqueta" TEXT,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "procedimientos_atencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalas_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "datos" JSONB NOT NULL,
    "resultado" TEXT,
    "pie" TEXT,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "escalas_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marcas_podograma" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "pie" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "zona" TEXT,
    "tipoLesion" TEXT NOT NULL,
    "nota" TEXT,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "marcas_podograma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "procedimientos_atencion_atencionId_idx" ON "procedimientos_atencion"("atencionId");

-- CreateIndex
CREATE INDEX "procedimientos_atencion_paquetePacienteId_idx" ON "procedimientos_atencion"("paquetePacienteId");

-- CreateIndex
CREATE INDEX "escalas_clinicas_atencionId_idx" ON "escalas_clinicas"("atencionId");

-- CreateIndex
CREATE INDEX "marcas_podograma_atencionId_idx" ON "marcas_podograma"("atencionId");

-- AddForeignKey
ALTER TABLE "procedimientos_atencion" ADD CONSTRAINT "procedimientos_atencion_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedimientos_atencion" ADD CONSTRAINT "procedimientos_atencion_paquetePacienteId_fkey" FOREIGN KEY ("paquetePacienteId") REFERENCES "paquetes_paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalas_clinicas" ADD CONSTRAINT "escalas_clinicas_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marcas_podograma" ADD CONSTRAINT "marcas_podograma_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

