-- CreateTable
CREATE TABLE "archivos" (
    "ruta" TEXT NOT NULL,
    "datos" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "tamanoOriginal" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivos_pkey" PRIMARY KEY ("ruta")
);


-- JPEG/PDF ya vienen comprimidos: que Postgres no intente recomprimirlos (solo los guarda fuera de línea).
ALTER TABLE "archivos" ALTER COLUMN "datos" SET STORAGE EXTERNAL;
