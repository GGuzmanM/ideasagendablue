-- 29-oct-2026: reserva web SIN pasarela de pago. La cita se crea al confirmar (desde la página o desde el chat de WhatsApp).
--  · canal: por dónde entró la reserva ('web' = página pública; 'whatsapp' = chat, vía API con llave).
--  · referenciaExterna: identificador que manda el chat para que un reintento de la misma petición NO cree otra cita.
-- Solo agrega una columna con valor por defecto y otra opcional (no reescribe la tabla) y un índice único PARCIAL
-- (no lo representa Prisma; vive aquí, como los demás — ver CLAUDE.md).
ALTER TABLE "reservas_web"
  ADD COLUMN IF NOT EXISTS "canal" TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS "referenciaExterna" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "reservas_web_referencia_unica"
  ON "reservas_web" ("canal", "referenciaExterna") WHERE "referenciaExterna" IS NOT NULL;
