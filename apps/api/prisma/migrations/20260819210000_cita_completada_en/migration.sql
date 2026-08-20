-- Momento en que la cita pasó a completada (para medir tiempos: espera/atención/total).
ALTER TABLE "citas" ADD COLUMN "completadaEn" TIMESTAMP(3);
