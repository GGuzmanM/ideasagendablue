-- Reserva web · intentos (06-oct-2026): guarda el avance de cada paciente en la página de reserva desde el primer
-- «Continuar» (quién empezó y hasta dónde llegó) para poder contactarlo. Aditiva: no cambia ni borra nada existente.
-- CreateTable
CREATE TABLE "reservas_web_intentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "numeroDocumento" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidoPaterno" TEXT NOT NULL,
    "apellidoMaterno" TEXT,
    "telefono" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pasoAlcanzado" TEXT NOT NULL DEFAULT 'datos',
    "sedeId" UUID,
    "servicioId" UUID,
    "subcategoriaId" UUID,
    "fecha" DATE,
    "horaInicio" TEXT,
    "reservaId" UUID,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "contactadoEn" TIMESTAMP(3),
    "contactadoPorId" UUID,
    "notaContacto" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservas_web_intentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservas_web_intentos_creadoEn_idx" ON "reservas_web_intentos"("creadoEn");

-- CreateIndex
CREATE INDEX "reservas_web_intentos_numeroDocumento_idx" ON "reservas_web_intentos"("numeroDocumento");
