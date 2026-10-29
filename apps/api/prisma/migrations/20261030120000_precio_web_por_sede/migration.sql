-- 30-oct-2026: precio de la RESERVA WEB por SEDE. Cada sede puede cobrar distinto el mismo servicio (o el mismo tipo de un servicio).
-- Sin fila para una sede = rige el precio web general (servicios.precioOnline / subcategorias_servicio.precioOnline) o, si no hay,
-- el referencial: nada cambia para lo que ya está configurado. Solo crea dos tablas nuevas (no toca las existentes). Idempotente.
CREATE TABLE IF NOT EXISTS "servicio_precio_web_sede" (
    "servicioId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "servicio_precio_web_sede_pkey" PRIMARY KEY ("servicioId","sedeId")
);

CREATE TABLE IF NOT EXISTS "subcategoria_precio_web_sede" (
    "subcategoriaId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subcategoria_precio_web_sede_pkey" PRIMARY KEY ("subcategoriaId","sedeId")
);

CREATE INDEX IF NOT EXISTS "servicio_precio_web_sede_sedeId_idx" ON "servicio_precio_web_sede"("sedeId");
CREATE INDEX IF NOT EXISTS "subcategoria_precio_web_sede_sedeId_idx" ON "subcategoria_precio_web_sede"("sedeId");

DO $$ BEGIN
  ALTER TABLE "servicio_precio_web_sede" ADD CONSTRAINT "servicio_precio_web_sede_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "servicio_precio_web_sede" ADD CONSTRAINT "servicio_precio_web_sede_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "subcategoria_precio_web_sede" ADD CONSTRAINT "subcategoria_precio_web_sede_subcategoriaId_fkey" FOREIGN KEY ("subcategoriaId") REFERENCES "subcategorias_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "subcategoria_precio_web_sede" ADD CONSTRAINT "subcategoria_precio_web_sede_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
