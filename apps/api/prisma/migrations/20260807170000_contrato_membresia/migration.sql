-- Contrato de membresía: plantilla PDF + posiciones (en la plantilla) y contrato generado (en la venta)
ALTER TABLE "paquetes" ADD COLUMN "contratoPlantillaUrl" TEXT;
ALTER TABLE "paquetes" ADD COLUMN "contratoCampos" JSONB;
ALTER TABLE "paquetes_paciente" ADD COLUMN "contratoUrl" TEXT;
