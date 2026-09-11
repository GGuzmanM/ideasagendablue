-- CreateTable
CREATE TABLE "dibujos_silueta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "vista" TEXT NOT NULL,
    "pie" TEXT NOT NULL,
    "anotaciones" JSONB NOT NULL DEFAULT '[]',
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dibujos_silueta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dibujos_silueta_atencionId_vista_pie_key" ON "dibujos_silueta"("atencionId", "vista", "pie");

-- AddForeignKey
ALTER TABLE "dibujos_silueta" ADD CONSTRAINT "dibujos_silueta_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

