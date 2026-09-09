-- CreateTable
CREATE TABLE "imagenes_podograma" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "descripcion" TEXT,
    "anotaciones" JSONB NOT NULL DEFAULT '[]',
    "subidoPorUsuarioId" UUID,
    "subidoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "imagenes_podograma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imagenes_podograma_atencionId_idx" ON "imagenes_podograma"("atencionId");

-- AddForeignKey
ALTER TABLE "imagenes_podograma" ADD CONSTRAINT "imagenes_podograma_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

