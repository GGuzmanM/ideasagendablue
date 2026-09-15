-- CreateEnum
CREATE TYPE "EstadoTiempoTratamiento" AS ENUM ('en_curso', 'finalizado', 'sin_fin', 'descartado');

-- CreateEnum
CREATE TYPE "OrigenTiempoTratamiento" AS ENUM ('dispositivo', 'manual');

-- AlterTable
ALTER TABLE "sedes" ADD COLUMN     "consultorios" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "dispositivos_consultorio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "sedeId" UUID NOT NULL,
    "unidadNegocioId" UUID NOT NULL,
    "consultorioNumero" INTEGER NOT NULL,
    "tokenPrefijo" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoContacto" TIMESTAMP(3),
    "ultimaIp" TEXT,
    "firmware" TEXT,
    "rssi" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "creadoPor" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispositivos_consultorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiempos_tratamiento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispositivoId" UUID,
    "sedeId" UUID NOT NULL,
    "unidadNegocioId" UUID NOT NULL,
    "consultorioNumero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "citaId" UUID,
    "inicioEn" TIMESTAMP(3) NOT NULL,
    "finEn" TIMESTAMP(3),
    "duracionSegundos" INTEGER,
    "estado" "EstadoTiempoTratamiento" NOT NULL DEFAULT 'en_curso',
    "origen" "OrigenTiempoTratamiento" NOT NULL DEFAULT 'dispositivo',
    "horaAproximada" BOOLEAN NOT NULL DEFAULT false,
    "motivoDescarte" TEXT,
    "enlazadoPor" UUID,
    "enlazadoEn" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiempos_tratamiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_dispositivo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispositivoId" UUID NOT NULL,
    "idEvento" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "presionadoEn" TIMESTAMP(3) NOT NULL,
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edadMs" INTEGER,
    "horaAproximada" BOOLEAN NOT NULL DEFAULT false,
    "resultado" TEXT NOT NULL,
    "tiempoId" UUID,
    "citaId" UUID,
    "respuesta" JSONB,

    CONSTRAINT "eventos_dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_consultorio_tokenPrefijo_key" ON "dispositivos_consultorio"("tokenPrefijo");

-- CreateIndex
CREATE INDEX "dispositivos_consultorio_sedeId_idx" ON "dispositivos_consultorio"("sedeId");

-- CreateIndex
CREATE INDEX "tiempos_tratamiento_sedeId_fecha_idx" ON "tiempos_tratamiento"("sedeId", "fecha");

-- CreateIndex
CREATE INDEX "tiempos_tratamiento_citaId_idx" ON "tiempos_tratamiento"("citaId");

-- CreateIndex
CREATE INDEX "tiempos_tratamiento_dispositivoId_estado_idx" ON "tiempos_tratamiento"("dispositivoId", "estado");

-- CreateIndex
CREATE INDEX "eventos_dispositivo_dispositivoId_recibidoEn_idx" ON "eventos_dispositivo"("dispositivoId", "recibidoEn");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_dispositivo_dispositivoId_idEvento_key" ON "eventos_dispositivo"("dispositivoId", "idEvento");

-- AddForeignKey
ALTER TABLE "dispositivos_consultorio" ADD CONSTRAINT "dispositivos_consultorio_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos_consultorio" ADD CONSTRAINT "dispositivos_consultorio_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiempos_tratamiento" ADD CONSTRAINT "tiempos_tratamiento_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos_consultorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiempos_tratamiento" ADD CONSTRAINT "tiempos_tratamiento_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiempos_tratamiento" ADD CONSTRAINT "tiempos_tratamiento_unidadNegocioId_fkey" FOREIGN KEY ("unidadNegocioId") REFERENCES "unidades_negocio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiempos_tratamiento" ADD CONSTRAINT "tiempos_tratamiento_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_dispositivo" ADD CONSTRAINT "eventos_dispositivo_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "dispositivos_consultorio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Índices únicos PARCIALES (no representables en schema.prisma; ver CLAUDE.md) ───
-- 1 aparato ACTIVO por sede + unidad + consultorio (uno revocado o borrado libera el número).
CREATE UNIQUE INDEX "dispositivos_consultorio_unico" ON "dispositivos_consultorio"("sedeId", "unidadNegocioId", "consultorioNumero")
  WHERE "deletedAt" IS NULL AND "activo" = true;

-- 1 tiempo EN CURSO por consultorio (un segundo INICIO no abre otro tiempo).
CREATE UNIQUE INDEX "tiempos_en_curso_consultorio_unico" ON "tiempos_tratamiento"("sedeId", "unidadNegocioId", "consultorioNumero")
  WHERE "estado" = 'en_curso' AND "deletedAt" IS NULL;

-- 1 tiempo VIGENTE por cita (los descartados no cuentan: la cita puede volver a medirse).
CREATE UNIQUE INDEX "tiempos_cita_vigente_unico" ON "tiempos_tratamiento"("citaId")
  WHERE "citaId" IS NOT NULL AND "estado" <> 'descartado' AND "deletedAt" IS NULL;
