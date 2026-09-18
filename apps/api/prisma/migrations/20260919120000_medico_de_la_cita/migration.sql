-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "medicoAsignadoEn" TIMESTAMP(3),
ADD COLUMN     "medicoAsignadoPorId" UUID,
ADD COLUMN     "medicoId" UUID;

-- CreateTable
CREATE TABLE "firmas_profesional" (
    "profesionalId" UUID NOT NULL,
    "imagen" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firmas_profesional_pkey" PRIMARY KEY ("profesionalId")
);

-- CreateIndex
CREATE INDEX "citas_medicoId_fecha_idx" ON "citas"("medicoId", "fecha");

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_medicoId_fkey" FOREIGN KEY ("medicoId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_profesional" ADD CONSTRAINT "firmas_profesional_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

