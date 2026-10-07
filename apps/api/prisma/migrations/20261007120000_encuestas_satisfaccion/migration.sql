-- Encuesta de satisfacción (07-oct-2026): una fila por visita (paciente + día) con el estado del correo de encuesta
-- que sale 2 h después de completar la cita. Aditiva: no cambia ni borra nada existente.
-- CreateTable
CREATE TABLE "encuestas_satisfaccion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "citaId" UUID NOT NULL,
    "pacienteId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "sedeId" UUID NOT NULL,
    "email" TEXT,
    "estado" TEXT NOT NULL,
    "motivo" TEXT,
    "resendEmailId" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "enviadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encuestas_satisfaccion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_satisfaccion_citaId_key" ON "encuestas_satisfaccion"("citaId");

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_satisfaccion_pacienteId_fecha_key" ON "encuestas_satisfaccion"("pacienteId", "fecha");

-- CreateIndex
CREATE INDEX "encuestas_satisfaccion_estado_creadoEn_idx" ON "encuestas_satisfaccion"("estado", "creadoEn");
