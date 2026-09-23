-- Posología por defecto de los tratamientos habituales por diagnóstico (23-sep-2026): dosis, vía, frecuencia y
-- duración separadas de la «aplicación» del ERP, para que la receta salga llena y el médico solo valide.
ALTER TABLE "tratamientos_diagnostico"
  ADD COLUMN "dosis" TEXT,
  ADD COLUMN "via" TEXT,
  ADD COLUMN "frecuencia" TEXT,
  ADD COLUMN "duracion" TEXT,
  ADD COLUMN "indicaciones" TEXT;
