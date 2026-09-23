-- Columna «Adicional»: podóloga que realmente atendió la cita (23-sep-2026). Solo informativo: no cambia la
-- columna de la cita ni ocupa la agenda de esa podóloga.
ALTER TABLE "citas" ADD COLUMN "atendidoPorId" UUID;
ALTER TABLE "citas" ADD CONSTRAINT "citas_atendidoPorId_fkey" FOREIGN KEY ("atendidoPorId") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
