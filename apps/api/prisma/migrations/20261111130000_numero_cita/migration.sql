-- 11-nov-2026: N.º de cita correlativo y visible («C-000123»), para darlo al paciente por teléfono, en el correo y buscarlo.
-- Toda cita lo recibe al crearse (agenda, reserva web, chat de WhatsApp, importaciones). Las citas que ya existen se numeran
-- en el orden en que se registraron (creadoEn), así el número sigue la historia real. Equivale al SERIAL que genera Prisma
-- (secuencia citas_numero_seq + índice único citas_numero_key), escrito a mano para numerar lo existente en orden.
CREATE SEQUENCE IF NOT EXISTS "citas_numero_seq" AS INTEGER;

ALTER TABLE "citas" ADD COLUMN "numero" INTEGER;

UPDATE "citas" c
   SET "numero" = o.n
  FROM (SELECT id, row_number() OVER (ORDER BY "creadoEn", id) AS n FROM "citas") o
 WHERE o.id = c.id;

-- La próxima cita sigue después de la última numerada (si la tabla está vacía, empieza en 1).
SELECT setval('"citas_numero_seq"', COALESCE((SELECT max("numero") FROM "citas"), 0) + 1, false);

ALTER TABLE "citas" ALTER COLUMN "numero" SET DEFAULT nextval('"citas_numero_seq"');
ALTER TABLE "citas" ALTER COLUMN "numero" SET NOT NULL;
ALTER SEQUENCE "citas_numero_seq" OWNED BY "citas"."numero";

CREATE UNIQUE INDEX "citas_numero_key" ON "citas"("numero");
