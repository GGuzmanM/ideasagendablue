-- 23-oct-2026 (rendimiento): índices trigram para la búsqueda de pacientes (GET /pacientes/buscar).
-- La búsqueda usa ILIKE '%texto%' sobre el nombre completo, el documento y el teléfono: sin índice recorría las ~57 000
-- filas en cada búsqueda (~50 ms; medido 52,8 ms → 0,46 ms con estos índices). Son índices GIN que Prisma no representa
-- en schema.prisma (igual que los demás índices trigram/parciales): si `migrate dev` propone borrarlos, NO aplicar ese DROP.
-- La expresión del nombre debe ser IDÉNTICA a la de la consulta en routes/pacientes.ts para que el índice se use.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "pacientes_nombre_completo_trgm" ON "pacientes"
  USING gin ((nombres || ' ' || "apellidoPaterno" || ' ' || "apellidoMaterno") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "pacientes_documento_trgm" ON "pacientes" USING gin ("numeroDocumento" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "pacientes_telefono_trgm" ON "pacientes" USING gin (telefono gin_trgm_ops);
