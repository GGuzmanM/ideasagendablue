-- CreateTable
CREATE TABLE "fotos_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "pacienteId" UUID NOT NULL,
    "pie" TEXT,
    "zona" TEXT,
    "categoria" TEXT NOT NULL DEFAULT 'lesion',
    "descripcion" TEXT,
    "ruta" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "tomadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subidoPorUsuarioId" UUID,
    "subidoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fotos_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fotos_clinicas_atencionId_idx" ON "fotos_clinicas"("atencionId");

-- CreateIndex
CREATE INDEX "fotos_clinicas_pacienteId_zona_idx" ON "fotos_clinicas"("pacienteId", "zona");

-- AddForeignKey
ALTER TABLE "fotos_clinicas" ADD CONSTRAINT "fotos_clinicas_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

