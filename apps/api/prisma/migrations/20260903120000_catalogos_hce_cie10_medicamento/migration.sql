-- CreateTable
CREATE TABLE "cie10" (
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "categoria" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cie10_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "medicamentos" (
    "id" TEXT NOT NULL,
    "dci" TEXT NOT NULL,
    "codigoAtc" TEXT,
    "codigoDigemid" TEXT,
    "concentracion" TEXT,
    "formaFarmaceutica" TEXT,
    "viaAdministracion" TEXT,
    "nombresComerciales" TEXT,
    "grupo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medicamentos_dci_idx" ON "medicamentos"("dci");

-- CreateIndex
CREATE INDEX "medicamentos_grupo_idx" ON "medicamentos"("grupo");


-- Búsqueda difusa (pg_trgm) por nombre para los catálogos. NO se representan en
-- schema.prisma (como los índices parciales del proyecto): al regenerar migraciones
-- con `migrate diff` no se tocan; con `migrate dev` habría que evitar su DROP.
CREATE INDEX "cie10_descripcion_trgm" ON "cie10" USING gin ("descripcion" gin_trgm_ops);
CREATE INDEX "medicamentos_dci_trgm" ON "medicamentos" USING gin ("dci" gin_trgm_ops);
CREATE INDEX "medicamentos_comercial_trgm" ON "medicamentos" USING gin ("nombresComerciales" gin_trgm_ops);
