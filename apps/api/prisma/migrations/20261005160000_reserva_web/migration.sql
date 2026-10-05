-- Reserva web (05-oct-2026): marca de servicios/variantes reservables online y tabla de reservas en espera de pago.
-- Aditiva: no cambia ni borra nada existente.
-- AlterTable
ALTER TABLE "servicios" ADD COLUMN     "precioOnline" DECIMAL(10,2),
ADD COLUMN     "reservaOnline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subcategorias_servicio" ADD COLUMN     "reservaOnline" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "reservas_web" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" TEXT NOT NULL,
    "tokenConsulta" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'esperando_pago',
    "tipoDocumento" TEXT NOT NULL DEFAULT 'DNI',
    "numeroDocumento" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidoPaterno" TEXT NOT NULL,
    "apellidoMaterno" TEXT,
    "telefono" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sedeId" UUID NOT NULL,
    "unidadNegocioId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "subcategoriaId" UUID,
    "fecha" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "duracionMinutos" INTEGER NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "pasarela" TEXT,
    "pagoReferencia" TEXT,
    "pagoEstado" TEXT,
    "pagoDetalle" JSONB,
    "pagadoEn" TIMESTAMP(3),
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "pacienteId" UUID,
    "citaId" UUID,
    "error" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservas_web_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservas_web_codigo_key" ON "reservas_web"("codigo");

-- CreateIndex
CREATE INDEX "reservas_web_sedeId_fecha_estado_idx" ON "reservas_web"("sedeId", "fecha", "estado");

-- CreateIndex
CREATE INDEX "reservas_web_numeroDocumento_idx" ON "reservas_web"("numeroDocumento");

-- CreateIndex
CREATE INDEX "reservas_web_pagoReferencia_idx" ON "reservas_web"("pagoReferencia");

