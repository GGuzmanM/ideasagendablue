-- 30-oct-2026: RESERVA WEB — qué sedes se muestran y en qué sedes se ofrece cada servicio.
--  · sedes.reservaWeb: la sede aparece en la página de reservas y en el chat de WhatsApp (por defecto TRUE: nada cambia).
--  · servicio_sede_web_oculto: sedes donde un servicio NO se ofrece en la web. Sin fila = se ofrece en todas las sedes de su área.
-- Solo agrega una columna con valor por defecto y una tabla nueva (no toca datos existentes). Idempotente.
ALTER TABLE "sedes" ADD COLUMN IF NOT EXISTS "reservaWeb" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "servicio_sede_web_oculto" (
    "servicioId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicio_sede_web_oculto_pkey" PRIMARY KEY ("servicioId","sedeId")
);

CREATE INDEX IF NOT EXISTS "servicio_sede_web_oculto_sedeId_idx" ON "servicio_sede_web_oculto"("sedeId");

DO $$ BEGIN
  ALTER TABLE "servicio_sede_web_oculto" ADD CONSTRAINT "servicio_sede_web_oculto_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "servicio_sede_web_oculto" ADD CONSTRAINT "servicio_sede_web_oculto_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
