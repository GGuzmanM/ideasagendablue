-- 29-oct-2026: precio WEB por variante (tipo) de un servicio. Hasta hoy la reserva web usaba el precio referencial de la variante
-- (el mismo que la Agenda); ahora cada variante puede tener su precio en la reserva web. Vacío = se usa el referencial.
-- Solo agrega una columna opcional (no reescribe la tabla).
ALTER TABLE "subcategorias_servicio" ADD COLUMN IF NOT EXISTS "precioOnline" DECIMAL(10,2);
