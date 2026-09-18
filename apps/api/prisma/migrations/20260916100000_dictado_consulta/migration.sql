-- CreateTable
CREATE TABLE "dictados_consulta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "texto" TEXT NOT NULL DEFAULT '',
    "aplicadoEn" TIMESTAMP(3),
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dictados_consulta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dictados_consulta_atencionId_key" ON "dictados_consulta"("atencionId");

-- AddForeignKey
ALTER TABLE "dictados_consulta" ADD CONSTRAINT "dictados_consulta_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

