-- Rebote (30-sep-2026): citas que salen de la agenda a la bandeja de rellamada. Solo aditivo.
-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "reboteCerradoEn" TIMESTAMP(3),
ADD COLUMN     "reboteDesde" TIMESTAMP(3),
ADD COLUMN     "reboteEstadoOrigen" "EstadoCita",
ADD COLUMN     "reboteLlamarDesde" DATE,
ADD COLUMN     "reboteMotivo" TEXT,
ADD COLUMN     "rebotePorId" UUID,
ADD COLUMN     "reboteProfesionalId" UUID,
ADD COLUMN     "reboteResultado" TEXT,
ADD COLUMN     "reboteTurno" TEXT,
ADD COLUMN     "reboteVenceEl" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "rebote_llamadas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "citaId" UUID NOT NULL,
    "usuarioId" UUID,
    "resultado" TEXT NOT NULL,
    "nota" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rebote_llamadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rebote_llamadas_citaId_creadoEn_idx" ON "rebote_llamadas"("citaId", "creadoEn");

-- CreateIndex
CREATE INDEX "citas_reboteDesde_idx" ON "citas"("reboteDesde");

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_rebotePorId_fkey" FOREIGN KEY ("rebotePorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebote_llamadas" ADD CONSTRAINT "rebote_llamadas_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebote_llamadas" ADD CONSTRAINT "rebote_llamadas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
