-- Anamnesis como campo propio de la atención clínica (separado del motivo de consulta). Aditiva: columna nueva, nullable.
ALTER TABLE "atenciones_clinicas" ADD COLUMN "anamnesis" TEXT;
