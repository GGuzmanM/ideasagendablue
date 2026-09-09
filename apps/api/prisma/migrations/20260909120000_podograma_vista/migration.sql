-- AlterTable
ALTER TABLE "imagenes_podograma" ADD COLUMN     "vista" TEXT;


-- Máx. 1 imagen VIVA del podograma por (atención, vista). Índice parcial: Prisma no lo representa
-- en el schema (ver inventario en CLAUDE.md). Las imágenes reemplazadas quedan con deletedAt.
CREATE UNIQUE INDEX "imagenes_podograma_vista_unica"
  ON "imagenes_podograma" ("atencionId", "vista")
  WHERE "deletedAt" IS NULL AND "vista" IS NOT NULL;
